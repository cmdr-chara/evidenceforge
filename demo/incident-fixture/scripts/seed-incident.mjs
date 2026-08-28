import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await copyFile(
  resolve(directory, 'fixtures/buggy-config.mjs'),
  resolve(directory, 'src/config.mjs'),
);
console.log('Seeded CONFIG_VALIDATION_ORDER failure in demo/incident-fixture/src/config.mjs');
console.log('Run: node --test demo/incident-fixture/test/*.test.mjs');
