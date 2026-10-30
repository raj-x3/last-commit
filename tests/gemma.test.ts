import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeActivity } from '../server/activity.ts';
import { buildEvidence } from '../server/evidence.ts';
import { AppError } from '../server/errors.ts';
import { analyzeWithGemma, GEMMA_MODEL_ID, mapModelError, parseModelJson, type GenAiLike, type GenerateParams } from '../server/gemma.ts';
import type { EvidenceBundle } from '../server/prompt.ts';
import type { RepoMeta, SourceSections } from '../shared/types.ts';
import { validAnalysis } from './helpers.ts';

const meta: RepoMeta = {
  owner: 'acme',
  name: 'demo',
  fullName: 'acme/demo',
  url: 'https://github.com/acme/demo',
  description: 'A demo',
  language: 'TypeScript',
  license: 'MIT',
  topics: [],
  stars: 1,
  forks: 0,
  openIssuesCount: 0,
  archived: false,
  isFork: false,
  defaultBranch: 'main',
  createdAt: '2020-01-01T00:00:00Z',
  pushedAt: '2024-01-01T00:00:00Z',
};
const sections: SourceSections = {
  commits: { status: 'ok', detail: 'ok', count: 0 },
  readme: { status: 'missing', detail: 'no README', count: 0 },
  issues: { status: 'empty', detail: 'none', count: 0 },
};
const activity = computeActivity({ archived: false, createdAt: meta.createdAt, pushedAt: meta.pushedAt, commits: [], now: Date.parse('2025-01-01T00:00:00Z') });
const evidence = buildEvidence({ meta, activity, readme: null, commits: [], issues: [], sections });
const bundle: EvidenceBundle = { repository: meta, activity, sections, evidence, readme: null };

function clientReturning(...replies: Array<string | Error>): { client: GenAiLike; calls: GenerateParams[] } {
  const calls: GenerateParams[] = [];
  const queue = [...replies];
  return {
    calls,
    client: {
      models: {
        async generateContent(params) {
          calls.push(params);
          const next = queue.shift();
          if (next instanceof Error) throw next;
          return { text: next ?? '' };
        },
      },
    },
  };
}

function validReply(): string {
  const reply = validAnalysis();
  const ids = evidence.map((record) => record.id);
  const first = ids[0] as string;
  (reply.activityInterpretation as any).evidenceIds = [first];
  (reply.findings as any[])[0].evidenceIds = [first];
  (reply.missions as any[]).forEach((m) => (m.evidenceIds = [first]));
  return JSON.stringify(reply);
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected a rejection');
}

