import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../server/errors.ts';
import { analyzeWithGemma, GEMMA_MODEL_ID, mapModelError, parseModelJson, type GenAiLike, type GenerateParams } from '../server/gemma.ts';
import { buildUserPrompt, MAX_PROMPT_CHARS } from '../server/prompt.ts';
import { validateAnalysis } from '../server/validate.ts';
import { makeBundle, validAnalysisJson } from './helpers.ts';

const bundle = makeBundle();
const IDS = new Set(bundle.evidence.map((e) => e.id));

function fakeClient(replies: Array<string | Error>): { createClient: () => GenAiLike; calls: GenerateParams[] } {
  const calls: GenerateParams[] = [];
  let i = 0;
  const client: GenAiLike = {
    models: {
      async generateContent(params) {
        calls.push(params);
        const reply = replies[Math.min(i++, replies.length - 1)];
        if (reply instanceof Error) throw reply;
        return { text: reply };
      },
    },
  };
  return { createClient: () => client, calls };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected ${code}`);
}

describe('evidence records', () => {
  it('assigns stable sequential IDs and real GitHub URLs', () => {
    assert.deepEqual(bundle.evidence.slice(0, 3).map((e) => e.id), ['E01', 'E02', 'E03']);
    assert.equal(new Set(bundle.evidence.map((e) => e.id)).size, bundle.evidence.length);
    for (const record of bundle.evidence) {
      assert.match(record.url, /^https:\/\/github\.com\/acme\/widget(\/|#|$)/);
    }
  });

  it('marks the computed activity record as derived and emits a status record for missing data', () => {
    assert.equal(bundle.evidence.find((e) => e.sourceType === 'activity')?.derived, true);
    const statuses = bundle.evidence.filter((e) => e.sourceType === 'status');
    assert.equal(statuses.length, 1);
    assert.match(statuses[0]?.title ?? '', /issues/i);
  });
});

describe('validateAnalysis', () => {
  it('accepts a well-formed response', () => {
    const result = validateAnalysis(validAnalysisJson(), IDS);
    assert.ok(result.ok);
    assert.equal(result.analysis.missions.length, 3);
    assert.equal(result.analysis.findings[0]?.supported, true);
    assert.deepEqual(result.warnings, []);
  });

  it('rejects non-objects and missing fields', () => {
    for (const value of [null, 'text', 42, [], undefined]) {
      assert.equal(validateAnalysis(value, IDS).ok, false);
    }
    const missing = validAnalysisJson();
    delete missing.revivalPlan;
    delete missing.repositorySummary;
    const result = validateAnalysis(missing, IDS);
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.includes('revivalPlan')));
    assert.ok(result.errors.some((e) => e.includes('repositorySummary')));
  });

  it('rejects unsupported enum values', () => {
    const bad = validAnalysisJson() as { findings: Array<Record<string, unknown>>; missions: Array<Record<string, unknown>> };
    bad.findings[0]!.type = 'critical';
    bad.findings[0]!.confidence = 'certain';
    bad.missions[0]!.difficulty = 'Expert';
    const result = validateAnalysis(bad, IDS);
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.includes('findings[0].type')));
    assert.ok(result.errors.some((e) => e.includes('findings[0].confidence')));
    assert.ok(result.errors.some((e) => e.includes('missions[0].difficulty')));
  });

  it('requires exactly three missions', () => {
    for (const count of [0, 2, 4]) {
      const bad = validAnalysisJson() as { missions: unknown[] };
      bad.missions = (validAnalysisJson() as { missions: unknown[] }).missions.concat(bad.missions).slice(0, count);
      const result = validateAnalysis(bad, IDS);
      assert.ok(!result.ok, `${count} missions should fail`);
      assert.ok(result.errors.some((e) => e.includes('exactly 3')));
    }
  });

  it('enforces text limits and list sizes', () => {
    const long = validAnalysisJson() as { repositorySummary: string; revivalPlan: string[]; missions: Array<{ steps: string[] }> };
    long.repositorySummary = 'x'.repeat(1501);
    long.revivalPlan = ['only one'];
    long.missions[0]!.steps = ['single step'];
    const result = validateAnalysis(long, IDS);
    assert.ok(!result.ok);
    assert.ok(result.errors.some((e) => e.includes('repositorySummary') && e.includes('limit')));
    assert.ok(result.errors.some((e) => e.includes('revivalPlan')));
    assert.ok(result.errors.some((e) => e.includes('steps')));
  });

  it('drops unknown evidence IDs and never keeps model-supplied URLs', () => {
    const data = validAnalysisJson() as { findings: Array<Record<string, unknown>> };
    data.findings[0]!.evidenceIds = ['E01', 'E99', 'https://evil.example', 'e02', 'E01'];
    data.findings[0]!.url = 'https://evil.example/fake';
    const result = validateAnalysis(data, IDS);
    assert.ok(result.ok);
    assert.deepEqual(result.analysis.findings[0]?.evidenceIds, ['E01', 'E02']);
    assert.ok(result.warnings.some((w) => w.includes('E99')));
    assert.equal('url' in (result.analysis.findings[0] ?? {}), false);
  });

  it('marks claims with no valid evidence as unsupported and lowers their confidence', () => {
    const data = validAnalysisJson() as { findings: Array<Record<string, unknown>>; activityInterpretation: Record<string, unknown> };
    data.findings[0]!.evidenceIds = ['E77'];
    data.findings[0]!.confidence = 'high';
    data.activityInterpretation.evidenceIds = [];
    const result = validateAnalysis(data, IDS);
    assert.ok(result.ok);
    assert.equal(result.analysis.findings[0]?.supported, false);
    assert.equal(result.analysis.findings[0]?.confidence, 'low');
    assert.equal(result.analysis.activityInterpretation.supported, false);
  });

  it('downgrades an evidence-based mission that cites nothing valid', () => {
    const data = validAnalysisJson() as { missions: Array<Record<string, unknown>> };
    data.missions[0]!.basis = 'evidence-based';
    data.missions[0]!.evidenceIds = ['E50'];
    const result = validateAnalysis(data, IDS);
    assert.ok(result.ok);
    assert.equal(result.analysis.missions[0]?.basis, 'general-exploration');
    assert.equal(result.analysis.missions[0]?.requiresVerification, true);
  });

  it('strips control and bidi characters from text', () => {
    const data = validAnalysisJson() as { repositorySummary: string };
    data.repositorySummary = 'Safe‮text\u0000 here';
    const result = validateAnalysis(data, IDS);
    assert.ok(result.ok);
    assert.equal(result.analysis.repositorySummary, 'Safetext here');
  });
});

describe('parseModelJson', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    assert.deepEqual(parseModelJson('{"a":1}'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseModelJson('Here it is: {"a":1} Hope that helps.'), { ok: true, value: { a: 1 } });
  });
  it('rejects text that is not JSON and oversized output', () => {
    assert.equal(parseModelJson('no json here').ok, false);
    assert.equal(parseModelJson('{"a":').ok, false);
    assert.equal(parseModelJson(`{"a":"${'x'.repeat(70_000)}"}`).ok, false);
  });
});

describe('analyzeWithGemma', () => {
  it('fails clearly when the API key is missing and never calls the model', async () => {
    const { createClient, calls } = fakeClient([JSON.stringify(validAnalysisJson())]);
    for (const apiKey of [undefined, '', '   ']) {
      const err = await expectCode(analyzeWithGemma(bundle, { apiKey, createClient }), 'missing_api_key');
      assert.match(err.hint ?? '', /GEMINI_API_KEY/);
    }
    assert.equal(calls.length, 0);
  });

  it('calls only the configured Gemma model with a system instruction', async () => {
    const { createClient, calls } = fakeClient([JSON.stringify(validAnalysisJson())]);
    const result = await analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient });
    assert.equal(result.attempts, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.model, 'gemma-4-26b-a4b-it');
    assert.equal(calls[0]?.model, GEMMA_MODEL_ID);
    assert.match(calls[0]?.config.systemInstruction ?? '', /never write URLs|Never write URLs/i);
    assert.ok((calls[0]?.config.maxOutputTokens ?? 0) > 0);
  });

  it('retries once with the validation errors, using the same model, then succeeds', async () => {
    const broken = validAnalysisJson() as { missions: unknown[] };
    broken.missions = broken.missions.slice(0, 1);
    const { createClient, calls } = fakeClient([JSON.stringify(broken), JSON.stringify(validAnalysisJson())]);
    const result = await analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient });
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.model, GEMMA_MODEL_ID);
    assert.match(String(calls[1]?.contents), /rejected/);
    assert.match(String(calls[1]?.contents), /exactly 3/);
  });

  it('returns model_invalid_output after two bad responses and fabricates nothing', async () => {
    const { createClient, calls } = fakeClient(['not json at all', '{"repositorySummary": 5}']);
    const err = await expectCode(analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient }), 'model_invalid_output');
    assert.equal(calls.length, 2);
    assert.ok((err.details?.length ?? 0) > 0);
  });

  it('treats an empty response as invalid', async () => {
    const { createClient } = fakeClient(['', '']);
    await expectCode(analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient }), 'model_invalid_output');
  });

  it('does not retry API errors', async () => {
    const { createClient, calls } = fakeClient([Object.assign(new Error('boom'), { status: 500 })]);
    await expectCode(analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient }), 'model_error');
    assert.equal(calls.length, 1);
  });

  it('maps a timeout to model_timeout', async () => {
    const client: GenAiLike = {
      models: {
        generateContent: (params) =>
          new Promise((_resolve, reject) => {
            params.config.abortSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      },
    };
    await expectCode(analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient: () => client, timeoutMs: 20 }), 'model_timeout');
  });

  it('surfaces a model that is unavailable to the account without substituting another', async () => {
    const { createClient, calls } = fakeClient([Object.assign(new Error('models/gemma-4-26b-a4b-it is not found for API version v1beta'), { status: 404 })]);
    const err = await expectCode(analyzeWithGemma(bundle, { apiKey: 'test-key-123456', createClient }), 'model_unavailable');
    assert.match(err.message, /gemma-4-26b-a4b-it/);
    assert.match(err.hint ?? '', /does not substitute/);
    assert.equal(calls.length, 1);
  });
});

describe('mapModelError', () => {
  it('maps auth, quota and unknown failures', () => {
    assert.equal(mapModelError(Object.assign(new Error('API key not valid'), { status: 400 }), 'k').code, 'model_auth');
    assert.equal(mapModelError(Object.assign(new Error('denied'), { status: 403 }), 'k').code, 'model_auth');
    assert.equal(mapModelError(Object.assign(new Error('Quota exceeded'), { status: 429 }), 'k').code, 'model_rate_limited');
    assert.equal(mapModelError(new Error('weird'), 'k').code, 'model_error');
    assert.equal(mapModelError('string error', 'k').code, 'model_error');
  });

  it('unwraps JSON error bodies from the SDK', () => {
    const err = mapModelError(new Error(JSON.stringify({ error: { code: 404, message: 'model not found' } })), 'k');
    assert.equal(err.code, 'model_unavailable');
    assert.match(err.message, /model not found/);
  });

  it('never leaks the API key', () => {
    const key = 'AIzaSyA-supersecretkey-1234567890abcdef';
    const err = mapModelError(new Error(`request to https://x?key=${key} failed`), key);
    assert.doesNotMatch(JSON.stringify(err.toBody()), /supersecretkey/);
    const other = mapModelError(new Error('bad key AIzaSyB-another-secret-key-0987654321zz'), undefined);
    assert.doesNotMatch(other.message, /another-secret-key/);
  });
});

describe('prompt construction', () => {
  it('keeps the evidence bundle within the input limit even for a huge README', () => {
    const big = makeBundle();
    big.readme = { path: 'README.md', text: 'word '.repeat(10_000).slice(0, 8000), truncated: true, totalChars: 90_000, url: 'https://github.com/acme/widget#readme' };
    const prompt = buildUserPrompt(big);
    assert.ok(prompt.length < MAX_PROMPT_CHARS + 600, `prompt was ${prompt.length}`);
  });

  it('treats repository text as data and never includes URLs for the model to copy', () => {
    const prompt = buildUserPrompt(bundle);
    assert.doesNotMatch(prompt, /https?:\/\//);
  });
});
