import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('build', { recursive: true, force: true });
await mkdir('build', { recursive: true });
await cp('dist', 'build', { recursive: true });
await build({ entryPoints: ['src/claims.js'], outfile: 'build/claims.js', bundle: true, minify: true, format: 'esm', target: ['es2022'] });
console.log('Built Starboard in build/');
