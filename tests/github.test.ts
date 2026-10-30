import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../server/errors.ts';
import { createGithubClient } from '../server/github.ts';
import { fakeFetch, jsonResponse, repoJson, SHA } from './helpers.ts';

const ref = { owner: 'acme', repo: 'demo' };

async function code(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AppError, 'expected an AppError');
    return err;
  }
  assert.fail('expected the call to throw');
}

describe('GitHub client: requests', () => {
  it('only requests api.github.com and builds paths from validated parts', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(repoJson));
    await createGithubClient({ fetchImpl: impl }).fetchRepository(ref);
    assert.deepEqual(calls, ['https://api.github.com/repos/acme/demo']);
  });

  it('refuses unvalidated owner or repository values', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(repoJson));
    const client = createGithubClient({ fetchImpl: impl });
    assert.equal((await code(client.fetchRepository({ owner: '../x', repo: 'demo' }))).code, 'invalid_input');
    assert.equal((await code(client.fetchRepository({ owner: 'acme', repo: 'a/b' }))).code, 'invalid_input');
    assert.equal(calls.length, 0);
  });

  it('does not follow a redirect to another host', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }));
    const err = await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref));
    assert.equal(err.code, 'github_unavailable');
    assert.deepEqual(calls, ['https://api.github.com/repos/acme/demo']);
  });

  it('sends the token only when configured', async () => {
    let seen: HeadersInit | undefined;
    const impl = (async (_url: string, init?: RequestInit) => {
      seen = init?.headers;
      return jsonResponse(repoJson);
    }) as unknown as typeof fetch;
    await createGithubClient({ fetchImpl: impl, token: 'ghp_exampletokenvalue1234567890' }).fetchRepository(ref);
    assert.equal((seen as Record<string, string>).Authorization, 'Bearer ghp_exampletokenvalue1234567890');
    await createGithubClient({ fetchImpl: impl }).fetchRepository(ref);
    assert.equal((seen as Record<string, string>).Authorization, undefined);
  });
});

describe('GitHub client: error handling', () => {
  it('maps 404 to repo_not_found', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ message: 'Not Found' }, { status: 404 }));
    const err = await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref));
    assert.equal(err.code, 'repo_not_found');
    assert.equal(err.status, 404);
  });

  it('maps an exhausted rate limit (403) to github_rate_limited with a retry time', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 120);
    const { impl } = fakeFetch(() =>
      jsonResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } },
      ),
    );
    const err = await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref));
    assert.equal(err.code, 'github_rate_limited');
    assert.equal(err.status, 429);
    assert.ok(err.retryAfterSeconds !== undefined && err.retryAfterSeconds > 100 && err.retryAfterSeconds <= 121);
    assert.match(err.hint ?? '', /GITHUB_TOKEN/);
  });

  it('maps 429 with Retry-After to github_rate_limited', async () => {
    const { impl } = fakeFetch(() => jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } }));
    const err = await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref));
    assert.equal(err.code, 'github_rate_limited');
    assert.equal(err.retryAfterSeconds, 30);
  });

  it('does not treat a plain 403 as a rate limit', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ message: 'Repository access blocked' }, { status: 403 }));
    const err = await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref));
    assert.equal(err.code, 'github_unavailable');
  });

  it('maps 5xx to github_unavailable', async () => {
    const { impl } = fakeFetch(() => new Response('bad gateway', { status: 502 }));
    assert.equal((await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref))).code, 'github_unavailable');
  });

  it('maps a network failure to github_unavailable', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    assert.equal((await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref))).code, 'github_unavailable');
  });

  it('maps a timeout to github_timeout', async () => {
    const impl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    // AbortSignal.timeout() timers do not keep the event loop alive. A real socket would; the stub needs a stand-in.
    const keepAlive = setInterval(() => undefined, 10);
    try {
      const err = await code(createGithubClient({ fetchImpl: impl, timeoutMs: 30 }).fetchRepository(ref));
      assert.equal(err.code, 'github_timeout');
      assert.equal(err.status, 504);
    } finally {
      clearInterval(keepAlive);
    }
  });

  it('rejects a private repository payload', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ ...repoJson, private: true }));
    assert.equal((await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref))).code, 'repo_private');
  });

  it('rejects a response above the size limit', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ ...repoJson, description: 'x'.repeat(5000) }));
    const err = await code(createGithubClient({ fetchImpl: impl, maxBytes: 1000 }).fetchRepository(ref));
    assert.equal(err.code, 'github_response_too_large');
  });

  it('rejects an unparseable body', async () => {
    const { impl } = fakeFetch(() => new Response('<html>nope</html>', { status: 200 }));
    assert.equal((await code(createGithubClient({ fetchImpl: impl }).fetchRepository(ref))).code, 'github_unavailable');
  });
});

describe('GitHub client: optional endpoints', () => {
  it('returns null for a missing README', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ message: 'Not Found' }, { status: 404 }));
    assert.equal(await createGithubClient({ fetchImpl: impl }).fetchReadme(ref), null);
  });

  it('decodes base64 README content and truncates it', async () => {
    const text = `# Demo\n\n${'é word '.repeat(2500)}`;
    const { impl } = fakeFetch(() =>
      jsonResponse({ name: 'README.md', path: 'README.md', encoding: 'base64', content: Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\n') }),
    );
    const readme = await createGithubClient({ fetchImpl: impl }).fetchReadme(ref);
    assert.ok(readme);
    assert.ok(readme.text.startsWith('# Demo'));
    assert.ok(readme.text.includes('é word'));
    assert.equal(readme.text.length, 8000);
    assert.equal(readme.truncated, true);
    assert.ok(readme.totalChars > 8000);
  });

  it('returns an empty list when the repository has no commits (409)', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ message: 'Git Repository is empty.' }, { status: 409 }));
    assert.deepEqual(await createGithubClient({ fetchImpl: impl }).fetchCommits(ref), []);
  });

  it('builds commit URLs from the SHA and keeps only the first message line', async () => {
    const { impl } = fakeFetch(() =>
      jsonResponse([
        { sha: SHA, commit: { message: 'Fix bug\n\nLong body', committer: { date: '2024-02-01T00:00:00Z' } } },
        { sha: 'not-a-sha', commit: { message: 'ignored' } },
      ]),
    );
    const commits = await createGithubClient({ fetchImpl: impl }).fetchCommits(ref);
    assert.equal(commits.length, 1);
    assert.equal(commits[0]?.message, 'Fix bug');
    assert.equal(commits[0]?.url, `https://github.com/acme/demo/commit/${SHA}`);
  });

  it('excludes pull requests from issues and builds issue URLs from the number', async () => {
    const { impl } = fakeFetch(() =>
      jsonResponse([
        { number: 7, title: 'Real issue', labels: [{ name: 'good first issue' }], comments: 2, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-02T00:00:00Z' },
        { number: 8, title: 'A pull request', pull_request: { url: 'x' }, labels: [] },
      ]),
    );
    const { issues, scanned } = await createGithubClient({ fetchImpl: impl }).fetchIssues(ref);
    assert.equal(scanned, 2);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.url, 'https://github.com/acme/demo/issues/7');
    assert.deepEqual(issues[0]?.labels, ['good first issue']);
  });

  it('reports disabled issues as an error the caller can degrade on', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ message: 'Issues are disabled' }, { status: 410 }));
    assert.equal((await code(createGithubClient({ fetchImpl: impl }).fetchIssues(ref))).code, 'github_unavailable');
  });
});
