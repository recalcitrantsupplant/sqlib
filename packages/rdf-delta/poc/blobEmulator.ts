/**
 * A local conditional-write blob store, in two dialects.
 *
 * The third proof of concept in the delta-storage work asks for
 * "serialize/PUT/GET/parse one named graph at several sizes with conditional
 * PUT; two concurrent writers, one loses, rebase", and says it "should target
 * the one that will actually be deployed" — which is still undecided, so this
 * targets **both**, the only way to find out whether the choice matters to the
 * caller. It does; see `poc/blobRun.ts`.
 *
 * ## What this is and is not
 *
 * It is a faithful model of the two services' **conditional-write protocol**:
 * which header means what, which status code comes back, and what a caller has
 * to do about it. That is a logic question with a definite answer, and pinning
 * it in `test/blobSnapshot.test.ts` is worth more than a number from one
 * afternoon's network weather.
 *
 * It is **not** a model of their latency, throughput, durability or
 * consistency. Every timing this server appears in is therefore a *floor* — the
 * cost of the protocol with the network removed — and the run reports it as
 * one. The numbers POC-3 actually needs (the checkpoint pause, the parse on
 * boot, the ceiling) do not involve it at all: they are oxigraph's, measured
 * before a byte moves.
 *
 * The table below is written from the two services' **published semantics**.
 * Nothing here has been run against a real container or bucket, so treat it as
 * the shape a caller should be written to and confirm the create-if-absent
 * status against whichever service is actually deployed.
 *
 * ## The dialect difference, which is the point
 *
 * | | overwrite-if-unchanged (`If-Match: <etag>`) | create-if-absent (`If-None-Match: *`) |
 * | --- | --- | --- |
 * | Azure Blob | 412 `ConditionNotMet` | **409** `BlobAlreadyExists` |
 * | S3 | 412 `PreconditionFailed` | **412** `PreconditionFailed` |
 *
 * The first row agrees, and it is the one a checkpoint loop spends its life in.
 * The second does not, and it is the one a *first* checkpoint takes — so a
 * caller written against S3 and pointed at Azure sees a status it does not
 * recognise exactly once per graph, at the moment the graph is created, which
 * is the hardest moment to have covered by a test.
 *
 * ETags are opaque on both, and deliberately shaped differently here so that a
 * caller which parses one cannot pass: Azure mints a quoted hex timestamp,
 * S3 a quoted MD5 of the body. Neither is anything but a token to echo back.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export type BlobDialect = 'azure' | 's3';

/** One stored object. */
interface StoredBlob {
  body: Buffer;
  etag: string;
}

export interface BlobEmulator {
  /** Base URL, e.g. `http://127.0.0.1:41234`. */
  readonly url: string;
  readonly dialect: BlobDialect;
  /** Requests served, by method — the run reports it so a retry cannot hide. */
  readonly counts: { get: number; put: number; conflicts: number };
  close(): Promise<void>;
  /** Test seam: what the store holds, without going through HTTP. */
  peek(key: string): StoredBlob | undefined;
}

function mintEtag(dialect: BlobDialect, body: Buffer): string {
  if (dialect === 's3') return `"${createHash('md5').update(body).digest('hex')}"`;
  // Azure's ETag is a snapshot token, not a digest of the content: two PUTs of
  // identical bytes get different ETags. Modelled, because a caller that
  // assumed otherwise would "detect no change" and skip a legitimate write.
  return `"0x8D${randomBytes(7).toString('hex').toUpperCase()}"`;
}

function errorBody(dialect: BlobDialect, code: string): string {
  return dialect === 'azure'
    ? `<?xml version="1.0" encoding="utf-8"?><Error><Code>${code}</Code></Error>`
    : `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;
}

/**
 * Start the emulator on an ephemeral port.
 *
 * The key is the path, so a caller partitions by naming its blobs — which is
 * what "partition per named graph" means at this layer: one blob per graph,
 * and a writer touching G contends only with G's writers.
 */
export async function startBlobEmulator(dialect: BlobDialect): Promise<BlobEmulator> {
  const blobs = new Map<string, StoredBlob>();
  const counts = { get: 0, put: 0, conflicts: 0 };

  const fail = (res: ServerResponse, status: number, code: string): void => {
    counts.conflicts += 1;
    res.writeHead(status, { 'content-type': 'application/xml' });
    res.end(errorBody(dialect, code));
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const key = (req.url ?? '/').replace(/^\//, '');
    const existing = blobs.get(key);

    if (req.method === 'GET') {
      counts.get += 1;
      if (!existing) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        etag: existing.etag,
        'content-type': 'application/n-triples',
        'content-length': String(existing.body.byteLength),
      });
      res.end(existing.body);
      return;
    }

    if (req.method !== 'PUT') {
      res.writeHead(405).end();
      return;
    }

    counts.put += 1;
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];

    // create-if-absent. The one place the two services disagree.
    if (ifNoneMatch === '*') {
      if (existing) {
        fail(res, dialect === 'azure' ? 409 : 412, dialect === 'azure' ? 'BlobAlreadyExists' : 'PreconditionFailed');
        return;
      }
    } else if (typeof ifMatch === 'string') {
      // overwrite-if-unchanged. A missing blob fails the condition too: there
      // is no ETag for the caller's token to match, and treating that as a
      // create would resurrect a graph someone deleted.
      if (!existing || existing.etag !== ifMatch) {
        fail(res, 412, dialect === 'azure' ? 'ConditionNotMet' : 'PreconditionFailed');
        return;
      }
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const etag = mintEtag(dialect, body);
      blobs.set(key, { body, etag });
      res.writeHead(existing ? 200 : 201, { etag }).end();
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    dialect,
    counts,
    peek: (key: string) => blobs.get(key),
    async close(): Promise<void> {
      server.close();
      await once(server, 'close');
    },
  };
}

/** The status a failed conditional write carries, per dialect and condition. */
export function expectedConflictStatus(dialect: BlobDialect, condition: 'if-match' | 'if-none-match'): number {
  if (condition === 'if-match') return 412;
  return dialect === 'azure' ? 409 : 412;
}
