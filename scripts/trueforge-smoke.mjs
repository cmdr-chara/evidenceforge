import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const build = spawnSync('tsc', ['-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const smoke = spawnSync(process.execPath, ['dist/apps/server/src/trueforge-smoke.js'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (smoke.status !== 0) process.exit(smoke.status ?? 1);
