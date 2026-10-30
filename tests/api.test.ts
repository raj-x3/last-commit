import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type http from 'node:http';
import type { InvestigationReport, ProgressEvent } from '../shared/types.ts';
import { reportToMarkdown } from '../shared/markdown.ts';
import { AppError } from '../server/errors.ts';
import { analyzeWithGemma, type GenAiLike } from '../server/gemma.ts';
import { createGithubClient } from '../server/github.ts';
import { createApp, type AppConfig } from '../server/index.ts';
import { commit, jsonResponse, validAnalysisJson } from './helpers.ts';

function githubFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  const sha = commit(1, '2026-09-01T00:00:00Z');
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const key = url.pathname.replace('/repos/acme/widget', '') || '/';
    const override = overrides[key];
    if (override) return override();
    switch (key) {
      case '/':
        return jsonResponse({
          name: 'widget',
          owner: { login: 'acme' },
          private: false,
          description: 'A widget library',
          language: 'TypeScript',
          stargazers_count: 10,
          forks_count: 2,
          open_issues_count: 3,
          archived: false,
          default_branch: 'main',
          created_at: '2020-01-01T00:00:00Z',
          pushed_at: '2026-09-01T00:00:00Z',
          license: { spdx_id: 'MIT' },
        });
      case '/commits':
        return jsonResponse([{ sha: sha.sha, commit: { message: 'init', committer: { date: sha.date } } }]);
      case '/readme':
        return jsonResponse({ name: 'README.md', path: 'README.md', encoding: 'base64', content: Buffer.from('# Widget\nA widget library.').toString('base64') });
      case '/issues':
        return jsonResponse([{ number: 7, title: 'Docs typo', labels: [{ name: 'good first issue' }], comments: 1, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z' }]);
      default:
        return jsonResponse({ message: 'Not Found' }, { status: 404 });
    }
  }) as typeof fetch;
}

function modelClient(reply: () => string): GenAiLike {
  return { models: { generateContent: async () => ({ text: reply() }) } };
}

let server: http.Server;
let base = '';
let limited: http.Server;
let limitedBase = '';

function config(partial: Partial<AppConfig>): AppConfig {
  return {
    distDir: '/nonexistent-dist',
    geminiApiKey: 'test-key-123456',
    githubToken: undefined,
    rateLimitMax: 0,
    trustProxy: false,
    maxConcurrent: 4,
    ...partial,
  };
}

async function listen(app: http.Server): Promise<string> {
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
}

