// undici for the browser build: the platform fetch. Agents are accepted and ignored.
export class Agent { constructor() {} close() { return Promise.resolve(); } destroy() { return Promise.resolve(); } }
export class Dispatcher {}
export class Pool extends Agent {}
export class ProxyAgent extends Agent {}
export function setGlobalDispatcher() {}
export function getGlobalDispatcher() { return new Agent(); }
export const fetch = (...a) => globalThis.fetch(...a);
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export async function request(url, opts = {}) {
  const r = await globalThis.fetch(url, { method: opts.method, headers: opts.headers, body: opts.body, signal: opts.signal });
  const headers = Object.fromEntries(r.headers.entries());
  return { statusCode: r.status, headers, body: { text: () => r.text(), json: () => r.json(), arrayBuffer: () => r.arrayBuffer() } };
}
export default { Agent, Dispatcher, Pool, ProxyAgent, setGlobalDispatcher, getGlobalDispatcher, fetch, request, Headers, Request, Response, FormData };
