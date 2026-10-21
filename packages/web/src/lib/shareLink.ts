/**
 * A share link: what to open, in one URL a colleague can follow.
 *
 * The URL has two halves, and the split is the whole design:
 *
 *   /queries/<query IRI>?version=3&argumentSet=<IRI>&backend=<IRI>#share=v1.<data>
 *   └ path ───────────┘ └ query string: references ─────────────┘ └ fragment: values ┘
 *
 * **The query string carries references.** The server resolves them, so they
 * open only what the recipient's own access allows. `version` and `argumentSet`
 * are the app's existing parameters; `backend` is the one share links add.
 *
 * **The fragment carries values** — content with no server identity: a scratch
 * query's text, argument values typed but not saved, an endpoint URL. Browsers
 * do not send a fragment to the server, so none of it reaches a request log or
 * a proxy's URL length limit. Opening the link turns each value into a
 * browser-local item (a scratch query or a draft, a scratch argument set, a
 * browser backend), exactly as if the recipient had typed it.
 *
 * Each part goes one way or the other, never both: a value replaces the
 * reference it would otherwise be. A scratch item's `urn:ui-temp:` id is never
 * sent — it names nothing outside the browser that minted it, and the
 * recipient's browser mints its own.
 *
 * `<data>` is the JSON payload, deflated and base64url-encoded. The `v1.` tag
 * is there so a later encoding can be read beside this one; every field is
 * optional, so a field added later does not need a new tag.
 */

import type { ArgumentScalarBinding, ArgumentTupleBinding } from '../types/argument-sets';
import { tupleSignature } from './argumentSignature';
import { sectionPath } from './sectionRoutes';

export const SHARE_FRAGMENT_KEY = 'share';

/** The query-string parameter naming the backend to select. */
export const SHARE_BACKEND_PARAM = 'backend';

const VERSION = 'v1';

/**
 * Longest `<data>` a link is made with.
 *
 * Chat and mail clients carry links of this size intact; past it some of them
 * cut the URL short, and a link that arrives truncated fails to decode on the
 * other side with nothing to say why. A body too large for it is saved, or
 * copied as text.
 */
export const MAX_SHARE_DATA_LENGTH = 8000;

/**
 * Most a decoded payload may inflate to. A link is a few kilobytes; this bounds
 * what a hand-made one can make the page allocate.
 */
const MAX_DECODED_BYTES = 1_000_000;

const MAX_NAME_LENGTH = 200;

/** One VALUES slot, in the SPARQL Results JSON shape `POST /execute` takes. */
export interface ShareArgument {
  head: { vars: string[] };
  results: { bindings: Record<string, ShareTerm>[] };
}

export interface ShareTerm {
  type: 'uri' | 'literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

export interface ShareParameter {
  name: string;
  value: number;
}

export interface SharePayload {
  /**
   * The editor body: SPARQL text for a query. On a record path it opens as a
   * draft on that record; on a section path, as a new scratch item.
   */
  body?: string;
  /** A name for the scratch item the body becomes. */
  name?: string;
  /** Argument values; they open as a scratch argument set. */
  arguments?: ShareArgument[];
  limits?: ShareParameter[];
  offsets?: ShareParameter[];
  /**
   * An endpoint URL to run against; it opens as a browser backend. Only the
   * URL travels — never a browser backend's headers, which can hold keys.
   */
  endpoint?: string;
}

/** True when the payload carries nothing, so the link needs no fragment. */
export function isEmptySharePayload(payload: SharePayload): boolean {
  return payload.body === undefined
    && !payload.arguments?.length
    && !payload.limits?.length
    && !payload.offsets?.length
    && !payload.endpoint;
}

export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareLinkError';
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ShareLinkError('The share link is damaged.');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ShareLinkError('The share link is damaged.');
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ShareLinkError('The share link is too large to open.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return readAll(stream, Number.POSITIVE_INFINITY);
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  try {
    return await readAll(stream, MAX_DECODED_BYTES);
  } catch (error) {
    if (error instanceof ShareLinkError) throw error;
    throw new ShareLinkError('The share link is damaged.');
  }
}

/** `v1.<data>` for a payload. The caller checks the length against the limit. */
export async function encodeSharePayload(payload: SharePayload): Promise<string> {
  const json: SharePayload = {};
  if (payload.body !== undefined) json.body = payload.body;
  const name = payload.name?.trim();
  if (name) json.name = name;
  if (payload.arguments?.length) json.arguments = payload.arguments;
  if (payload.limits?.length) json.limits = payload.limits;
  if (payload.offsets?.length) json.offsets = payload.offsets;
  if (payload.endpoint) json.endpoint = payload.endpoint;
  const compressed = await deflate(new TextEncoder().encode(JSON.stringify(json)));
  return `${VERSION}.${toBase64Url(compressed)}`;
}

/** Read `v1.<data>` back. Throws `ShareLinkError` with a message fit to show. */
export async function decodeSharePayload(data: string): Promise<SharePayload> {
  const dot = data.indexOf('.');
  const version = dot === -1 ? '' : data.slice(0, dot);
  if (version !== VERSION) {
    throw new ShareLinkError('This share link was made by a newer version of the app, or is damaged.');
  }
  const inflated = await inflate(fromBase64Url(data.slice(dot + 1)));

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
  } catch {
    throw new ShareLinkError('The share link is damaged.');
  }
  return readPayload(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function damaged(): never {
  throw new ShareLinkError('The share link is damaged.');
}

function readTerm(value: unknown): ShareTerm {
  if (!isRecord(value) || (value.type !== 'uri' && value.type !== 'literal') || typeof value.value !== 'string') {
    damaged();
  }
  const term: ShareTerm = { type: value.type, value: value.value };
  if (value.type === 'literal') {
    if (typeof value.datatype === 'string') term.datatype = value.datatype;
    if (typeof value['xml:lang'] === 'string') term['xml:lang'] = value['xml:lang'];
  }
  return term;
}

function readArgument(value: unknown): ShareArgument {
  if (!isRecord(value) || !isRecord(value.head) || !isRecord(value.results)) damaged();
  const vars = value.head.vars;
  const rows = value.results.bindings;
  if (!Array.isArray(vars) || !vars.every((name) => typeof name === 'string') || !Array.isArray(rows)) damaged();
  const names = vars as string[];
  const bindings = rows.map((row) => {
    if (!isRecord(row)) damaged();
    const binding: Record<string, ShareTerm> = {};
    for (const [name, term] of Object.entries(row)) {
      // A cell for a variable the slot does not declare would bind nothing.
      if (names.includes(name)) binding[name] = readTerm(term);
    }
    return binding;
  });
  return { head: { vars: names }, results: { bindings } };
}

function readParameters(value: unknown): ShareParameter[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) damaged();
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Number.isInteger(entry.value) || (entry.value as number) < 0) {
      damaged();
    }
    return { name: entry.name, value: entry.value as number };
  });
}

