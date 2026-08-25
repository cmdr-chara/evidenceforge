import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const issues = [];
for (const path of walk(root)) {
  const rel = relative(root, path);
  if (path.endsWith('.json')) {
    try {
      JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      issues.push(`${rel}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (/\.(ts|mjs|js|json|md|css|html|toml|ya?ml)$/.test(path)) {
    const content = readFileSync(path, 'utf8');
    if (!content.endsWith('\n')) issues.push(`${rel}: missing terminal newline`);
  }
}
if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log('format checks passed');

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    if (['.git', 'node_modules', 'dist', '.data'].includes(entry)) return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
