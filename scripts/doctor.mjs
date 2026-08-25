import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const checks = [
  ['Node >= 22.14', satisfiesNode(process.versions.node)],
  ['package manager declared', packageJson.packageManager === 'pnpm@11.16.0'],
  ['TrueForge SDK dependency pinned', packageJson.dependencies?.['@truefoundry/trueforge-sdk'] === '0.1.3'],
  ['TrueForge base URL configured', Boolean(process.env.TRUEFORGE_BASE_URL)],
  ['model configured', Boolean(process.env.TRUEFORGE_MODEL)],
  ['installed dependencies', existsSync(resolve(root, 'node_modules/@truefoundry/trueforge-sdk'))],
];
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'BLOCKED'} ${name}`);
if (checks.some(([, pass]) => !pass)) process.exitCode = 1;

function satisfiesNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 14);
}
