'use strict';

// Central HTTP error type. Routes throw these; the error middleware serializes
// to { error: { message, code } } with the given status.
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

const badRequest = (msg, code) => new HttpError(400, msg, code || 'BAD_REQUEST');
const notFound = (msg, code) => new HttpError(404, msg || 'Not found', code || 'NOT_FOUND');
const conflict = (msg, code) => new HttpError(409, msg, code || 'CONFLICT');
const forbidden = (msg, code) => new HttpError(403, msg, code || 'FORBIDDEN');
const unauthorized = (msg, code) => new HttpError(401, msg, code || 'UNAUTHORIZED');

// Map a raw better-sqlite3 SqliteError to an HttpError: UNIQUE/PK -> 409 CONFLICT,
// other constraints (NOT NULL / FK / CHECK) -> 400 CONSTRAINT. Returns null for
// anything that isn't a SQLITE_CONSTRAINT error (caller falls through to 500).
function fromSqlite(error) {
  if (!error || typeof error.code !== 'string' || !error.code.startsWith('SQLITE_CONSTRAINT')) return null;
  const isUnique = error.code.includes('UNIQUE') || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
  return isUnique ? conflict('constraint violation', 'CONFLICT') : badRequest('constraint violation', 'CONSTRAINT');
}

module.exports = { HttpError, badRequest, notFound, conflict, forbidden, unauthorized, fromSqlite };
