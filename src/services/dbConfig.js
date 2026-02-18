/**
 * @fileoverview Shared PostgreSQL pool configuration
 * @module services/dbConfig
 */

function getProductionSslConfig() {
  // In non-development environments, force SSL to satisfy managed DB requirements.
  // Defaulting rejectUnauthorized=false keeps compatibility with providers that use
  // certificates not present in the container trust store.
  const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED === 'true';
  return { rejectUnauthorized };
}

function createPoolConfig(overrides = {}) {
  const config = {
    connectionString: process.env.POSTGRES_URI,
    ...overrides,
  };

  if (process.env.IS_DEVEL !== 'true') {
    const overrideSsl =
      typeof overrides.ssl === 'object' && overrides.ssl !== null ? overrides.ssl : {};
    config.ssl = {
      ...getProductionSslConfig(),
      ...overrideSsl,
    };
  }

  return config;
}

export { createPoolConfig };
