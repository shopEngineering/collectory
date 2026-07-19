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

module.exports = { HttpError, badRequest, notFound, conflict, forbidden, unauthorized };
