import type { ApiErrorBody, HealthBody, InvestigationReport, ProgressEvent } from '../shared/types.ts';

export class ApiFailure extends Error {
  body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiFailure';
    this.body = body;
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthBody | null> {
  try {
    const res = await fetch('/api/health', signal ? { signal } : {});
    if (!res.ok) return null;
    return (await res.json()) as HealthBody;
  } catch {
    return null;
  }
}

/**
 * Starts an investigation and reports each progress event as the server sends it.
 * Resolves with the finished report; throws ApiFailure for errors the server reported.
 */
export async function investigateRepository(
  repository: string,
  onEvent: (event: ProgressEvent) => void,
  signal: AbortSignal,
): Promise<InvestigationReport> {
  const res = await fetch('/api/investigate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repository }),
    signal,
  });

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/x-ndjson')) {
    const data = (await res.json().catch(() => null)) as { error?: ApiErrorBody } | null;
    throw new ApiFailure(data?.error ?? { code: 'internal', message: `The server answered with HTTP ${res.status}.` });
  }

  let report: InvestigationReport | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ProgressEvent;
    onEvent(event);
    if (event.type === 'result') report = event.report;
    if (event.type === 'error') throw new ApiFailure(event.error);
  };

  if (!res.body) {
    (await res.text()).split('\n').forEach(handle);
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    handle(buffer);
  }

  if (!report) {
    throw new ApiFailure({ code: 'internal', message: 'The connection closed before the report was complete.', hint: 'Retry the investigation.' });
  }
  return report;
}
