import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await copyFile(
  resolve(directory, 'fixtures/fixed-config.mjs'),
  resolve(directory, 'src/config.mjs'),
);
console.log('Restored healthy configuration-order fixture.');
