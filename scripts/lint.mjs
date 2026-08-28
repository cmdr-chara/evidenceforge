import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const files = walk(root).filter((path) => /\.(ts|mjs|js|json|md|css|html|toml|ya?ml)$/.test(path));
const issues = [];
for (const path of files) {
  const rel = relative(root, path);
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (/\s+$/.test(line) && line.length > 0) issues.push(`${rel}:${index + 1}: trailing whitespace`);
    if (line.includes('\t')) issues.push(`${rel}:${index + 1}: tab character`);
  });
  if (!content.endsWith('\n')) issues.push(`${rel}: missing terminal newline`);
  if (path.endsWith('.ts')) {
    if (/\bas\s+any\b|:\s*any\b/.test(content)) issues.push(`${rel}: explicit any is forbidden`);
    if (/from\s+["']node:child_process["']/.test(content) && !rel.startsWith('tests/')) {
      issues.push(`${rel}: host child_process is forbidden outside tests/scripts`);
    }
  }
}

const specialistSource = readFileSync(join(root, 'packages/specialists/src/definitions.ts'), 'utf8');
const specialistCount = (specialistSource.match(/name: "(?:Repository Investigator|Failure \/ Log Investigator|Dependency \/ Configuration Investigator)"/g) ?? []).length;
if (specialistCount !== 3) issues.push(`specialist topology: expected 3 definitions, found ${specialistCount}`);

const stateMachine = readFileSync(join(root, 'packages/workflow/src/state-machine.ts'), 'utf8');
if (!stateMachine.includes('completeWithCertificate')) issues.push('state machine: certificate-only completion method missing');

if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log(`lint passed (${files.length} files checked)`);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (['.git', 'node_modules', 'dist', '.data', '.evidenceforge'].includes(entry)) return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
