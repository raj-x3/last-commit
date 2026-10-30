import type {
  ActivitySignal,
  CommitItem,
  EvidenceRecord,
  EvidenceSourceType,
  IssueItem,
  ReadmeData,
  RepoMeta,
  SourceSections,
} from '../shared/types.ts';
import { cleanLine, truncate } from './text.ts';

export const EVIDENCE_COMMITS = 8;
export const EVIDENCE_ISSUES = 8;

export interface EvidenceInput {
  meta: RepoMeta;
  activity: ActivitySignal;
  readme: ReadmeData | null;
  /** Null when the commit list could not be retrieved. */
  commits: CommitItem[] | null;
  /** Null when the issue list could not be retrieved. */
  issues: IssueItem[] | null;
  sections: SourceSections;
}

function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

/**
 * Builds the evidence records the model may cite. IDs are assigned here, in a fixed order,
 * and every URL is constructed from validated owner/repository values or GitHub identifiers.
 */
export function buildEvidence(input: EvidenceInput): EvidenceRecord[] {
  const { meta, activity, readme, commits, issues, sections } = input;
  const records: EvidenceRecord[] = [];
  const add = (
    sourceType: EvidenceSourceType,
    title: string,
    date: string | null,
    excerpt: string,
    url: string,
    derived = false,
  ) => {
    records.push({
      id: `E${String(records.length + 1).padStart(2, '0')}`,
      sourceType,
      title: truncate(title, 120),
      date,
      excerpt: truncate(excerpt, 600),
      url,
      derived,
    });
  };

  add(
    'metadata',
    `${meta.fullName} repository metadata`,
    meta.pushedAt,
    [
      `Description: ${meta.description ?? 'none'}`,
      `Language: ${meta.language ?? 'not reported'}`,
      `License: ${meta.license ?? 'not reported'}`,
      `Stars: ${meta.stars}`,
      `Forks: ${meta.forks}`,
      `Open issues and pull requests (GitHub count): ${meta.openIssuesCount}`,
      `Default branch: ${meta.defaultBranch}`,
      `Created: ${dateOnly(meta.createdAt)}`,
      `Last push: ${dateOnly(meta.pushedAt)}`,
      `Archived: ${meta.archived ? 'yes' : 'no'}`,
      `Fork: ${meta.isFork ? 'yes' : 'no'}`,
    ].join('; '),
    meta.url,
  );

  const windowText = activity.windows
    .map((w) => `${w.atLeast ? 'at least ' : ''}${w.count} in the last ${w.days} days`)
    .join(', ');
  add(
    'activity',
    'Activity signal (computed from GitHub timestamps)',
    activity.lastPushAt,
    [
      `${activity.label}.`,
      activity.daysSincePush !== null
        ? `Last push ${dateOnly(activity.lastPushAt)} (${activity.daysSincePush} days ago).`
        : 'Last push date unavailable.',
      activity.lastCommitAt
        ? `Latest sampled default-branch commit ${dateOnly(activity.lastCommitAt)} (${activity.daysSinceLastCommit} days ago).`
        : 'No dated commits in the sample.',
      windowText ? `Sampled commits: ${windowText}.` : '',
      ...activity.caveats,
    ]
      .filter(Boolean)
      .join(' '),
    `${meta.url}/commits`,
    true,
  );

  if (readme) {
    add('readme', `README (${readme.path})`, null, cleanLine(readme.text, 400), readme.url);
  } else {
    add('status', sections.readme.status === 'missing' ? 'No README found' : 'README not available', null, sections.readme.detail, meta.url);
  }

  if (commits && commits.length > 0) {
    for (const commit of commits.slice(0, EVIDENCE_COMMITS)) {
      add('commit', `Commit ${commit.shortSha}`, commit.date, commit.message, commit.url);
    }
  } else {
    add('status', sections.commits.status === 'empty' ? 'No commits found' : 'Commit history not available', null, sections.commits.detail, `${meta.url}/commits`);
  }

  if (issues && issues.length > 0) {
    for (const issue of issues.slice(0, EVIDENCE_ISSUES)) {
      const labels = issue.labels.length > 0 ? ` Labels: ${issue.labels.join(', ')}.` : ' No labels.';
      add(
        'issue',
        `Issue #${issue.number}`,
        issue.updatedAt,
        `${issue.title}.${labels} Comments: ${issue.comments}. Opened ${dateOnly(issue.createdAt)}.`,
        issue.url,
      );
    }
  } else {
    add('status', sections.issues.status === 'empty' ? 'No open issues found' : 'Open issues not available', null, sections.issues.detail, `${meta.url}/issues`);
  }

  return records;
}
