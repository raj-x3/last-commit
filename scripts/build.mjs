import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

export async function buildClient({ minify = true } = {}) {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await build({
    entryPoints: { app: path.join(root, 'src/main.tsx') },
    outdir: dist,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    minify,
    sourcemap: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
    logLevel: 'info',
  });
  await cp(path.join(root, 'public/index.html'), path.join(dist, 'index.html'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildClient();
}
