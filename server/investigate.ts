import type {
  CommitItem,
  InvestigationReport,
  IssueItem,
  ProgressEvent,
  ReadmeData,
  RepoMeta,
  RepoRef,
  SourceSection,
  SourceSections,
  Stage,
} from '../shared/types.ts';
import { computeActivity } from './activity.ts';
import { AppError } from './errors.ts';
import { buildEvidence } from './evidence.ts';
import { GEMMA_MODEL_ID, MODEL_VIA, type GemmaResult } from './gemma.ts';
import type { GithubClient } from './github.ts';
import type { EvidenceBundle } from './prompt.ts';

export interface InvestigateDeps {
  github: GithubClient;
  analyze: (bundle: EvidenceBundle) => Promise<GemmaResult>;
  now?: () => number;
}

type Emit = (event: ProgressEvent) => void;

function reasonOf(err: unknown): string {
  return err instanceof AppError ? err.message.replace(/\.$/, '') : 'unexpected error';
}

/**
 * Runs one investigation: GitHub metadata first, then commits, README and issues concurrently
 * (each may fail without ending the run), then the Gemma analysis. Progress events are emitted
 * only when a stage actually starts or finishes.
 */
export async function investigate(ref: RepoRef, deps: InvestigateDeps, emit: Emit): Promise<InvestigationReport> {
  const now = deps.now ?? Date.now;
  const clock = () => Date.now();
  let current: Stage = 'repository';

  try {
    let startedAt = clock();
    emit({ type: 'stage', stage: 'repository', state: 'running' });
    const meta: RepoMeta = await deps.github.fetchRepository(ref);
    emit({ type: 'stage', stage: 'repository', state: 'done', detail: meta.fullName, ms: clock() - startedAt });

    const canonical: RepoRef = { owner: meta.owner, repo: meta.name };
    const sectionStart = clock();

    emit({ type: 'stage', stage: 'commits', state: 'running' });
    emit({ type: 'stage', stage: 'readme', state: 'running' });
    emit({ type: 'stage', stage: 'issues', state: 'running' });

    const commitsTask = deps.github.fetchCommits(canonical).then(
      (commits): { commits: CommitItem[] | null; section: SourceSection } => {
        const section: SourceSection =
          commits.length > 0
            ? { status: 'ok', detail: `${commits.length} recent commits sampled from the default branch.`, count: commits.length }
            : { status: 'empty', detail: 'GitHub returned no commits for this repository.', count: 0 };
        emit({ type: 'stage', stage: 'commits', state: section.status === 'ok' ? 'done' : 'empty', detail: section.detail, ms: clock() - sectionStart });
        return { commits, section };
      },
      (err: unknown) => {
        const section: SourceSection = { status: 'unavailable', detail: `Commits could not be retrieved: ${reasonOf(err)}.`, count: 0 };
        emit({ type: 'stage', stage: 'commits', state: 'unavailable', detail: section.detail, ms: clock() - sectionStart });
        return { commits: null, section };
      },
    );

    const readmeTask = deps.github.fetchReadme(canonical).then(
      (readme): { readme: ReadmeData | null; section: SourceSection } => {
        const section: SourceSection = readme
          ? {
              status: 'ok',
              detail: `README found (${readme.path}, ${readme.totalChars} characters${readme.truncated ? ', truncated for analysis' : ''}).`,
              count: 1,
            }
          : { status: 'missing', detail: 'GitHub reports no README for this repository.', count: 0 };
        emit({ type: 'stage', stage: 'readme', state: readme ? 'done' : 'empty', detail: section.detail, ms: clock() - sectionStart });
        return { readme, section };
      },
      (err: unknown) => {
        const section: SourceSection = { status: 'unavailable', detail: `README could not be retrieved: ${reasonOf(err)}.`, count: 0 };
        emit({ type: 'stage', stage: 'readme', state: 'unavailable', detail: section.detail, ms: clock() - sectionStart });
        return { readme: null, section };
      },
    );

    const issuesTask = deps.github.fetchIssues(canonical).then(
      ({ issues, scanned }): { issues: IssueItem[] | null; section: SourceSection } => {
        const scope = `among the ${scanned} most recently updated open items`;
        const section: SourceSection =
          issues.length > 0
            ? { status: 'ok', detail: `${issues.length} open issues (pull requests excluded) ${scope}.`, count: issues.length }
            : {
                status: 'empty',
                detail:
                  scanned === 0
                    ? 'GitHub returned no open issues or pull requests.'
                    : `No open issues (pull requests excluded) ${scope}.`,
                count: 0,
              };
        emit({ type: 'stage', stage: 'issues', state: issues.length > 0 ? 'done' : 'empty', detail: section.detail, ms: clock() - sectionStart });
        return { issues, section };
      },
      (err: unknown) => {
        const section: SourceSection = { status: 'unavailable', detail: `Open issues could not be retrieved: ${reasonOf(err)}.`, count: 0 };
        emit({ type: 'stage', stage: 'issues', state: 'unavailable', detail: section.detail, ms: clock() - sectionStart });
        return { issues: null, section };
      },
    );

    const [commitsResult, readmeResult, issuesResult] = await Promise.all([commitsTask, readmeTask, issuesTask]);
    const sections: SourceSections = {
      commits: commitsResult.section,
      readme: readmeResult.section,
      issues: issuesResult.section,
    };

    const activity = computeActivity({
      archived: meta.archived,
      createdAt: meta.createdAt,
      pushedAt: meta.pushedAt,
      commits: commitsResult.commits,
      now: now(),
    });
    const evidence = buildEvidence({
      meta,
      activity,
      readme: readmeResult.readme,
      commits: commitsResult.commits,
      issues: issuesResult.issues,
      sections,
    });

    current = 'analysis';
    startedAt = clock();
    emit({ type: 'stage', stage: 'analysis', state: 'running', detail: `${GEMMA_MODEL_ID} via ${MODEL_VIA}` });
    const result = await deps.analyze({ repository: meta, activity, sections, evidence, readme: readmeResult.readme });
    emit({
      type: 'stage',
      stage: 'analysis',
      state: 'done',
      detail: result.attempts === 1 ? 'Output validated.' : `Output validated on attempt ${result.attempts}.`,
      ms: clock() - startedAt,
    });

    return {
      repository: meta,
      activity,
      sections,
      evidence,
      analysis: result.analysis,
      warnings: result.warnings,
      model: { id: GEMMA_MODEL_ID, via: MODEL_VIA, attempts: result.attempts },
      generatedAt: new Date(now()).toISOString(),
    };
  } catch (err) {
    emit({
      type: 'stage',
      stage: current,
      state: 'failed',
      detail: err instanceof AppError ? err.message : 'Unexpected error.',
    });
    throw err;
  }
}
