/**
 * @fileoverview PostgreSQL type parsers for app-wide numeric compatibility
 * @module services/pgTypeParsers
 */

import pg from 'pg';

// int8 / bigint OID
const BIGINT_OID = 20;

pg.types.setTypeParser(BIGINT_OID, (value) => {
  return BigInt(value);
});
