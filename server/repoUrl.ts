import type { RepoRef } from '../shared/types.ts';
import { AppError } from './errors.ts';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);
const MAX_INPUT_LENGTH = 200;
const FORMAT_HINT = 'Use https://github.com/owner/repository or owner/repository.';

function invalid(message: string, hint: string = FORMAT_HINT): AppError {
  return new AppError('invalid_input', message, 400, { hint });
}

/**
 * Parses a public GitHub repository reference. Accepts `https://github.com/owner/repo`
 * (optionally with `.git` or a trailing slash) and `owner/repo`. Everything else is rejected.
 * The result is the only thing later code may use to build GitHub API paths.
 */
export function parseRepoInput(raw: unknown): RepoRef {
  if (typeof raw !== 'string') throw invalid('Enter a GitHub repository URL.');
  const input = raw.trim();
  if (input.length === 0) throw invalid('Enter a GitHub repository URL.');
  if (input.length > MAX_INPUT_LENGTH) throw invalid(`The input is longer than ${MAX_INPUT_LENGTH} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(input)) throw invalid('The input contains spaces or control characters.');

  let segments: string[];

  if (/^[a-z][a-z0-9+.-]*:/i.test(input) || /^(?:www\.)?github\.com\//i.test(input)) {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw invalid('That is not a valid URL.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw invalid(`The ${url.protocol.replace(':', '')}: scheme is not supported.`);
    }
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
      throw invalid('Only github.com repositories are supported.');
    }
    if (url.username || url.password) throw invalid('URLs with credentials are not accepted.');
    if (url.port) throw invalid('URLs with a custom port are not accepted.');
    const parts = url.pathname.split('/').slice(1);
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    segments = parts;
  } else {
    if (input.includes(':') || input.includes('\\') || input.includes('@')) {
      throw invalid('That does not look like a GitHub repository reference.');
    }
    segments = input.split('/');
  }

  if (segments.length < 2 || segments[0] === '' || segments[1] === '') {
    throw invalid('The repository name is missing.', 'A repository reference needs an owner and a repository name.');
  }
  if (segments.length > 2) {
    throw invalid(
      'The path has extra segments after owner/repository.',
      'Remove anything after the repository name, such as /tree/main or /issues.',
    );
  }

  const owner = segments[0] as string;
  let repo = segments[1] as string;
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);

  if (!OWNER_RE.test(owner)) throw invalid('The owner name contains unsupported characters.');
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') {
    throw invalid('The repository name contains unsupported characters.');
  }
  return { owner, repo };
}

export function isValidOwner(value: string): boolean {
  return OWNER_RE.test(value);
}

export function isValidRepoName(value: string): boolean {
  return REPO_RE.test(value) && value !== '.' && value !== '..';
}
