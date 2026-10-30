import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type http from 'node:http';
import { createApp } from '../server/index.ts';
import { routeOf } from '../src/routes.ts';

describe('pages', () => {
  let dir = '';
  let server: http.Server;
  let base = '';

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'lc-dist-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>app</title>');
    server = createApp({
      distDir: dir,
      geminiApiKey: 'test-key-123456',
      githubToken: undefined,
      rateLimitMax: 0,
      trustProxy: false,
      maxConcurrent: 4,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the app shell for /investigate so a direct visit or reload works', async () => {
    const res = await fetch(`${base}/investigate`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>app<\/title>/);
  });

  it('does not turn missing files or unknown API routes into the app shell', async () => {
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });

  it('maps pathnames to the two pages', () => {
    assert.equal(routeOf('/'), '/');
    assert.equal(routeOf('/investigate'), '/investigate');
    assert.equal(routeOf('/investigate/'), '/investigate');
    assert.equal(routeOf('/anything-else'), '/');
  });
});
