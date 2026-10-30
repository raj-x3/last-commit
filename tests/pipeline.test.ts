import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { computeActivity } from '../server/activity.ts';
import { createApp } from '../server/index.ts';
import { investigate } from '../server/investigate.ts';
import { AppError } from '../server/errors.ts';
import type { GithubClient } from '../server/github.ts';
import { reportToMarkdown } from '../shared/markdown.ts';
import type { CommitItem, InvestigationReport, ProgressEvent, RepoMeta } from '../shared/types.ts';
import { SHA, validAnalysis } from './helpers.ts';

const NOW = Date.parse('2025-06-01T00:00:00Z');
const day = 86_400_000;

const meta: RepoMeta = {
  owner: 'acme',
  name: 'demo',
  fullName: 'acme/demo',
  url: 'https://github.com/acme/demo',
  description: 'A demo',
  language: 'Go',
  license: null,
  topics: [],
  stars: 5,
  forks: 1,
  openIssuesCount: 2,
  archived: false,
  isFork: false,
  defaultBranch: 'main',
  createdAt: '2019-01-01T00:00:00Z',
  pushedAt: new Date(NOW - 10 * day).toISOString(),
};

function commitsAt(daysAgo: number[]): CommitItem[] {
  return daysAgo.map((d) => ({
    sha: SHA,
    shortSha: SHA.slice(0, 7),
    date: new Date(NOW - d * day).toISOString(),
    message: 'change',
    url: `https://github.com/acme/demo/commit/${SHA}`,
  }));
}

describe('computeActivity', () => {
  const base = { archived: false, createdAt: meta.createdAt, commits: null, now: NOW };
  const at = (daysAgo: number | null) => (daysAgo === null ? null : new Date(NOW - daysAgo * day).toISOString());

  it('assigns categories by days since last push', () => {
    assert.equal(computeActivity({ ...base, pushedAt: at(0) }).category, 'recently_active');
    assert.equal(computeActivity({ ...base, pushedAt: at(90) }).category, 'recently_active');
    assert.equal(computeActivity({ ...base, pushedAt: at(91) }).category, 'quieter');
    assert.equal(computeActivity({ ...base, pushedAt: at(365) }).category, 'quieter');
    assert.equal(computeActivity({ ...base, pushedAt: at(366) }).category, 'little_recent_activity');
    assert.equal(computeActivity({ ...base, pushedAt: at(2000) }).label, 'Little recent activity');
  });

  it('labels archived repositories as archived regardless of dates', () => {
    assert.equal(computeActivity({ ...base, archived: true, pushedAt: at(5) }).category, 'archived');
  });

  it('is unknown, with a caveat, when there is no usable push date', () => {
    const signal = computeActivity({ ...base, pushedAt: null });
    assert.equal(signal.category, 'unknown');
    assert.equal(signal.daysSincePush, null);
    assert.ok(signal.caveats.length > 0);
  });

  it('computes days since push from the supplied timestamp', () => {
    assert.equal(computeActivity({ ...base, pushedAt: at(42) }).daysSincePush, 42);
  });

  it('says so when commit history is unavailable or empty', () => {
    assert.match(computeActivity({ ...base, pushedAt: at(5), commits: null }).caveats.join(' '), /could not be retrieved/);
    assert.match(computeActivity({ ...base, pushedAt: at(5), commits: [] }).caveats.join(' '), /no commits/);
  });

  it('counts sampled commits per window and marks a full sample as a lower bound', () => {
    const small = computeActivity({ ...base, pushedAt: at(5), commits: commitsAt([1, 30, 200, 400]) });
    assert.deepEqual(small.windows.map((w) => [w.days, w.count, w.atLeast]), [[90, 2, false], [365, 3, false]]);
    const full = computeActivity({ ...base, pushedAt: at(5), commits: commitsAt(Array.from({ length: 30 }, (_, i) => i + 1)) });
    assert.equal(full.windows[0]?.atLeast, true);
  });
});

function githubStub(overrides: Partial<GithubClient> = {}): GithubClient {
  return {
    fetchRepository: async () => meta,
    fetchCommits: async () => commitsAt([10, 40]),
    fetchReadme: async () => ({ path: 'README.md', text: '# Demo', truncated: false, totalChars: 6, url: 'https://github.com/acme/demo#readme' }),
    fetchIssues: async () => ({ issues: [], scanned: 0 }),
    ...overrides,
  };
}

