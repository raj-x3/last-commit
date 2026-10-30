import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { HealthBody, ProgressEvent } from '../shared/types.ts';
import { AppError, toAppError } from './errors.ts';
import { analyzeWithGemma, GEMMA_MODEL_ID, missingKeyError, type GemmaResult } from './gemma.ts';
import { createGithubClient, type GithubClient } from './github.ts';
import { investigate } from './investigate.ts';
import type { EvidenceBundle } from './prompt.ts';
import { parseRepoInput } from './repoUrl.ts';
import { scrubSecrets } from './text.ts';

const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export interface AppConfig {
  distDir: string;
  geminiApiKey: string | undefined;
  githubToken: string | undefined;
  /** Investigations allowed per client per 10 minutes. 0 disables the limit. */
  rateLimitMax: number;
  trustProxy: boolean;
  maxConcurrent: number;
  github?: GithubClient;
  analyze?: (bundle: EvidenceBundle) => Promise<GemmaResult>;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const limit = Number(env.RATE_LIMIT_MAX ?? '30');
  return {
    distDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    rateLimitMax: Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 30,
    trustProxy: env.TRUST_PROXY === '1',
    maxConcurrent: 4,
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, err: unknown): void {
  const app = toAppError(err);
  const headers: Record<string, string> = {};
  if (app.retryAfterSeconds !== undefined) headers['Retry-After'] = String(app.retryAfterSeconds);
  sendJson(res, app.status, { error: app.toBody() }, headers);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new AppError('bad_request', 'Send the request as application/json.', 400);
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AppError('payload_too_large', 'The request body is too large.', 413);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new AppError('payload_too_large', 'The request body is too large.', 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('bad_request', 'The request body is not valid JSON.', 400);
  }
}

function createLimiter(max: number) {
  const hits = new Map<string, number[]>();
  return (key: string): number => {
    if (max <= 0) return 0;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= max) {
      hits.set(key, recent);
      return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - (recent[0] ?? now))) / 1000));
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, times] of hits) {
        if (now - (times[times.length - 1] ?? 0) >= RATE_WINDOW_MS) hits.delete(k);
      }
    }
    return 0;
  };
}

function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string, pathname: string): Promise<void> {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (relative.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  if (relative === '/' || relative === '') relative = '/index.html';
  let file = path.join(distDir, path.normalize(relative));
  if (file !== distDir && !file.startsWith(distDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let info = await stat(file).catch(() => null);
  if ((!info || !info.isFile()) && path.extname(relative) === '') {
    file = path.join(distDir, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info || !info.isFile()) {
    const built = await stat(path.join(distDir, 'index.html')).catch(() => null);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(built ? 'Not found.' : 'The frontend is not built. Run "npm run build", then restart the server.');
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createApp(config: AppConfig): http.Server {
  const github = config.github ?? createGithubClient({ token: config.githubToken });
  const analyze =
    config.analyze ?? ((bundle: EvidenceBundle) => analyzeWithGemma(bundle, { apiKey: config.geminiApiKey }));
  const limiter = createLimiter(config.rateLimitMax);
  let inFlight = 0;

  async function handleInvestigate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const wait = limiter(clientKey(req, config.trustProxy));
    if (wait > 0) {
      throw new AppError('too_many_requests', 'Too many investigations from this client.', 429, {
        retryAfterSeconds: wait,
        hint: 'Wait a few minutes and try again.',
      });
    }
    const body = await readJsonBody(req);
    const ref = parseRepoInput((body as { repository?: unknown } | null)?.repository);
    if (!config.geminiApiKey) throw missingKeyError();
    if (inFlight >= config.maxConcurrent) {
      throw new AppError('too_many_requests', 'The server is busy with other investigations.', 429, {
        retryAfterSeconds: 15,
        hint: 'Retry in a few seconds.',
      });
    }

    inFlight++;
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    const emit = (event: ProgressEvent) => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const report = await investigate(ref, { github, analyze }, emit);
      emit({ type: 'result', report });
    } catch (err) {
      const app = toAppError(err);
      console.error(`[investigate] ${app.code}: ${scrubSecrets(app.message, [config.geminiApiKey, config.githubToken])}`);
      emit({ type: 'error', error: app.toBody() });
    } finally {
      inFlight--;
      res.end();
    }
  }

  return http.createServer((req, res) => {
    setSecurityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = async () => {
      if (url.pathname === '/api/health') {
        if (req.method !== 'GET') throw new AppError('bad_request', 'Use GET.', 405);
        const body: HealthBody = {
          status: 'ok',
          model: GEMMA_MODEL_ID,
          modelConfigured: Boolean(config.geminiApiKey),
          githubTokenConfigured: Boolean(config.githubToken),
        };
        sendJson(res, 200, body);
        return;
      }
      if (url.pathname === '/api/investigate') {
        if (req.method !== 'POST') throw new AppError('bad_request', 'Use POST.', 405);
        await handleInvestigate(req, res);
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new AppError('not_found', 'Unknown API route.', 404);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('bad_request', 'Method not allowed.', 405);
      await serveStatic(req, res, config.distDir, url.pathname);
    };
    route().catch((err: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendError(res, err);
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = configFromEnv();
  const port = Number(process.env.PORT ?? 3000);
  createApp(config).listen(port, '0.0.0.0', () => {
    console.log(`Last Commit is listening on http://localhost:${port}`);
    console.log(`Model: ${GEMMA_MODEL_ID} (${config.geminiApiKey ? 'GEMINI_API_KEY set' : 'GEMINI_API_KEY missing: analysis will fail until it is set'})`);
    console.log(`GitHub: ${config.githubToken ? 'authenticated requests' : 'unauthenticated requests (60 per hour per IP)'}`);
  });
}
