import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const requested = process.argv[2];
const root = resolve(new URL('..', import.meta.url).pathname);
const output = mkdtempSync(join(tmpdir(), 'evidenceforge-tests-'));
let status = 1;
try {
  symlinkSync(
    join(root, 'node_modules'),
    join(output, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  status = run('tsc', ['-p', 'tsconfig.json', '--outDir', output]);
  if (status === 0) {
    const base = join(output, 'tests');
    const roots = requested ? [join(base, requested)] : ['unit', 'integration', 'scenarios', 'failure-injection'].map((name) => join(base, name));
    const files = roots.flatMap(findTests).sort();
    if (files.length === 0) {
      console.error('No compiled tests found.');
      status = 1;
    } else {
      status = run(process.execPath, ['--test', ...files]);
    }
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
process.exit(status);

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
  return result.status ?? 1;
}