function analysisFor(evidenceCount: number) {
  const analysis = validAnalysis();
  void evidenceCount;
  return {
    analysis: {
      repositorySummary: 'Summary',
      activityInterpretation: { assessment: 'a', reasoning: 'r', evidenceIds: ['E01'], supported: true },
      findings: [],
      missions: [],
      revivalPlan: ['a', 'b', 'c'],
    },
    warnings: [],
    attempts: 1,
    raw: analysis,
  };
}

describe('investigate', () => {
  it('survives failures of optional sources and records them as unavailable', async () => {
    const events: ProgressEvent[] = [];
    let bundleEvidence = 0;
    const report = await investigate(
      { owner: 'acme', repo: 'demo' },
      {
        github: githubStub({
          fetchCommits: async () => {
            throw new AppError('github_rate_limited', 'The GitHub API rate limit was reached.', 429);
          },
          fetchReadme: async () => null,
          fetchIssues: async () => {
            throw new AppError('github_timeout', 'GitHub did not respond within 10 seconds.', 504);
          },
        }),
        analyze: async (bundle) => {
          bundleEvidence = bundle.evidence.length;
          assert.equal(bundle.sections.commits.status, 'unavailable');
          assert.equal(bundle.sections.readme.status, 'missing');
          assert.equal(bundle.sections.issues.status, 'unavailable');
          return analysisFor(bundle.evidence.length);
        },
        now: () => NOW,
      },
      (event) => events.push(event),
    );
    assert.equal(report.sections.commits.status, 'unavailable');
    assert.ok(report.evidence.some((e) => e.sourceType === 'status'));
    assert.ok(bundleEvidence >= 4);
    const stage = (name: string) => events.filter((e) => e.type === 'stage' && e.stage === name).map((e) => (e.type === 'stage' ? e.state : ''));
    assert.deepEqual(stage('commits'), ['running', 'unavailable']);
    assert.deepEqual(stage('readme'), ['running', 'empty']);
    assert.deepEqual(stage('analysis'), ['running', 'done']);
  });

  it('does not report the analysis stage as started or done when the repository is missing', async () => {
    const events: ProgressEvent[] = [];
    await assert.rejects(
      investigate(
        { owner: 'acme', repo: 'gone' },
        {
          github: githubStub({
            fetchRepository: async () => {
              throw new AppError('repo_not_found', 'Repository not found.', 404);
            },
          }),
          analyze: async () => assert.fail('analysis must not run'),
        },
        (event) => events.push(event),
      ),
      (err: unknown) => err instanceof AppError && err.code === 'repo_not_found',
    );
    const states = events.filter((e) => e.type === 'stage').map((e) => (e.type === 'stage' ? `${e.stage}:${e.state}` : ''));
    assert.deepEqual(states, ['repository:running', 'repository:failed']);
  });

  it('marks the analysis stage failed when the model fails, and returns no report', async () => {
    const events: ProgressEvent[] = [];
    await assert.rejects(
      investigate(
        { owner: 'acme', repo: 'demo' },
        {
          github: githubStub(),
          analyze: async () => {
            throw new AppError('model_auth', 'rejected', 502);
          },
        },
        (event) => events.push(event),
      ),
    );
    const last = events[events.length - 1];
    assert.ok(last?.type === 'stage' && last.stage === 'analysis' && last.state === 'failed');
  });

  it('assigns stable sequential evidence IDs with real GitHub URLs', async () => {
    const report = await investigate(
      { owner: 'acme', repo: 'demo' },
      { github: githubStub(), analyze: async (b) => analysisFor(b.evidence.length), now: () => NOW },
      () => undefined,
    );
    assert.deepEqual(report.evidence.slice(0, 3).map((e) => e.id), ['E01', 'E02', 'E03']);
    assert.ok(report.evidence.every((e) => e.url.startsWith('https://github.com/acme/demo')));
    assert.equal(report.evidence[1]?.derived, true);
  });
});

