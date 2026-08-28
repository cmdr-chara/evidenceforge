import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.mjs';

test('test mode applies a safe fallback before production validation', () => {
  const config = resolveConfig({ NODE_ENV: 'test' });
  assert.equal(config.prodApiUrl, 'http://test.invalid');
});

test('production still requires PROD_API_URL', () => {
  assert.throws(
    () => resolveConfig({ NODE_ENV: 'production' }),
    /CONFIG_MISSING_PROD_API_URL/,
  );
});

test('production preserves an explicit PROD_API_URL', () => {
  const config = resolveConfig({
    NODE_ENV: 'production',
    PROD_API_URL: 'https://api.example.invalid',
  });
  assert.equal(config.prodApiUrl, 'https://api.example.invalid');
});
