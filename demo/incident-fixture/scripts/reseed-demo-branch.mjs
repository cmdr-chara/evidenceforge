import { spawnSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = resolve(root, 'demo/incident-fixture');
const branch = 'demo/config-order-regression';
const push = process.argv.includes('--push');

run('git', ['diff', '--quiet']);
run('git', ['switch', '-C', branch, 'determination']);
await copyFile(
  resolve(fixture, 'fixtures/buggy-config.mjs'),
  resolve(fixture, 'src/config.mjs'),
);
run('git', ['add', 'demo/incident-fixture/src/config.mjs']);
run('git', ['commit', '-m', 'test(demo): seed configuration-order regression']);

if (push) {
  console.log('About to perform an external GitHub write: pushing the demo incident branch.');
  run('git', ['push', '--force-with-lease', '-u', 'origin', branch]);
} else {
  console.log(`Prepared ${branch} locally. Re-run with --push only after approving the external write.`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
