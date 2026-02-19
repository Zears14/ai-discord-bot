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

function isTransientDatabaseError(error) {
  if (!error || typeof error !== 'object') return false;

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';

  const transientCodes = new Set([
    '57P01', // admin_shutdown
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    '08000', // connection_exception
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08003', // connection_does_not_exist
    '08006', // connection_failure
    '53300', // too_many_connections
  ]);

  if (transientCodes.has(code)) return true;

  const transientSnippets = [
    'terminating connection',
    'connection terminated unexpectedly',
    'server closed the connection unexpectedly',
    'connection not open',
    'connection ended unexpectedly',
    'timeout expired',
    'econnreset',
    'etimedout',
  ];

  return transientSnippets.some((snippet) => message.includes(snippet));
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

export { createPoolConfig, isTransientDatabaseError };
