import { COMMIT_SAMPLE_SIZE, ISSUE_SCAN_SIZE, README_MODEL_CHARS } from '../shared/constants.ts';
import type { CommitItem, IssueItem, ReadmeData, RepoMeta, RepoRef } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { isValidOwner, isValidRepoName } from './repoUrl.ts';
import { cleanBlock, cleanLine } from './text.ts';

export const GITHUB_API_HOST = 'api.github.com';
export { COMMIT_SAMPLE_SIZE, ISSUE_SCAN_SIZE, README_MODEL_CHARS };

const API_BASE = `https://${GITHUB_API_HOST}`;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const README_MAX_BYTES = 2_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

export interface GithubOptions {
  fetchImpl?: typeof fetch;
  /** Optional token for a higher public-read rate limit. Only ever sent to api.github.com. */
  token?: string | undefined;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface GithubClient {
  fetchRepository(ref: RepoRef): Promise<RepoMeta>;
  fetchCommits(ref: RepoRef): Promise<CommitItem[]>;
  fetchReadme(ref: RepoRef): Promise<ReadmeData | null>;
  fetchIssues(ref: RepoRef): Promise<{ issues: IssueItem[]; scanned: number }>;
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** Reads a response body but gives up once it exceeds maxBytes. */
export async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

function tooLarge(): AppError {
  return new AppError('github_response_too_large', 'GitHub returned a response larger than the allowed limit.', 502);
}

function unreadable(): AppError {
  return new AppError('github_unavailable', 'GitHub returned a response that could not be read.', 502, {
    hint: 'Retry in a moment.',
  });
}

function networkError(err: unknown, timeoutMs: number): AppError {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new AppError('github_timeout', `GitHub did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, 504, {
      hint: 'Retry in a moment.',
    });
  }
  return new AppError('github_unavailable', 'Could not reach the GitHub API.', 502, {
    hint: 'Check the server’s network access to api.github.com, then retry.',
  });
}

function assertApiUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.hostname !== GITHUB_API_HOST || url.port || url.username || url.password) {
    throw new AppError('github_unavailable', 'Refused a request to a host other than api.github.com.', 502);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw unreadable();
  }
}

export function createGithubClient(options: GithubOptions = {}): GithubClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const token = options.token?.trim() || undefined;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'last-commit-investigator',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  function repoPath(ref: RepoRef, suffix = ''): string {
    if (!isValidOwner(ref.owner) || !isValidRepoName(ref.repo)) {
      throw new AppError('invalid_input', 'The repository reference is not valid.', 400);
    }
    return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${suffix}`;
  }

  async function request(path: string, query: Record<string, string> = {}): Promise<Response> {
    let url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    for (let hop = 0; hop < 2; hop++) {
      assertApiUrl(url);
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw networkError(err, timeoutMs);
      }
      if (!REDIRECT_STATUSES.has(res.status)) return res;
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw unreadable();
      try {
        url = new URL(location, url);
      } catch {
        throw unreadable();
      }
    }
    throw new AppError('github_unavailable', 'GitHub redirected the request more than once.', 502);
  }

  async function failure(res: Response, context: 'repository' | 'optional'): Promise<AppError> {
    let apiMessage = '';
    try {
      const body = asRecord(parseJson(await readLimited(res, 20_000)));
      apiMessage = cleanLine(body?.message, 200);
    } catch {
      apiMessage = '';
    }
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retryAfter = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const limited =
      res.status === 429 ||
      (res.status === 403 &&
        (remaining === '0' || Number.isFinite(retryAfter) && retryAfter > 0 || /rate limit/i.test(apiMessage)));
    if (limited) {
      let seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0;
      if (!seconds && Number.isFinite(reset) && reset > 0) seconds = Math.ceil(reset - Date.now() / 1000);
      seconds = Math.min(Math.max(seconds || 60, 1), 3600);
      return new AppError('github_rate_limited', 'The GitHub API rate limit was reached.', 429, {
        retryAfterSeconds: seconds,
        hint: token
          ? 'Wait for the limit to reset, then retry.'
          : 'Unauthenticated requests are limited to 60 per hour. Retry after the reset, or set GITHUB_TOKEN on the server for a higher limit.',
      });
    }
    if (res.status === 404 && context === 'repository') {
      return new AppError('repo_not_found', 'Repository not found.', 404, {
        hint: 'Check the spelling. The repository may have been deleted or may be private; Last Commit only reads public repositories.',
      });
    }
    if (res.status === 451) {
      return new AppError('github_unavailable', 'GitHub blocked this repository (HTTP 451).', 451);
    }
    if (res.status >= 500) {
      return new AppError('github_unavailable', `GitHub returned HTTP ${res.status}.`, 502, {
        hint: 'GitHub may be having problems. Retry shortly.',
      });
    }
    return new AppError(
      'github_unavailable',
      `GitHub returned HTTP ${res.status}${apiMessage ? `: ${apiMessage}` : ''}.`,
      502,
    );
  }

  async function fetchRepository(ref: RepoRef): Promise<RepoMeta> {
    const res = await request(repoPath(ref));
    if (res.status !== 200) throw await failure(res, 'repository');
    const data = asRecord(parseJson(await readLimited(res, maxBytes)));
    if (!data) throw unreadable();
    if (data.private === true) {
      throw new AppError('repo_private', 'This repository is private. Last Commit only investigates public repositories.', 403);
    }
    const ownerLogin = str(asRecord(data.owner)?.login);
    const name = str(data.name);
    const owner = ownerLogin && isValidOwner(ownerLogin) ? ownerLogin : ref.owner;
    const repo = name && isValidRepoName(name) ? name : ref.repo;
    const license = asRecord(data.license);
    const spdx = str(license?.spdx_id);
    const topics = Array.isArray(data.topics)
      ? data.topics.filter((t): t is string => typeof t === 'string' && /^[a-z0-9-]{1,50}$/.test(t)).slice(0, 10)
      : [];
    return {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      description: cleanLine(data.description, 500) || null,
      language: cleanLine(data.language, 50) || null,
      license: spdx && spdx !== 'NOASSERTION' ? cleanLine(spdx, 40) : cleanLine(license?.name, 60) || null,
      topics,
      stars: num(data.stargazers_count),
      forks: num(data.forks_count),
      openIssuesCount: num(data.open_issues_count),
      archived: data.archived === true,
      isFork: data.fork === true,
      defaultBranch: cleanLine(data.default_branch, 100) || 'main',
      createdAt: isoDate(data.created_at),
      pushedAt: isoDate(data.pushed_at),
    };
  }

  async function fetchCommits(ref: RepoRef): Promise<CommitItem[]> {
    const res = await request(repoPath(ref, '/commits'), { per_page: String(COMMIT_SAMPLE_SIZE) });
    if (res.status === 409) {
      await res.body?.cancel().catch(() => undefined);
      return [];
    }
    if (res.status !== 200) throw await failure(res, 'optional');
    const data = parseJson(await readLimited(res, maxBytes));
    if (!Array.isArray(data)) throw unreadable();
    const commits: CommitItem[] = [];
    for (const entry of data) {
      const item = asRecord(entry);
      const sha = str(item?.sha);
      if (!item || !sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
      const commit = asRecord(item.commit);
      const firstLine = (str(commit?.message) ?? '').split(/\r?\n/)[0] ?? '';
      commits.push({
        sha,
        shortSha: sha.slice(0, 7),
        date: isoDate(asRecord(commit?.committer)?.date) ?? isoDate(asRecord(commit?.author)?.date),
        message: cleanLine(firstLine, 200) || '(no message)',
        url: `https://github.com/${ref.owner}/${ref.repo}/commit/${sha}`,
      });
    }
    return commits;
  }

  async function fetchReadme(ref: RepoRef): Promise<ReadmeData | null> {
    const res = await request(repoPath(ref, '/readme'));
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (res.status !== 200) throw await failure(res, 'optional');
    const data = asRecord(parseJson(await readLimited(res, README_MAX_BYTES)));
    const content = str(data?.content);
    if (!data || content === null || data.encoding !== 'base64') throw unreadable();
    const decoded = Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8').replace(/^﻿/, '');
    const full = cleanBlock(decoded, Number.MAX_SAFE_INTEGER);
    return {
      path: cleanLine(data.path ?? data.name, 100) || 'README',
      text: full.slice(0, README_MODEL_CHARS),
      truncated: full.length > README_MODEL_CHARS,
      totalChars: full.length,
      url: `https://github.com/${ref.owner}/${ref.repo}#readme`,
    };
  }

  async function fetchIssues(ref: RepoRef): Promise<{ issues: IssueItem[]; scanned: number }> {
    const res = await request(repoPath(ref, '/issues'), {
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: String(ISSUE_SCAN_SIZE),
    });
    if (res.status === 410) {
      await res.body?.cancel().catch(() => undefined);
      throw new AppError('github_unavailable', 'Issues are disabled for this repository.', 410);
    }
    if (res.status !== 200) throw await failure(res, 'optional');
    const data = parseJson(await readLimited(res, maxBytes));
    if (!Array.isArray(data)) throw unreadable();
    const issues: IssueItem[] = [];
    for (const entry of data) {
      const item = asRecord(entry);
      if (!item || 'pull_request' in item) continue;
      const number = item.number;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) continue;
      const labels = Array.isArray(item.labels)
        ? item.labels
            .map((label) => (typeof label === 'string' ? label : str(asRecord(label)?.name)))
            .filter((label): label is string => !!label)
            .map((label) => cleanLine(label, 50))
            .filter(Boolean)
            .slice(0, 6)
        : [];
      issues.push({
        number,
        title: cleanLine(item.title, 200) || '(untitled)',
        createdAt: isoDate(item.created_at),
        updatedAt: isoDate(item.updated_at),
        labels,
        comments: num(item.comments),
        url: `https://github.com/${ref.owner}/${ref.repo}/issues/${number}`,
      });
    }
    return { issues, scanned: data.length };
  }

  return { fetchRepository, fetchCommits, fetchReadme, fetchIssues };
}