async function run(url: string, repository: unknown, init: Partial<RequestInit> = {}): Promise<{ status: number; events: ProgressEvent[]; json: unknown }> {
  const res = await fetch(`${url}/api/investigate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repository }),
    ...init,
  });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('ndjson')) {
    return { status: res.status, events: text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as ProgressEvent), json: null };
  }
  return { status: res.status, events: [], json: JSON.parse(text) };
}

before(async () => {
  const github = createGithubClient({ fetchImpl: githubFetch({ '/issues': () => jsonResponse({ message: 'Server Error' }, { status: 500 }) }) });
  const analyze = (bundle: Parameters<typeof analyzeWithGemma>[0]) =>
    analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient: () => modelClient(() => JSON.stringify(validAnalysisJson())) });
  server = createApp(config({ github, analyze }));
  base = await listen(server);
  limited = createApp(config({ github, analyze, rateLimitMax: 2 }));
  limitedBase = await listen(limited);
});

after(() => {
  server.close();
  limited.close();
});

describe('HTTP API', () => {
  it('reports health without exposing secrets', async () => {
    const res = await fetch(`${base}/api/health`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(res.status, 200);
    assert.equal(body.model, 'gemma-4-26b-a4b-it');
    assert.equal(body.modelConfigured, true);
    assert.doesNotMatch(JSON.stringify(body), /test-key/);
  });

  it('streams real stage events and a final report, tolerating one failed optional source', async () => {
    const { status, events } = await run(base, 'https://github.com/acme/widget');
    assert.equal(status, 200);
    const stages = events.filter((e): e is Extract<ProgressEvent, { type: 'stage' }> => e.type === 'stage');
    assert.ok(stages.some((e) => e.stage === 'repository' && e.state === 'running'));
    assert.ok(stages.some((e) => e.stage === 'repository' && e.state === 'done'));
    assert.ok(stages.some((e) => e.stage === 'issues' && e.state === 'unavailable'), 'issues failure is reported as unavailable');
    assert.ok(stages.some((e) => e.stage === 'analysis' && e.state === 'done'));
    const doneIndex = stages.findIndex((e) => e.stage === 'analysis' && e.state === 'done');
    const runningIndex = stages.findIndex((e) => e.stage === 'analysis' && e.state === 'running');
    assert.ok(runningIndex < doneIndex, 'analysis starts before it is reported done');

    const last = events[events.length - 1];
    assert.equal(last?.type, 'result');
    const report = (last as { type: 'result'; report: InvestigationReport }).report;
    assert.equal(report.repository.fullName, 'acme/widget');
    assert.equal(report.sections.issues.status, 'unavailable');
    assert.equal(report.model.id, 'gemma-4-26b-a4b-it');
    assert.ok(report.evidence.some((e) => e.sourceType === 'status' && /issues/i.test(e.title)));
    assert.equal(report.analysis.missions.length, 3);

    const markdown = reportToMarkdown(report);
    assert.match(markdown, /# acme\/widget/);
    assert.match(markdown, /Source ledger/);
    assert.match(markdown, /https:\/\/github\.com\/acme\/widget\/commit\//);
    assert.match(markdown, /Gemma interpretation/);
  });

  it('rejects invalid input before touching GitHub or the model', async () => {
    const { status, json } = await run(base, 'https://evil.com/acme/widget');
    assert.equal(status, 400);
    assert.equal((json as { error: { code: string } }).error.code, 'invalid_input');
  });

  it('rejects non-JSON requests, bad JSON and oversized bodies', async () => {
    const wrongType = await run(base, 'acme/widget', { headers: { 'content-type': 'text/plain' } });
    assert.equal(wrongType.status, 400);
    const badJson = await run(base, 'acme/widget', { body: '{nope' });
    assert.equal(badJson.status, 400);
    const huge = await run(base, 'a'.repeat(10_000));
    assert.equal(huge.status, 413);
  });

  it('reports a missing API key as a configuration error', async () => {
    const app = createApp(config({ geminiApiKey: undefined, github: createGithubClient({ fetchImpl: githubFetch() }) }));
    const url = await listen(app);
    try {
      const { status, json } = await run(url, 'acme/widget');
      assert.equal(status, 503);
      const error = (json as { error: { code: string; hint: string } }).error;
      assert.equal(error.code, 'missing_api_key');
      assert.match(error.hint, /GEMINI_API_KEY/);
    } finally {
      app.close();
    }
  });

  it('streams a repo_not_found error event for unknown repositories', async () => {
    const github = createGithubClient({ fetchImpl: githubFetch({ '/': () => jsonResponse({ message: 'Not Found' }, { status: 404 }) }) });
    const app = createApp(config({ github, analyze: async () => assert.fail('model must not run') }));
    const url = await listen(app);
    try {
      const { events } = await run(url, 'acme/widget');
      const last = events[events.length - 1];
      assert.equal(last?.type, 'error');
      assert.equal((last as { error: { code: string } }).error.code, 'repo_not_found');
      assert.ok(events.some((e) => e.type === 'stage' && e.stage === 'repository' && e.state === 'failed'));
    } finally {
      app.close();
    }
  });

  it('surfaces GitHub rate limiting and model failures as error events', async () => {
    const rateLimited = createGithubClient({
      fetchImpl: githubFetch({ '/': () => jsonResponse({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) }),
    });
    const modelDown = createGithubClient({ fetchImpl: githubFetch() });
    const a = createApp(config({ github: rateLimited }));
    const b = createApp(
      config({
        github: modelDown,
        analyze: async () => {
          throw new AppError('model_error', 'The Gemini API returned an error: boom', 502);
        },
      }),
    );
    const [urlA, urlB] = [await listen(a), await listen(b)];
    try {
      const first = await run(urlA, 'acme/widget');
      assert.equal((first.events.at(-1) as { error: { code: string } }).error.code, 'github_rate_limited');
      const second = await run(urlB, 'acme/widget');
      assert.equal((second.events.at(-1) as { error: { code: string } }).error.code, 'model_error');
      assert.ok(second.events.some((e) => e.type === 'stage' && e.stage === 'analysis' && e.state === 'failed'));
    } finally {
      a.close();
      b.close();
    }
  });

  it('rate limits repeated investigations per client', async () => {
    await run(limitedBase, 'octo/one');
    await run(limitedBase, 'octo/two');
    const third = await run(limitedBase, 'octo/three');
    assert.equal(third.status, 429);
    assert.equal((third.json as { error: { code: string } }).error.code, 'too_many_requests');
  });

  it('sets security headers and does not serve files outside dist', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const traversal = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    assert.notEqual(traversal.status, 200);
    const unknown = await fetch(`${base}/api/nope`);
    assert.equal(unknown.status, 404);
  });
});
