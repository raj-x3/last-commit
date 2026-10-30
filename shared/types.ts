// Types shared by the server and the browser bundle. Types only: no runtime code here.

export type ErrorCode =
  | 'invalid_input'
  | 'bad_request'
  | 'payload_too_large'
  | 'too_many_requests'
  | 'repo_not_found'
  | 'repo_private'
  | 'github_rate_limited'
  | 'github_timeout'
  | 'github_unavailable'
  | 'github_response_too_large'
  | 'missing_api_key'
  | 'model_auth'
  | 'model_unavailable'
  | 'model_rate_limited'
  | 'model_timeout'
  | 'model_error'
  | 'model_invalid_output'
  | 'not_found'
  | 'internal';

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  hint?: string;
  retryAfterSeconds?: number;
  details?: string[];
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoMeta {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  license: string | null;
  topics: string[];
  stars: number;
  forks: number;
  /** GitHub's count. It includes open pull requests. */
  openIssuesCount: number;
  archived: boolean;
  isFork: boolean;
  defaultBranch: string;
  createdAt: string | null;
  pushedAt: string | null;
}

export interface CommitItem {
  sha: string;
  shortSha: string;
  date: string | null;
  message: string;
  url: string;
}

export interface IssueItem {
  number: number;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  labels: string[];
  comments: number;
  url: string;
}

export interface ReadmeData {
  path: string;
  /** Decoded text, truncated to the model-input limit. */
  text: string;
  truncated: boolean;
  totalChars: number;
  url: string;
}

export type SectionStatus = 'ok' | 'empty' | 'missing' | 'unavailable';

export interface SourceSection {
  status: SectionStatus;
  detail: string;
  count: number;
}

export interface SourceSections {
  commits: SourceSection;
  readme: SourceSection;
  issues: SourceSection;
}

export type ActivityCategory =
  | 'recently_active'
  | 'quieter'
  | 'little_recent_activity'
  | 'archived'
  | 'unknown';

export interface CommitWindow {
  days: number;
  count: number;
  /** True when the sampled history ends inside the window, so the real count may be higher. */
  atLeast: boolean;
}

export interface ActivitySignal {
  category: ActivityCategory;
  label: string;
  rule: string;
  createdAt: string | null;
  lastPushAt: string | null;
  daysSincePush: number | null;
  lastCommitAt: string | null;
  daysSinceLastCommit: number | null;
  sampleSize: number;
  windows: CommitWindow[];
  caveats: string[];
}

export type EvidenceSourceType = 'metadata' | 'activity' | 'readme' | 'commit' | 'issue' | 'status';

export interface EvidenceRecord {
  id: string;
  sourceType: EvidenceSourceType;
  title: string;
  date: string | null;
  excerpt: string;
  url: string;
  /** True for values the server computed from GitHub timestamps rather than copied from a response. */
  derived: boolean;
}

export type FindingType = 'positive' | 'concern' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';
export type MissionBasis = 'evidence-based' | 'general-exploration';

export interface Finding {
  title: string;
  type: FindingType;
  explanation: string;
  evidenceIds: string[];
  confidence: Confidence;
  verificationStep: string;
  /** False when none of the cited evidence IDs resolved against the server's records. */
  supported: boolean;
}

export interface Mission {
  title: string;
  difficulty: Difficulty;
  basis: MissionBasis;
  reason: string;
  steps: string[];
  evidenceIds: string[];
  requiresVerification: boolean;
  verificationNote: string;
}

export interface Analysis {
  repositorySummary: string;
  activityInterpretation: {
    assessment: string;
    reasoning: string;
    evidenceIds: string[];
    supported: boolean;
  };
  findings: Finding[];
  missions: Mission[];
  revivalPlan: string[];
}

export interface InvestigationReport {
  repository: RepoMeta;
  activity: ActivitySignal;
  sections: SourceSections;
  evidence: EvidenceRecord[];
  analysis: Analysis;
  warnings: string[];
  model: { id: string; via: string; attempts: number };
  generatedAt: string;
}

export type Stage = 'repository' | 'commits' | 'readme' | 'issues' | 'analysis';
export type StageState = 'running' | 'done' | 'empty' | 'unavailable' | 'failed';

export type ProgressEvent =
  | { type: 'stage'; stage: Stage; state: StageState; detail?: string; ms?: number }
  | { type: 'result'; report: InvestigationReport }
  | { type: 'error'; error: ApiErrorBody };

export interface HealthBody {
  status: 'ok';
  model: string;
  modelConfigured: boolean;
  githubTokenConfigured: boolean;
}
