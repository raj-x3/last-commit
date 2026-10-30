import type { ActivityCategory, ActivitySignal, CommitItem, CommitWindow } from '../shared/types.ts';
import { COMMIT_SAMPLE_SIZE } from './github.ts';

export const ACTIVITY_RULE =
  'Based on the last push timestamp: 90 days or fewer is recently active, 91 to 365 days is quieter, and more than 365 days is little recent activity. Archived repositories are labelled archived regardless of dates. These are heuristics, not a verdict on whether a project is maintained.';

const LABELS: Record<ActivityCategory, string> = {
  recently_active: 'Recently active',
  quieter: 'Quieter',
  little_recent_activity: 'Little recent activity',
  archived: 'Archived by owner',
  unknown: 'Unknown',
};

const DAY_MS = 86_400_000;
const WINDOW_DAYS = [90, 365];

export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

export interface ActivityInput {
  archived: boolean;
  createdAt: string | null;
  pushedAt: string | null;
  /** Null when the commit list could not be retrieved. */
  commits: CommitItem[] | null;
  now: number;
}

export function computeActivity(input: ActivityInput): ActivitySignal {
  const { archived, createdAt, pushedAt, commits, now } = input;
  const daysSincePush = daysSince(pushedAt, now);

  let category: ActivityCategory;
  if (archived) category = 'archived';
  else if (daysSincePush === null) category = 'unknown';
  else if (daysSincePush <= 90) category = 'recently_active';
  else if (daysSincePush <= 365) category = 'quieter';
  else category = 'little_recent_activity';

  const caveats: string[] = [];
  const dated = (commits ?? [])
    .map((commit) => commit.date)
    .filter((date): date is string => date !== null)
    .map((date) => Date.parse(date))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a);

  const lastCommitTime = dated[0];
  const lastCommitAt = lastCommitTime !== undefined ? new Date(lastCommitTime).toISOString() : null;
  const daysSinceLastCommit = lastCommitAt ? daysSince(lastCommitAt, now) : null;

  let windows: CommitWindow[] = [];
  if (commits === null) {
    caveats.push('Commit history could not be retrieved, so this signal rests on the push timestamp alone.');
  } else if (commits.length === 0) {
    caveats.push('GitHub returned no commits for this repository.');
  } else {
    const oldest = dated[dated.length - 1];
    const sampleFull = commits.length >= COMMIT_SAMPLE_SIZE;
    windows = WINDOW_DAYS.map((days) => {
      const cutoff = now - days * DAY_MS;
      const count = dated.filter((time) => time >= cutoff).length;
      const historyEndsInsideWindow = sampleFull && oldest !== undefined && oldest >= cutoff;
      return { days, count, atLeast: historyEndsInsideWindow };
    });
    if (sampleFull) {
      caveats.push(`Commit counts come from the ${COMMIT_SAMPLE_SIZE} most recent commits on the default branch only.`);
    }
    if (pushedAt && lastCommitAt) {
      const gapDays = (Date.parse(pushedAt) - Date.parse(lastCommitAt)) / DAY_MS;
      if (gapDays > 30) {
        caveats.push(
          'The last push is more than 30 days newer than the latest default-branch commit. Pushes to other branches or tags also update the push timestamp.',
        );
      }
    }
  }
  if (daysSincePush === null) caveats.push('GitHub did not return a usable last push date.');

  return {
    category,
    label: LABELS[category],
    rule: ACTIVITY_RULE,
    createdAt,
    lastPushAt: pushedAt,
    daysSincePush,
    lastCommitAt,
    daysSinceLastCommit,
    sampleSize: commits?.length ?? 0,
    windows,
    caveats,
  };
}
