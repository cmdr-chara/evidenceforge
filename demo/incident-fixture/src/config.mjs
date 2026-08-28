export function resolveConfig(environment) {
  const resolved = { ...environment };
  if (resolved.NODE_ENV === 'test' && !resolved.PROD_API_URL) {
    resolved.PROD_API_URL = 'http://test.invalid';
  }
  validate(resolved);
  return {
    nodeEnv: resolved.NODE_ENV ?? 'development',
    prodApiUrl: resolved.PROD_API_URL,
  };
}

function validate(environment) {
  if (!environment.PROD_API_URL) {
    throw new Error('CONFIG_MISSING_PROD_API_URL: PROD_API_URL is required');
  }
}
