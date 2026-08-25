import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
run('tsc', ['-p', 'tsconfig.json']);
run(process.execPath, ['dist/evals/runner/index.js', ...process.argv.slice(2)]);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
