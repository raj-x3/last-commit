import { GEMMA_MODEL_ID, MODEL_VIA } from '../shared/constants.ts';
import type { Analysis } from '../shared/types.ts';
import { AppError } from './errors.ts';
import { buildUserPrompt, SYSTEM_PROMPT, type EvidenceBundle } from './prompt.ts';
import { cleanLine, scrubSecrets } from './text.ts';
import { MAX_MODEL_OUTPUT_CHARS, validateAnalysis } from './validate.ts';

export { GEMMA_MODEL_ID, MODEL_VIA };

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
const MAX_OUTPUT_TOKENS = 8192;

export interface GenerateParams {
  model: string;
  contents: string;
  config: {
    systemInstruction: string;
    temperature: number;
    maxOutputTokens: number;
    abortSignal: AbortSignal;
  };
}

/** The part of the @google/genai client this module uses. */
export interface GenAiLike {
  models: {
    generateContent(params: GenerateParams): Promise<{ text?: string | undefined }>;
  };
}

export interface GemmaOptions {
  apiKey: string | undefined;
  createClient?: (apiKey: string) => Promise<GenAiLike> | GenAiLike;
  timeoutMs?: number;
}

export interface GemmaResult {
  analysis: Analysis;
  warnings: string[];
  attempts: number;
}

async function defaultCreateClient(apiKey: string): Promise<GenAiLike> {
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey }) as unknown as GenAiLike;
}

export function missingKeyError(): AppError {
  return new AppError('missing_api_key', 'The server has no Gemini API key configured.', 503, {
    hint: `Set GEMINI_API_KEY in the server environment (in Google AI Studio, add it under Secrets), then restart. It is required to call ${GEMMA_MODEL_ID}.`,
  });
}

/** Converts SDK and network failures into errors that say what to fix. Secrets are scrubbed from the message. */
export function mapModelError(err: unknown, apiKey: string | undefined): AppError {
  if (err instanceof AppError) return err;
  const record = (err ?? {}) as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const status = typeof record.status === 'number' ? record.status : typeof record.code === 'number' ? record.code : 0;
  let message = typeof record.message === 'string' ? record.message : 'The request failed without a message.';
  try {
    const parsed = JSON.parse(message) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
  } catch {
    // The message was not JSON; keep it as is.
  }
  message = cleanLine(scrubSecrets(message, [apiKey]), 300);

  if (record.name === 'AbortError' || record.name === 'TimeoutError') {
    return new AppError('model_timeout', `${GEMMA_MODEL_ID} did not respond in time.`, 504, { hint: 'Retry in a moment.' });
  }
  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID|permission denied/i.test(message)) {
    return new AppError('model_auth', `The Gemini API rejected the configured key: ${message}`, 502, {
      hint: `Check GEMINI_API_KEY, and confirm the key's project has access to ${GEMMA_MODEL_ID}.`,
    });
  }
  if (status === 404 || /not found|is not supported|unknown model/i.test(message)) {
    return new AppError('model_unavailable', `${GEMMA_MODEL_ID} is not available to this API key: ${message}`, 502, {
      hint: `Use a key whose account can call ${GEMMA_MODEL_ID} through the Gemini API (check the model list in Google AI Studio). Last Commit does not substitute another model.`,
    });
  }
  if (status === 429 || /quota|rate limit|resource.?exhausted/i.test(message)) {
    return new AppError('model_rate_limited', `The Gemini API rate or quota limit was reached: ${message}`, 429, {
      hint: 'Wait and retry, or check the quota for this key in Google AI Studio.',
      retryAfterSeconds: 60,
    });
  }
  return new AppError('model_error', `The Gemini API returned an error: ${message}`, 502, { hint: 'Retry in a moment.' });
}

/** Pulls a JSON object out of the model's text, tolerating a code fence or stray prose around it. */
export function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.length > MAX_MODEL_OUTPUT_CHARS) {
    return { ok: false, error: `The output is ${text.length} characters; the limit is ${MAX_MODEL_OUTPUT_CHARS}.` };
  }
  const candidates: string[] = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // Try the next candidate.
    }
  }
  return { ok: false, error: 'The output was not valid JSON.' };
}

async function generateOnce(client: GenAiLike, contents: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AppError('model_timeout', `${GEMMA_MODEL_ID} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, 504, { hint: 'Retry in a moment.' }));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      client.models.generateContent({
        model: GEMMA_MODEL_ID,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: controller.signal,
        },
      }),
      timeout,
    ]);
    return typeof response?.text === 'string' ? response.text : '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends the evidence bundle to Gemma, validates the JSON it returns, and retries once with the
 * validation errors if the output is malformed. API failures are not retried.
 */
export async function analyzeWithGemma(bundle: EvidenceBundle, options: GemmaOptions): Promise<GemmaResult> {
  const { apiKey } = options;
  if (!apiKey || apiKey.trim().length === 0) throw missingKeyError();

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const validIds = new Set(bundle.evidence.map((record) => record.id));
  let client: GenAiLike;
  try {
    client = await (options.createClient ?? defaultCreateClient)(apiKey);
  } catch (err) {
    throw mapModelError(err, apiKey);
  }

  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let text: string;
    try {
      text = await generateOnce(client, buildUserPrompt(bundle, feedback), timeoutMs);
    } catch (err) {
      throw mapModelError(err, apiKey);
    }

    const parsed = text.trim().length === 0 ? ({ ok: false, error: 'The model returned no text.' } as const) : parseModelJson(text);
    if (parsed.ok) {
      const result = validateAnalysis(parsed.value, validIds);
      if (result.ok) return { analysis: result.analysis, warnings: result.warnings, attempts: attempt };
      feedback = result.errors;
    } else {
      feedback = [parsed.error];
    }
  }

  throw new AppError(
    'model_invalid_output',
    `${GEMMA_MODEL_ID} returned output that failed validation twice, so no report was produced.`,
    502,
    { hint: 'Retry. If it keeps failing, the repository content may be confusing the model.', details: feedback.slice(0, 6) },
  );
}
