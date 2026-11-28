// In-memory stand-ins for the parts of node:http that Fastify and
// light-my-request use. Nothing here opens a socket.
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

export const METHODS = ['ACL','BIND','CHECKOUT','CONNECT','COPY','DELETE','GET','HEAD','LINK','LOCK','M-SEARCH','MERGE','MKACTIVITY','MKCALENDAR','MKCOL','MOVE','NOTIFY','OPTIONS','PATCH','POST','PROPFIND','PROPPATCH','PURGE','PUT','QUERY','REBIND','REPORT','SEARCH','SOURCE','SUBSCRIBE','TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE'];

export const STATUS_CODES = {
  100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted',
  203: 'Non-Authoritative Information', 204: 'No Content', 206: 'Partial Content', 207: 'Multi-Status',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect',
  308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict',
  410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large', 414: 'URI Too Long',
  415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 417: 'Expectation Failed', 422: 'Unprocessable Entity',
  423: 'Locked', 424: 'Failed Dependency', 428: 'Precondition Required', 429: 'Too Many Requests',
  431: 'Request Header Fields Too Large', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported', 507: 'Insufficient Storage',
};

export function IncomingMessage(socket) {
  Readable.call(this);
  this.socket = socket;
  this.headers = {};
  this.rawHeaders = [];
  this.httpVersion = '1.1';
}
Object.setPrototypeOf(IncomingMessage.prototype, Readable.prototype);
Object.setPrototypeOf(IncomingMessage, Readable);

export function ServerResponse(req) {
  EventEmitter.call(this);
  this.req = req;
  this.statusCode = 200;
  this.statusMessage = '';
  this.headersSent = false;
  this.finished = false;
  this.writableEnded = false;
  this.writableFinished = false;
  this.writable = true;
  this.destroyed = false;
  this.sendDate = false;
  this.chunkedEncoding = false;
  this._hasBody = true;
  this._header = null;
  this._headers = Object.create(null);
  this._names = Object.create(null);
  this.socket = null;
  this.connection = null;
}
Object.setPrototypeOf(ServerResponse.prototype, EventEmitter.prototype);
Object.setPrototypeOf(ServerResponse, EventEmitter);

const P = ServerResponse.prototype;
P.setHeader = function (name, value) { const k = String(name).toLowerCase(); this._headers[k] = value; this._names[k] = name; return this; };
P.appendHeader = function (name, value) { const k = String(name).toLowerCase(); const old = this._headers[k]; this.setHeader(name, old === undefined ? value : [].concat(old, value)); return this; };
P.getHeader = function (name) { return this._headers[String(name).toLowerCase()]; };
P.getHeaders = function () { const out = Object.create(null); for (const k in this._headers) out[k] = this._headers[k]; return out; };
P.getHeaderNames = function () { return Object.keys(this._headers); };
P.getRawHeaderNames = function () { return Object.keys(this._headers).map(k => this._names[k]); };
P.hasHeader = function (name) { return String(name).toLowerCase() in this._headers; };
P.removeHeader = function (name) { const k = String(name).toLowerCase(); delete this._headers[k]; delete this._names[k]; };
P.flushHeaders = function () { if (!this.headersSent) this.writeHead(this.statusCode); };
P.writeHead = function (statusCode, reason, headers) {
  if (typeof reason !== 'string') { headers = reason; reason = undefined; }
  this.statusCode = statusCode;
  this.statusMessage = reason ?? STATUS_CODES[statusCode] ?? 'unknown';
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) this.appendHeader(headers[i], headers[i + 1]);
  } else if (headers) {
    for (const k of Object.keys(headers)) this.setHeader(k, headers[k]);
  }
  const method = this.req && this.req.method;
  this._hasBody = !(statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode < 200) || method === 'HEAD');
  let head = `HTTP/1.1 ${statusCode} ${this.statusMessage}\r\n`;
  for (const k in this._headers) head += `${this._names[k]}: ${this._headers[k]}\r\n`;
  this._header = head + '\r\n';
  this.headersSent = true;
  return this;
};
P.write = function (_chunk, _encoding, callback) {
  if (typeof _encoding === 'function') callback = _encoding;
  if (!this.headersSent) this.writeHead(this.statusCode);
  if (typeof callback === 'function') queueMicrotask(callback);
  return true;
};
P.end = function (callback) {
  if (typeof callback !== 'function') callback = undefined;
  if (!this.headersSent) this.writeHead(this.statusCode);
  this.finished = true;
  this.writableEnded = true;
  this.writableFinished = true;
  if (callback) queueMicrotask(callback);
  return this;
};
P.assignSocket = function (socket) { this.socket = socket; this.connection = socket; };
P.detachSocket = function () { this.socket = null; this.connection = null; };
P.setTimeout = function () { return this; };
P.cork = function () {};
P.uncork = function () {};
P.addTrailers = function () {};
P.writeContinue = function () {};
P.writeEarlyHints = function () {};

class FakeServer extends EventEmitter {
  constructor(handler) { super(); this.listening = false; if (handler) this.on('request', handler); }
  listen(...args) { this.listening = true; const cb = args.find(a => typeof a === 'function'); if (cb) queueMicrotask(cb); this.emit('listening'); return this; }
  close(cb) { this.listening = false; if (cb) queueMicrotask(cb); this.emit('close'); return this; }
  address() { return { address: '127.0.0.1', family: 'IPv4', port: 0 }; }
  setTimeout() { return this; }
  closeAllConnections() {}
  closeIdleConnections() {}
  ref() { return this; }
  unref() { return this; }
}
export const Server = FakeServer;
export function createServer(options, handler) { return new FakeServer(typeof options === 'function' ? options : handler); }
export class Agent { constructor() {} destroy() {} }
export const globalAgent = new Agent();
export function request() { throw new Error('node:http request is not available in the browser build'); }
export const get = request;
export const validateHeaderName = () => {};
export const validateHeaderValue = () => {};
export const maxHeaderSize = 16384;
export default { METHODS, STATUS_CODES, IncomingMessage, ServerResponse, Server, createServer, Agent, globalAgent, request, get, validateHeaderName, validateHeaderValue, maxHeaderSize };
