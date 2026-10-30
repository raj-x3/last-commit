import type { Analysis, Confidence, Difficulty, Finding, FindingType, Mission, MissionBasis } from '../shared/types.ts';
import { cleanBlock, cleanLine } from './text.ts';

export const LIMITS = {
  summary: 1500,
  assessment: 500,
  reasoning: 1200,
  title: 140,
  explanation: 1000,
  verification: 400,
  reason: 700,
  step: 300,
  note: 500,
  plan: 300,
  findingsMin: 1,
  findingsMax: 8,
  missions: 3,
  stepsMin: 2,
  stepsMax: 6,
  planMin: 3,
  planMax: 6,
} as const;

export const MAX_MODEL_OUTPUT_CHARS = 60_000;

const FINDING_TYPES: readonly FindingType[] = ['positive', 'concern', 'unknown'];
const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high'];
const DIFFICULTIES: readonly Difficulty[] = ['Beginner', 'Intermediate', 'Advanced'];
const BASES: readonly MissionBasis[] = ['evidence-based', 'general-exploration'];

export interface ValidationOk {
  ok: true;
  analysis: Analysis;
  warnings: string[];
}
export interface ValidationFail {
  ok: false;
  errors: string[];
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class Collector {
  errors: string[] = [];
  warnings: string[] = [];
  valid: ReadonlySet<string>;

  constructor(valid: ReadonlySet<string>) {
    this.valid = valid;
  }

  text(obj: Obj, key: string, path: string, max: number, multiline = false): string {
    const raw = obj[key];
    if (typeof raw !== 'string') {
      this.errors.push(`${path}.${key} must be a string.`);
      return '';
    }
    const value = multiline ? cleanBlock(raw, Number.MAX_SAFE_INTEGER) : cleanLine(raw, Number.MAX_SAFE_INTEGER);
    if (value.length === 0) this.errors.push(`${path}.${key} must not be empty.`);
    else if (value.length > max) this.errors.push(`${path}.${key} is ${value.length} characters; the limit is ${max}.`);
    return value;
  }

  oneOf<T extends string>(obj: Obj, key: string, path: string, allowed: readonly T[]): T | null {
    const raw = obj[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    const match = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
    if (!match) this.errors.push(`${path}.${key} must be one of: ${allowed.join(', ')}.`);
    return match ?? null;
  }

  ids(obj: Obj, path: string): string[] {
    const raw = obj.evidenceIds;
    if (!Array.isArray(raw)) {
      this.errors.push(`${path}.evidenceIds must be an array of evidence IDs.`);
      return [];
    }
    const kept: string[] = [];
    for (const entry of raw) {
      const id = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
      if (this.valid.has(id)) {
        if (!kept.includes(id)) kept.push(id);
      } else {
        this.warnings.push(`${path}: ignored unknown evidence ID "${cleanLine(String(entry), 20)}".`);
      }
    }
    return kept;
  }

  list(obj: Obj, key: string, path: string, min: number, max: number, maxLength: number): string[] {
    const raw = obj[key];
    if (!Array.isArray(raw)) {
      this.errors.push(`${path}.${key} must be an array.`);
      return [];
    }
    if (raw.length < min || raw.length > max) {
      this.errors.push(`${path}.${key} must contain ${min} to ${max} items; it has ${raw.length}.`);
    }
    const out: string[] = [];
    raw.slice(0, max).forEach((entry, index) => {
      if (typeof entry !== 'string') {
        this.errors.push(`${path}.${key}[${index}] must be a string.`);
        return;
      }
      const value = cleanLine(entry, Number.MAX_SAFE_INTEGER);
      if (value.length === 0) this.errors.push(`${path}.${key}[${index}] must not be empty.`);
      else if (value.length > maxLength) {
        this.errors.push(`${path}.${key}[${index}] is ${value.length} characters; the limit is ${maxLength}.`);
      } else out.push(value);
    });
    return out;
  }
}

/**
 * Validates the model's JSON against the report schema. Unknown fields are dropped, unknown
 * evidence IDs are removed, and claims that cite no valid evidence are flagged as unsupported.
 */
export function validateAnalysis(raw: unknown, validIds: ReadonlySet<string>): ValidationOk | ValidationFail {
  const c = new Collector(validIds);
  if (!isObj(raw)) return { ok: false, errors: ['The response must be a JSON object.'] };

  const repositorySummary = c.text(raw, 'repositorySummary', '$', LIMITS.summary, true);

  let activityInterpretation: Analysis['activityInterpretation'] = {
    assessment: '',
    reasoning: '',
    evidenceIds: [],
    supported: false,
  };
  if (!isObj(raw.activityInterpretation)) {
    c.errors.push('$.activityInterpretation must be an object.');
  } else {
    const ai = raw.activityInterpretation;
    const evidenceIds = c.ids(ai, '$.activityInterpretation');
    activityInterpretation = {
      assessment: c.text(ai, 'assessment', '$.activityInterpretation', LIMITS.assessment),
      reasoning: c.text(ai, 'reasoning', '$.activityInterpretation', LIMITS.reasoning, true),
      evidenceIds,
      supported: evidenceIds.length > 0,
    };
    if (!activityInterpretation.supported) {
      c.warnings.push('$.activityInterpretation: no valid evidence cited; shown as unsupported.');
    }
  }

  const findings: Finding[] = [];
  if (!Array.isArray(raw.findings)) {
    c.errors.push('$.findings must be an array.');
  } else {
    if (raw.findings.length < LIMITS.findingsMin || raw.findings.length > LIMITS.findingsMax) {
      c.errors.push(
        `$.findings must contain ${LIMITS.findingsMin} to ${LIMITS.findingsMax} items; it has ${raw.findings.length}.`,
      );
    }
    raw.findings.slice(0, LIMITS.findingsMax).forEach((entry, index) => {
      const path = `$.findings[${index}]`;
      if (!isObj(entry)) {
        c.errors.push(`${path} must be an object.`);
        return;
      }
      const evidenceIds = c.ids(entry, path);
      const type = c.oneOf(entry, 'type', path, FINDING_TYPES);
      let confidence = c.oneOf(entry, 'confidence', path, CONFIDENCES);
      const supported = evidenceIds.length > 0;
      if (!supported) {
        c.warnings.push(`${path}: no valid evidence cited; shown as unsupported.`);
        confidence = 'low';
      }
      const finding = {
        title: c.text(entry, 'title', path, LIMITS.title),
        type,
        explanation: c.text(entry, 'explanation', path, LIMITS.explanation, true),
        evidenceIds,
        confidence,
        verificationStep: c.text(entry, 'verificationStep', path, LIMITS.verification),
        supported,
      };
      if (finding.type && finding.confidence) findings.push(finding as Finding);
    });
  }

  const missions: Mission[] = [];
  if (!Array.isArray(raw.missions)) {
    c.errors.push('$.missions must be an array.');
  } else {
    if (raw.missions.length !== LIMITS.missions) {
      c.errors.push(`$.missions must contain exactly ${LIMITS.missions} items; it has ${raw.missions.length}.`);
    }
    raw.missions.slice(0, LIMITS.missions).forEach((entry, index) => {
      const path = `$.missions[${index}]`;
      if (!isObj(entry)) {
        c.errors.push(`${path} must be an object.`);
        return;
      }
      const evidenceIds = c.ids(entry, path);
      const difficulty = c.oneOf(entry, 'difficulty', path, DIFFICULTIES);
      let basis: MissionBasis = evidenceIds.length > 0 ? 'evidence-based' : 'general-exploration';
      if (entry.basis !== undefined) {
        const declared = c.oneOf(entry, 'basis', path, BASES);
        if (declared === 'evidence-based' && evidenceIds.length === 0) {
          c.warnings.push(`${path}: marked evidence-based without valid evidence; shown as a general exploration task.`);
        } else if (declared) {
          basis = declared;
        }
      }
      const mission = {
        title: c.text(entry, 'title', path, LIMITS.title),
        difficulty,
        basis,
        reason: c.text(entry, 'reason', path, LIMITS.reason, true),
        steps: c.list(entry, 'steps', path, LIMITS.stepsMin, LIMITS.stepsMax, LIMITS.step),
        evidenceIds,
        requiresVerification: true,
        verificationNote: c.text(entry, 'verificationNote', path, LIMITS.note),
      };
      if (mission.difficulty) missions.push(mission as Mission);
    });
  }

  const revivalPlan = c.list(raw, 'revivalPlan', '$', LIMITS.planMin, LIMITS.planMax, LIMITS.plan);

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return {
    ok: true,
    analysis: { repositorySummary, activityInterpretation, findings, missions, revivalPlan },
    warnings: c.warnings,
  };
}
