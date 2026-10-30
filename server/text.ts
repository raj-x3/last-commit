// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Single-line text: control and bidi characters removed, whitespace collapsed, length capped. */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  return truncate(flat, max);
}

/** Multi-line text: control and bidi characters removed, line breaks kept, length capped. */
export function cleanBlock(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  return truncate(text.trim(), max);
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Removes the API key (and anything shaped like a Google API key) from text before it is shown or logged. */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').replace(/\b(?:ghp|github_pat|gho)_[0-9A-Za-z_]{20,}/g, '[redacted]');
}
