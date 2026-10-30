import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAnalysis } from '../server/validate.ts';
import { validAnalysis, validIds } from './helpers.ts';

function errorsFor(mutate: (a: Record<string, any>) => void): string[] {
  const analysis = validAnalysis();
  mutate(analysis);
  const result = validateAnalysis(analysis, validIds);
  assert.equal(result.ok, false, 'expected validation to fail');
  return result.ok ? [] : result.errors;
}

describe('validateAnalysis: structure', () => {
  it('accepts a well-formed analysis', () => {
    const result = validateAnalysis(validAnalysis(), validIds);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.analysis.missions.length, 3);
      assert.equal(result.analysis.findings[0]?.supported, true);
      assert.deepEqual(result.warnings, []);
    }
  });

  it('rejects non-objects', () => {
    for (const value of [null, 'text', 42, [], undefined]) {
      assert.equal(validateAnalysis(value, validIds).ok, false);
    }
  });

  it('rejects a missing required field', () => {
    assert.ok(errorsFor((a) => delete a.repositorySummary).some((e) => e.includes('repositorySummary')));
    assert.ok(errorsFor((a) => delete a.revivalPlan).some((e) => e.includes('revivalPlan')));
    assert.ok(errorsFor((a) => delete a.activityInterpretation).some((e) => e.includes('activityInterpretation')));
  });

  it('rejects wrong field types', () => {
    assert.ok(errorsFor((a) => (a.repositorySummary = 12)).length > 0);
    assert.ok(errorsFor((a) => (a.findings = 'none')).length > 0);
    assert.ok(errorsFor((a) => (a.findings[0].evidenceIds = 'E01')).length > 0);
  });

  it('rejects unsupported enum values', () => {
    assert.ok(errorsFor((a) => (a.findings[0].type = 'bug')).some((e) => e.includes('type')));
    assert.ok(errorsFor((a) => (a.findings[0].confidence = 'certain')).some((e) => e.includes('confidence')));
    assert.ok(errorsFor((a) => (a.missions[0].difficulty = 'Expert')).some((e) => e.includes('difficulty')));
  });

  it('accepts enum values that differ only in case', () => {
    const analysis = validAnalysis();
    (analysis.missions as any[])[0].difficulty = 'beginner';
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok && result.analysis.missions[0]?.difficulty, 'Beginner');
  });

  it('enforces exactly three missions', () => {
    assert.ok(errorsFor((a) => a.missions.pop()).some((e) => e.includes('exactly 3')));
    assert.ok(errorsFor((a) => a.missions.push({ ...a.missions[0] })).some((e) => e.includes('exactly 3')));
  });

  it('enforces list sizes', () => {
    assert.ok(errorsFor((a) => (a.findings = [])).length > 0);
    assert.ok(errorsFor((a) => (a.missions[0].steps = ['only one'])).length > 0);
    assert.ok(errorsFor((a) => (a.revivalPlan = ['one', 'two'])).length > 0);
  });

  it('enforces text limits', () => {
    assert.ok(errorsFor((a) => (a.repositorySummary = 'x'.repeat(1501))).some((e) => e.includes('limit')));
    assert.ok(errorsFor((a) => (a.findings[0].title = 'x'.repeat(141))).some((e) => e.includes('limit')));
    assert.ok(errorsFor((a) => (a.missions[0].steps[0] = 'x'.repeat(301))).some((e) => e.includes('limit')));
  });

  it('rejects empty strings', () => {
    assert.ok(errorsFor((a) => (a.findings[0].title = '   ')).some((e) => e.includes('empty')));
  });

  it('forces requiresVerification on and drops unknown fields', () => {
    const analysis = validAnalysis();
    (analysis.missions as any[])[0].requiresVerification = false;
    (analysis as any).extra = 'ignored';
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.analysis.missions[0]?.requiresVerification, true);
      assert.equal('extra' in result.analysis, false);
    }
  });

  it('strips control and bidirectional override characters from text', () => {
    const analysis = validAnalysis();
    analysis.repositorySummary = 'Safe‮ text\u0007 here';
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok && result.analysis.repositorySummary, 'Safe text here');
  });
});

describe('validateAnalysis: evidence references', () => {
  it('removes unknown evidence IDs and reports them', () => {
    const analysis = validAnalysis();
    (analysis.findings as any[])[0].evidenceIds = ['E02', 'E99', 'https://evil.example'];
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.analysis.findings[0]?.evidenceIds, ['E02']);
      assert.equal(result.warnings.filter((w) => w.includes('unknown evidence ID')).length, 2);
    }
  });

  it('normalises case, trims, and de-duplicates IDs', () => {
    const analysis = validAnalysis();
    (analysis.findings as any[])[0].evidenceIds = ['e01', ' E01 ', 'E01'];
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok && result.analysis.findings[0]?.evidenceIds.join(','), 'E01');
  });

  it('marks a finding unsupported, with low confidence, when no cited ID resolves', () => {
    const analysis = validAnalysis();
    (analysis.findings as any[])[0].evidenceIds = ['E50'];
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.analysis.findings[0]?.supported, false);
      assert.equal(result.analysis.findings[0]?.confidence, 'low');
    }
  });

  it('downgrades an evidence-based mission with no valid evidence to general exploration', () => {
    const analysis = validAnalysis();
    (analysis.missions as any[])[0].evidenceIds = ['E77'];
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok && result.analysis.missions[0]?.basis, 'general-exploration');
  });

  it('flags an activity interpretation that cites nothing valid', () => {
    const analysis = validAnalysis();
    (analysis.activityInterpretation as any).evidenceIds = [];
    const result = validateAnalysis(analysis, validIds);
    assert.equal(result.ok && result.analysis.activityInterpretation.supported, false);
  });
});