describe('reportToMarkdown', () => {
  it('labels verified evidence, interpretation and suggested actions, and escapes markup', async () => {
    const base = await investigate(
      { owner: 'acme', repo: 'demo' },
      { github: githubStub(), analyze: async (b) => analysisFor(b.evidence.length), now: () => NOW },
      () => undefined,
    );
    const report: InvestigationReport = {
      ...base,
      analysis: {
        ...base.analysis,
        repositorySummary: 'Uses <script>alert(1)</script> and `ticks`',
        missions: [
          { title: 'M', difficulty: 'Beginner', basis: 'general-exploration', reason: 'r', steps: ['s1', 's2'], evidenceIds: ['E02'], requiresVerification: true, verificationNote: 'v' },
        ],
      },
    };
    const md = reportToMarkdown(report);
    assert.match(md, /Gemma interpretation/);
    assert.match(md, /Source ledger \(verified evidence\)/);
    assert.match(md, /Contribution missions \(suggested actions\)/);
    assert.match(md, /general exploration task, not a known problem/);
    assert.match(md, /\[E02\]\(https:\/\/github\.com\/acme\/demo\/commits\)/);
    assert.ok(!md.includes('<script>'));
    assert.match(md, /not proof that a project is abandoned/);
  });
});

describe('HTTP API', () => {
  let server: ReturnType<typeof createApp>;
  let base = '';

  const start = async (config: Partial<Parameters<typeof createApp>[0]>) => {
    server = createApp({
      distDir: '/nonexistent',
      geminiApiKey: undefined,
      githubToken: undefined,
      rateLimitMax: 0,
      trustProxy: false,
      maxConcurrent: 4,
      ...config,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const post = (body: unknown, init: RequestInit = {}) =>
    fetch(`${base}/api/investigate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...init });

  describe('without credentials', () => {
    before(() => start({}));
    after(stop);

    it('reports health without leaking any secret', async () => {
      const res = await fetch(`${base}/api/health`);
      assert.deepEqual(await res.json(), { status: 'ok', model: 'gemma-4-26b-a4b-it', modelConfigured: false, githubTokenConfigured: false });
    });

    it('returns a clear configuration error when GEMINI_API_KEY is missing', async () => {
      const res = await post({ repository: 'acme/demo' });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: { code: string; hint: string } };
      assert.equal(body.error.code, 'missing_api_key');
      assert.match(body.error.hint, /GEMINI_API_KEY/);
    });

    it('rejects invalid repository input with 400 before doing anything else', async () => {
      const res = await post({ repository: 'https://evil.example/a/b' });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'invalid_input');
    });

    it('rejects oversized bodies, wrong content types and malformed JSON', async () => {
      assert.equal((await post({ repository: 'a/b', pad: 'x'.repeat(10_000) })).status, 413);
      const wrongType = await fetch(`${base}/api/investigate`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'a/b' });
      assert.equal(wrongType.status, 400);
      const malformed = await fetch(`${base}/api/investigate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
      assert.equal(malformed.status, 400);
    });

    it('rejects other methods and unknown API routes', async () => {
      assert.equal((await fetch(`${base}/api/investigate`)).status, 405);
      assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
    });

    it('sets security headers and refuses path traversal', async () => {
      const res = await fetch(`${base}/`);
      assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });
  });

  describe('with stubbed services', () => {
    before(() =>
      start({
        geminiApiKey: 'test-key-123456',
        github: githubStub(),
        analyze: async (bundle) => analysisFor(bundle.evidence.length),
      }),
    );
    after(stop);

    it('streams stage events and then a result', async () => {
      const res = await post({ repository: 'acme/demo' });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /ndjson/);
      const lines = (await res.text()).trim().split('\n').map((line) => JSON.parse(line) as ProgressEvent);
      assert.equal(lines[0]?.type, 'stage');
      assert.equal(lines[lines.length - 1]?.type, 'result');
    });
  });

  describe('rate limiting', () => {
    before(() => start({ geminiApiKey: 'test-key-123456', rateLimitMax: 2 }));
    after(stop);

    it('limits repeated requests from one client', async () => {
      assert.equal((await post({ repository: 'bad' })).status, 400);
      assert.equal((await post({ repository: 'bad' })).status, 400);
      const res = await post({ repository: 'bad' });
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    });
  });
});
