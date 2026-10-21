/**
 * A share link: an unsaved body carried in the URL itself.
 *
 * A scratch item lives in one browser's storage under a `urn:ui-temp:` id, so
 * its own URL opens nothing anywhere else. To hand one to a colleague — or to
 * share a query from a deployment you cannot write to — the link has to carry
 * the content, not the id. The id is never sent: the recipient's browser mints
 * its own when the body lands, so two people's scratch items cannot collide.
 *
 * The payload rides in the fragment, `/<section>#share=v1.<data>`. Browsers do
 * not send a fragment to the server, so the text never reaches a request log
 * or a proxy's URL length limit. The section in the path says what kind of
 * thing the body is; the payload only says what it holds.
 *
 * `<data>` is the JSON payload, deflated and base64url-encoded. The `v1.` tag
 * is there so a later encoding can be read beside this one.
 */

export const SHARE_FRAGMENT_KEY = 'share';

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

export interface SharePayload {
  /** The editor body, in the scratch store's own terms: SPARQL text for a query. */
  body: string;
  name?: string;
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
  const json: SharePayload = { body: payload.body };
  const name = payload.name?.trim();
  if (name) json.name = name;
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
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { body?: unknown }).body !== 'string') {
    throw new ShareLinkError('The share link is damaged.');
  }
  const record = parsed as { body: string; name?: unknown };
  const payload: SharePayload = { body: record.body };
  if (typeof record.name === 'string' && record.name.trim()) {
    payload.name = record.name.trim().slice(0, MAX_NAME_LENGTH);
  }
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
