/**
 * Share links: a URL someone else can open to see what you are looking at.
 *
 * Two shapes, because there are two kinds of thing on screen:
 *
 * - **A saved entity** already has a URL — `?query=<iri>&version=3` — and it
 *   means the same thing in every browser pointed at the same server. Sharing
 *   it is copying it.
 *
 * - **A scratch item** has a `?scratch=urn:ui-temp:…` URL, and that is a
 *   pointer into *this* browser's localStorage: it resolves nowhere else. So
 *   the link carries the item itself — name, description, body — encoded into
 *   the fragment (`#share=…`). Opening it imports a fresh scratch copy into the
 *   recipient's browser and the address bar then shows *their* `?scratch=` id,
 *   exactly as if they had pressed `+ New` and pasted.
 *
 * Why import-then-rewrite rather than keep the encoded body as the page's URL:
 * the body is edited, and a URL that is the document is either rewritten on
 * every keystroke (a history entry, or a replace, per character, and a
 * multi-kilobyte address bar) or goes stale the moment you type. The scratch
 * record is already the one live copy; the share link is a snapshot of it
 * taken when Share is pressed, and pressing Share again takes a new one.
 *
 * Why the fragment rather than a query parameter: the fragment never reaches a
 * server, so the body is not written into proxy or access logs, and no server
 * or CDN's URL-length limit applies to it.
 *
 * Only queries and rule sets can be shared this way. Their bodies are
 * self-contained text; a scratch group's canvas refers to saved queries by id,
 * and the other sections' bodies are mostly references to saved entities, so
 * a snapshot of either would open as a picture of things that may not exist.
 */
import type { DraftSection } from '@/composables/useCallableDrafts';

/** The fragment key a scratch share link carries its payload under. */
export const SHARE_FRAGMENT_KEY = 'share';

/** Scratch sections whose body can travel in a link. */
export const SHAREABLE_SCRATCH_SECTIONS = ['query', 'rule'] as const;
export type ShareableScratchSection = (typeof SHAREABLE_SCRATCH_SECTIONS)[number];

export function isShareableScratchSection(section: DraftSection | string | null | undefined): section is ShareableScratchSection {
  return (SHAREABLE_SCRATCH_SECTIONS as readonly string[]).includes(section ?? '');
}

/** What a scratch share link carries. Versioned so the shape can change. */
export interface ScratchSharePayload {
  section: ShareableScratchSection;
  name: string;
  description: string | null;
  body: unknown;
  defaultBackend?: string | null;
}

interface WirePayload {
  v: 1;
  s: ShareableScratchSection;
  n: string;
  d?: string | null;
  b: unknown;
  k?: string | null;
}

/*
 * The encoded form is `<format>.<base64url>`: `z` for deflate-raw, `j` for
 * plain JSON where the browser has no CompressionStream. SPARQL compresses to
 * roughly a third, which is the difference between a link that pastes into a
 * chat message and one that does not.
 */
const COMPRESSED = 'z';
const PLAIN = 'j';

function hasCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeSharePayload(payload: ScratchSharePayload): Promise<string> {
  const wire: WirePayload = { v: 1, s: payload.section, n: payload.name, b: payload.body };
  if (payload.description) wire.d = payload.description;
  if (payload.defaultBackend) wire.k = payload.defaultBackend;
  const json = new TextEncoder().encode(JSON.stringify(wire));
  if (hasCompression()) {
    return `${COMPRESSED}.${toBase64Url(await pipeThrough(json, new CompressionStream('deflate-raw')))}`;
  }
  return `${PLAIN}.${toBase64Url(json)}`;
}

/**
 * The payload a link carries, or null for anything that is not one.
 *
 * Never throws: the input is whatever someone pasted, and a truncated or
 * hand-edited link should say so, not break the page.
 */
export async function decodeSharePayload(encoded: string): Promise<ScratchSharePayload | null> {
  try {
    const dot = encoded.indexOf('.');
    if (dot < 0) return null;
    const format = encoded.slice(0, dot);
    let bytes = fromBase64Url(encoded.slice(dot + 1));
    if (format === COMPRESSED) {
      if (!hasCompression()) return null;
      bytes = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
    } else if (format !== PLAIN) {
      return null;
    }
    const wire = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WirePayload>;
    if (wire?.v !== 1 || !isShareableScratchSection(wire.s) || typeof wire.n !== 'string') return null;
    if (wire.s === 'query' && typeof wire.b !== 'string') return null;
    if (wire.s === 'rule' && (typeof wire.b !== 'object' || wire.b === null)) return null;
    return {
      section: wire.s,
      name: wire.n,
      description: typeof wire.d === 'string' ? wire.d : null,
      body: wire.b,
      defaultBackend: typeof wire.k === 'string' ? wire.k : null,
    };
  } catch {
    return null;
  }
}

/** The encoded payload in a location hash (`#share=…`), or null. */
export function sharePayloadFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const value = params.get(SHARE_FRAGMENT_KEY);
  return value ? value : null;
}

/**
 * The link for a saved entity: the page's own URL, minus the fragment.
 *
 * The address bar is already kept canonical by the selection watcher, so it
 * names the entity (and version) on screen. `section` is kept too — it is the
 * rail scope, and landing in the same section is part of seeing the same thing.
 */
export function savedShareUrl(location: Pick<Location, 'origin' | 'pathname' | 'search'>): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

/**
 * The link for a scratch item: the app's root with the payload in the fragment.
 * No query string — the recipient gets a new scratch id of their own.
 */
export async function scratchShareUrl(
  location: Pick<Location, 'origin' | 'pathname'>,
  payload: ScratchSharePayload,
): Promise<string> {
  const encoded = await encodeSharePayload(payload);
  return `${location.origin}${location.pathname}#${SHARE_FRAGMENT_KEY}=${encoded}`;
}
