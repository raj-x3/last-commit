import type { Stage } from '../shared/types.ts';

export const STAGES: Stage[] = ['repository', 'commits', 'readme', 'issues', 'analysis'];

export const STAGE_LABELS: Record<Stage, string> = {
  repository: 'Repository metadata',
  commits: 'Recent commits',
  readme: 'README',
  issues: 'Open issues',
  analysis: 'Gemma analysis and validation',
};

const numberFormat = new Intl.NumberFormat('en');

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

export function ago(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30.44)} months ago`;
  return `${(days / 365.25).toFixed(1)} years ago`;
}

export function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}
