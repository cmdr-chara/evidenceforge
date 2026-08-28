import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const requested = process.argv[2];
const root = resolve(new URL('..', import.meta.url).pathname);
rmSync(join(root, 'dist'), { recursive: true, force: true });
run('tsc', ['-p', 'tsconfig.json']);
const base = join(root, 'dist', 'tests');
const roots = requested ? [join(base, requested)] : ['unit', 'integration', 'scenarios', 'failure-injection'].map((name) => join(base, name));
const files = roots.flatMap(findTests).sort();
if (files.length === 0) {
  console.error('No compiled tests found.');
  process.exit(1);
}
run(process.execPath, ['--test', ...files]);

function findTests(directory) {
  try {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? findTests(path) : path.endsWith('.test.js') ? [path] : [];
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
