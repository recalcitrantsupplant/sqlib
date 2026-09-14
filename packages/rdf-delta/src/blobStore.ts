/**
 * A conditional blob store, as the checkpoint sink needs it.
 *
 * The topology this serves is per-graph blob snapshots with an ETag. Which
 * vendor, and which conditional-write semantics, is still open, and this interface is what makes
 * that decision late rather than urgent: the sink is written against the
 * protocol, and Azure, S3, a filesystem or a `Map` are four implementations of
 * it.
 *
 * ## The port folds the one difference POC-3 found
 *
 * The blob-snapshot proof of concept measured the two dialects against each
 * other and found them agreeing everywhere except create-if-absent:
 *
 * | | overwrite-if-unchanged | create-if-absent |
 * | --- | --- | --- |
 * | Azure Blob | 412 `ConditionNotMet` | **409** `BlobAlreadyExists` |
 * | S3 | 412 `PreconditionFailed` | **412** `PreconditionFailed` |
 *
 * A caller written against one and pointed at the other is wrong exactly once
 * per graph, at the moment the graph is first created — the hardest moment to
 * have covered by a test, and the one where being wrong means treating a
 * refusal as a transport error and retrying a write that must not repeat. So
 * the status code does not reach the sink: an implementation reports
 * `precondition-failed` and carries the status it saw for a caller that wants
 * to log it.
 *
 * ## Why the condition is a union rather than two optional headers
 *
 * `poc/blobSnapshot.ts` took `{ ifMatch?, ifNoneMatch? }`, which spells four
 * states for a protocol that has three — and the fourth, *neither*, is an
 * unconditional overwrite: the one write a checkpoint must never make, since it
 * lands on top of whatever another writer put there and reports success. It is
 * unrepresentable here rather than merely undocumented.
 */

/** What a write is allowed to land on. */
export type BlobPutCondition =
  /** Create only if the blob does not exist. The first checkpoint of a graph. */
  | { readonly kind: 'create' }
  /** Overwrite only if the blob still carries this ETag. Every checkpoint after. */
  | { readonly kind: 'replace'; readonly etag: string };

export type BlobPutOutcome =
  | {
      readonly outcome: 'stored';
      /**
       * The new ETag, when the service returned one.
       *
       * Optional because it is the service's choice, not the protocol's: a
       * store that answers a PUT without one leaves the next checkpoint no
       * token to hold, and the sink has to re-read the blob to get one. Better
       * to make that visible than to invent a token that would fail to match.
       */
      readonly etag?: string;
    }
  | {
      readonly outcome: 'precondition-failed';
      /** The status the service actually sent — 412 on both, 409 on Azure creates. */
      readonly status: number;
      /** The service's own error code, when it sent one. */
      readonly code?: string;
    };

export type BlobGetOutcome =
  | { readonly outcome: 'found'; readonly body: Uint8Array; readonly etag?: string }
  | { readonly outcome: 'absent' };

/**
 * The sink's whole view of storage.
 *
 * Two methods, both conditional-write shaped, neither of which knows what a
 * graph is. Anything a vendor SDK adds — leases, tiers, versioning, multipart —
 * is below this line by construction.
 */
export interface ConditionalBlobStore {
  get(key: string): Promise<BlobGetOutcome>;
  put(key: string, body: Uint8Array, condition: BlobPutCondition): Promise<BlobPutOutcome>;
}

/**
 * An in-memory store, for tests and for a caller that has not chosen a vendor.
 *
 * It is the protocol and nothing else: no latency, no durability, no
 * consistency window. ETags are minted per write rather than derived from the
 * body, which is Azure's behaviour and the stricter of the two — a caller that
 * assumed identical bytes keep their ETag would "detect no change" and skip a
 * write it owed, and would pass against an S3-shaped fake.
 */
export function memoryConditionalBlobStore(): ConditionalBlobStore & {
  peek(key: string): { body: Uint8Array; etag: string } | undefined;
} {
  const blobs = new Map<string, { body: Uint8Array; etag: string }>();
  let minted = 0;

  return {
    peek: (key) => blobs.get(key),

    async get(key) {
      const existing = blobs.get(key);
      if (!existing) return { outcome: 'absent' };
      return { outcome: 'found', body: existing.body, etag: existing.etag };
    },

    async put(key, body, condition) {
      const existing = blobs.get(key);
      if (condition.kind === 'create') {
        if (existing) return { outcome: 'precondition-failed', status: 409, code: 'BlobAlreadyExists' };
      } else if (!existing || existing.etag !== condition.etag) {
        // A missing blob fails a replace too. There is no ETag for the token to
        // match, and turning that into a create would resurrect a graph
        // somebody deleted.
        return { outcome: 'precondition-failed', status: 412, code: 'ConditionNotMet' };
      }

      minted += 1;
      const etag = `"mem-${minted}"`;
      blobs.set(key, { body, etag });
      return { outcome: 'stored', etag };
    },
  };
}