/** An endpoint is a place to send HTTP requests, and nothing else. */
function readEndpoint(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') damaged();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    damaged();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') damaged();
  return url.toString();
}

function readPayload(parsed: unknown): SharePayload {
  if (!isRecord(parsed)) damaged();
  const payload: SharePayload = {};
  if (parsed.body !== undefined) {
    if (typeof parsed.body !== 'string') damaged();
    payload.body = parsed.body;
  }
  if (typeof parsed.name === 'string' && parsed.name.trim()) {
    payload.name = parsed.name.trim().slice(0, MAX_NAME_LENGTH);
  }
  if (parsed.arguments !== undefined) {
    if (!Array.isArray(parsed.arguments)) damaged();
    payload.arguments = parsed.arguments.map(readArgument);
  }
  const limits = readParameters(parsed.limits);
  if (limits) payload.limits = limits;
  const offsets = readParameters(parsed.offsets);
  if (offsets) payload.offsets = offsets;
  const endpoint = readEndpoint(parsed.endpoint);
  if (endpoint) payload.endpoint = endpoint;
  if (isEmptySharePayload(payload)) damaged();
  return payload;
}

/** The `<data>` of a `#share=` fragment, or null when the fragment is something else. */
export function shareDataFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const data = params.get(SHARE_FRAGMENT_KEY);
  return data ? data : null;
}

/** The fragment for a link: `#share=v1.<data>`. */
export function shareHash(data: string): string {
  return `#${SHARE_FRAGMENT_KEY}=${data}`;
}

/** The values a share carries, as the body of a scratch argument set. */
export function argumentSetBodyFromShare(payload: SharePayload): {
  tupleBindings: ArgumentTupleBinding[];
  scalarBindings: ArgumentScalarBinding[];
} | null {
  const tupleBindings: ArgumentTupleBinding[] = (payload.arguments ?? []).map((argument) => ({
    tupleSignature: tupleSignature(argument.head.vars),
    variables: [...argument.head.vars],
    rows: argument.results.bindings.map((values, position) => ({ position, values: { ...values } })),
  }));
  const scalarBindings: ArgumentScalarBinding[] = [
    ...(payload.limits ?? []).map((limit) => ({
      parameterKind: 'limit' as const, parameterName: limit.name, numericValue: limit.value,
    })),
    ...(payload.offsets ?? []).map((offset) => ({
      parameterKind: 'offset' as const, parameterName: offset.name, numericValue: offset.value,
    })),
  ];
  if (tupleBindings.length === 0 && scalarBindings.length === 0) return null;
  return { tupleBindings, scalarBindings };
}

/**
 * Everything a share link names, before it is a URL.
 *
 * The work area fills this in from what is on screen; the page turns it into a
 * path, a query string and a fragment, because only the page holds the router.
 */
export interface ShareRequest {
  /** The saved query, when there is one: the path's record. */
  recordId: string | null;
  /** A pinned version number; null follows the current version. */
  version: number | null;
  argumentSetId: string | null;
  backendId: string | null;
  payload: SharePayload;
}

/** The route a share request opens, without the fragment's encoding. */
export function shareRoute(request: ShareRequest): { path: string; query: Record<string, string> } {
  const path = sectionPath({ section: 'queries', id: request.recordId });
  const query: Record<string, string> = {};
  if (request.recordId && request.version != null) query.version = String(request.version);
  if (request.argumentSetId) query.argumentSet = request.argumentSetId;
  if (request.backendId) query[SHARE_BACKEND_PARAM] = request.backendId;
  return { path, query };
}