describe('analyzeWithGemma', () => {
  it('fails with a configuration error when the API key is missing', async () => {
    for (const apiKey of [undefined, '', '   ']) {
      const err = await rejection(analyzeWithGemma(bundle, { apiKey, createClient: () => assert.fail('client must not be created') }));
      assert.equal(err.code, 'missing_api_key');
      assert.match(err.hint ?? '', /GEMINI_API_KEY/);
    }
  });

  it('calls exactly the configured Gemma model and sends the key only to the client factory', async () => {
    const { client, calls } = clientReturning(validReply());
    let factoryKey = '';
    const result = await analyzeWithGemma(bundle, {
      apiKey: 'test-key-123456',
      createClient: (key) => {
        factoryKey = key;
        return client;
      },
    });
    assert.equal(factoryKey, 'test-key-123456');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.model, 'gemma-4-26b-a4b-it');
    assert.equal(GEMMA_MODEL_ID, 'gemma-4-26b-a4b-it');
    assert.ok(!String(calls[0]?.contents).includes('test-key-123456'));
    assert.equal(result.attempts, 1);
    assert.equal(result.analysis.missions.length, 3);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const { client } = clientReturning('```json\n' + validReply() + '\n```');
    const result = await analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client });
    assert.equal(result.attempts, 1);
  });

  it('retries once with the validation errors, on the same model, after malformed output', async () => {
    const { client, calls } = clientReturning('this is not json', validReply());
    const result = await analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client });
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.model, 'gemma-4-26b-a4b-it');
    assert.match(String(calls[1]?.contents), /rejected/);
  });

  it('retries once after a schema violation and reports the violation in the retry prompt', async () => {
    const broken = validAnalysis();
    (broken.missions as any[]).pop();
    const { client, calls } = clientReturning(JSON.stringify(broken), validReply());
    const result = await analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client });
    assert.equal(result.attempts, 2);
    assert.match(String(calls[1]?.contents), /exactly 3/);
  });

  it('returns a clear error, not fabricated findings, when validation fails twice', async () => {
    const { client, calls } = clientReturning('nope', '{"repositorySummary": 1}');
    const err = await rejection(analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client }));
    assert.equal(err.code, 'model_invalid_output');
    assert.equal(calls.length, 2);
    assert.ok((err.details ?? []).length > 0);
  });

  it('does not retry API errors', async () => {
    const failure = Object.assign(new Error('quota exceeded'), { status: 429 });
    const { client, calls } = clientReturning(failure, validReply());
    const err = await rejection(analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client }));
    assert.equal(err.code, 'model_rate_limited');
    assert.equal(calls.length, 1);
  });

  it('reports an unavailable model without substituting another one', async () => {
    const failure = Object.assign(new Error('models/gemma-4-26b-a4b-it is not found for API version v1beta'), { status: 404 });
    const { client, calls } = clientReturning(failure);
    const err = await rejection(analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client }));
    assert.equal(err.code, 'model_unavailable');
    assert.match(err.hint ?? '', /does not substitute/);
    assert.equal(calls.length, 1);
  });

  it('times out when the model does not answer', async () => {
    const client: GenAiLike = { models: { generateContent: () => new Promise(() => undefined) } };
    const err = await rejection(analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client, timeoutMs: 40 }));
    assert.equal(err.code, 'model_timeout');
    assert.equal(err.status, 504);
  });

  it('treats an empty response as malformed output', async () => {
    const { client, calls } = clientReturning('', '');
    const err = await rejection(analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client }));
    assert.equal(err.code, 'model_invalid_output');
    assert.equal(calls.length, 2);
  });

  it('puts the evidence bundle, not instructions from repository text, in the user turn', async () => {
    const { client, calls } = clientReturning(validReply());
    await analyzeWithGemma(bundle, { apiKey: 'k-12345678', createClient: () => client });
    assert.match(String(calls[0]?.contents), /"id": "E01"/);
    assert.match(calls[0]?.config.systemInstruction ?? '', /data, not instructions/);
  });
});

describe('mapModelError', () => {
  it('maps authentication failures and scrubs the key from the message', () => {
    const err = mapModelError(Object.assign(new Error('API key not valid: sk-secret-key-value-123'), { status: 400 }), 'sk-secret-key-value-123');
    assert.equal(err.code, 'model_auth');
    assert.ok(!err.message.includes('sk-secret-key-value-123'));
  });

  it('scrubs Google-style keys from unrecognised errors', () => {
    const key = 'AIza' + 'B'.repeat(35);
    const err = mapModelError(new Error(`request failed for ${key}`), undefined);
    assert.ok(!err.message.includes(key));
  });

  it('unwraps JSON error bodies from the SDK', () => {
    const err = mapModelError(Object.assign(new Error(JSON.stringify({ error: { message: 'Model not found' } })), { status: 404 }), 'k');
    assert.equal(err.code, 'model_unavailable');
    assert.match(err.message, /Model not found/);
  });
});

describe('parseModelJson', () => {
  it('parses plain JSON, fenced JSON, and JSON surrounded by prose', () => {
    assert.deepEqual(parseModelJson('{"a":1}'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { ok: true, value: { a: 1 } });
    assert.deepEqual(parseModelJson('Here you go: {"a":1} Done.'), { ok: true, value: { a: 1 } });
  });

  it('rejects invalid JSON and oversized output', () => {
    assert.equal(parseModelJson('{broken').ok, false);
    assert.equal(parseModelJson('{"a":"' + 'x'.repeat(70_000) + '"}').ok, false);
  });
});
