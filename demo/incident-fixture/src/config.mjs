export function resolveConfig(environment) {
  validate(environment);
  const resolved = { ...environment };
  if (resolved.NODE_ENV === 'test' && !resolved.PROD_API_URL) {
    resolved.PROD_API_URL = 'http://test.invalid';
  }
  return {
    nodeEnv: resolved.NODE_ENV ?? 'development',
    prodApiUrl: resolved.PROD_API_URL,
  };
}

function validate(environment) {
  if (!environment.PROD_API_URL) {
    throw new Error(
      'CONFIG_VALIDATION_ORDER: PROD_API_URL is required before test fallback',
    );
  }
}
