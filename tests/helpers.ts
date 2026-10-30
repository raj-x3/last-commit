import { computeActivity } from '../server/activity.ts';
import { buildEvidence } from '../server/evidence.ts';
import type { EvidenceBundle } from '../server/prompt.ts';
import type { CommitItem, EvidenceRecord, RepoMeta, SourceSections } from '../shared/types.ts';

export const SHA = 'a'.repeat(40);

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export type Handler = (url: URL) => Response | Promise<Response>;

/** A fetch stand-in that records every URL it receives. */
export function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.toString());
    return handler(url);
  }) as typeof fetch;
  return { impl, calls };
}

export const repoJson = {
  name: 'demo',
  private: false,
  description: 'A demo repository',
  language: 'TypeScript',
  license: { spdx_id: 'MIT', name: 'MIT License' },
  topics: ['demo'],
  stargazers_count: 12,
  forks_count: 3,
  open_issues_count: 4,
  archived: false,
  fork: false,
  default_branch: 'main',
  created_at: '2020-01-01T00:00:00Z',
  pushed_at: '2024-01-01T00:00:00Z',
  owner: { login: 'acme' },
};

export const evidence: EvidenceRecord[] = ['E01', 'E02', 'E03'].map((id) => ({
  id,
  sourceType: 'metadata',
  title: `Record ${id}`,
  date: null,
  excerpt: 'excerpt',
  url: 'https://github.com/acme/demo',
  derived: false,
}));

export const validIds = new Set(evidence.map((record) => record.id));

export function validAnalysis(): Record<string, unknown> {
  return {
    repositorySummary: 'Demo does a thing, according to its README.',
    activityInterpretation: { assessment: 'Quiet.', reasoning: 'Last push was in 2024.', evidenceIds: ['E01'] },
    findings: [
      {
        title: 'README present',
        type: 'positive',
        explanation: 'A README is available.',
        evidenceIds: ['E02'],
        confidence: 'high',
        verificationStep: 'Read the README.',
      },
    ],
    missions: [1, 2, 3].map((n) => ({
      title: `Mission ${n}`,
      difficulty: n === 1 ? 'Beginner' : 'Intermediate',
      basis: 'evidence-based',
      reason: 'Because the evidence shows it.',
      steps: ['Read the code', 'Make a small change'],
      evidenceIds: ['E03'],
      requiresVerification: true,
      verificationNote: 'Check that the issue is still open.',
    })),
    revivalPlan: ['Read the README', 'Check open issues', 'Make one small change'],
  };
}

/** A commit as GitHub reports it, with a deterministic 40-character SHA derived from n. */
export function commit(n: number, date: string): CommitItem {
  const sha = n.toString(16).padStart(40, '0');
  return { sha, shortSha: sha.slice(0, 7), date, message: `commit ${n}`, url: `https://github.com/acme/widget/commit/${sha}` };
}

/** A realistic evidence bundle for acme/widget: README and commits present, open issues empty. */
export function makeBundle(): EvidenceBundle {
  const repository: RepoMeta = {
    owner: 'acme',
    name: 'widget',
    fullName: 'acme/widget',
    url: 'https://github.com/acme/widget',
    description: 'A widget library',
    language: 'TypeScript',
    license: 'MIT',
    topics: ['widgets'],
    stars: 10,
    forks: 2,
    openIssuesCount: 3,
    archived: false,
    isFork: false,
    defaultBranch: 'main',
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: '2026-09-01T00:00:00Z',
  };
  const commits = [commit(1, '2026-09-01T00:00:00Z'), commit(2, '2026-08-01T00:00:00Z')];
  const readme = {
    path: 'README.md',
    text: '# Widget\nA widget library.',
    truncated: false,
    totalChars: 26,
    url: 'https://github.com/acme/widget#readme',
  };
  const sections: SourceSections = {
    commits: { status: 'ok', detail: '2 recent commits sampled from the default branch.', count: 2 },
    readme: { status: 'ok', detail: 'README found (README.md, 26 characters).', count: 1 },
    issues: { status: 'empty', detail: 'No open issues (pull requests excluded).', count: 0 },
  };
  const activity = computeActivity({
    archived: false,
    createdAt: repository.createdAt,
    pushedAt: repository.pushedAt,
    commits,
    now: Date.parse('2026-10-01T00:00:00Z'),
  });
  const evidence = buildEvidence({ meta: repository, activity, readme, commits, issues: [], sections });
  return { repository, activity, sections, evidence, readme };
}

/** A schema-valid model response whose evidence IDs exist in makeBundle(). */
export function validAnalysisJson(): Record<string, unknown> {
  const analysis = validAnalysis();
  (analysis.activityInterpretation as any).evidenceIds = ['E01', 'E02'];
  (analysis.findings as any[])[0].evidenceIds = ['E01', 'E03'];
  (analysis.missions as any[]).forEach((mission, index) => (mission.evidenceIds = [index === 0 ? 'E03' : 'E04']));
  return analysis;
}
