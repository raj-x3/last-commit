// Builds the client unminified, then runs the server with --watch so server edits restart it.
// Re-run `npm run dev` after changing files in src/.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClient } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await buildClient({ minify: false });

const child = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', '--watch', '--watch-path=server', '--watch-path=shared', 'server/index.ts'],
  { cwd: root, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
