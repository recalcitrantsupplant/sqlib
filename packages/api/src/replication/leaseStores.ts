/**
 * The lease object on S3, Azure Blob Storage and GCS.
 *
 * Each SDK is an optional dependency, loaded only when the lease is on. Each
 * uses its cloud's default credential chain, the same one Litestream uses, so
 * one identity serves both: an IAM role or static keys on S3, a managed
 * identity, SAS or account key on Azure, a service account on GCS.
 */
import type { LeaseObjectStore } from './lease.js';
import { leaseKeyFor, type ReplicaLocation, type ReplicaSettings } from './settings.js';

async function load<T>(name: string, importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    throw new Error(
      `The replica lease needs the optional package ${name}, which is not installed (${(error as Error).message}). ` +
        'Install it, or set SQLIB_SQLITE_REPLICA_LEASE=off on a platform that never runs two instances at once.',
      { cause: error }
    );
  }
}

function statusOf(error: unknown): number | undefined {
  const e = error as { $metadata?: { httpStatusCode?: number }; statusCode?: number; code?: number | string };
  return e?.$metadata?.httpStatusCode ?? e?.statusCode ?? (typeof e?.code === 'number' ? e.code : undefined);
}

/** Lost a conditional write: 412 everywhere, 409 for some S3 and Azure races. */
function isConflict(error: unknown): boolean {
  const status = statusOf(error);
  return status === 412 || status === 409;
}

async function s3Store(location: ReplicaLocation, settings: ReplicaSettings): Promise<LeaseObjectStore> {
  const s3 = await load('@aws-sdk/client-s3', () => import('@aws-sdk/client-s3'));
  const client = new s3.S3Client({
    region: settings.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
  });
  const Bucket = location.bucket;
  const Key = leaseKeyFor(location);

  const put = async (body: string, condition: { IfNoneMatch: string } | { IfMatch: string }) => {
    try {
      const result = await client.send(
        new s3.PutObjectCommand({ Bucket, Key, Body: body, ContentType: 'application/json', ...condition })
      );
      return result.ETag ?? null;
    } catch (error) {
      if (isConflict(error)) return null;
      throw error;
    }
  };

  return {
    description: `s3://${Bucket}/${Key}`,
    async read() {
      try {
        const result = await client.send(new s3.GetObjectCommand({ Bucket, Key }));
        const body = (await result.Body?.transformToString()) ?? '';
        return result.ETag ? { body, version: result.ETag } : null;
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },
    create: (body) => put(body, { IfNoneMatch: '*' }),
    replace: (body, version) => put(body, { IfMatch: version }),
  };
}

async function azureStore(location: ReplicaLocation, settings: ReplicaSettings): Promise<LeaseObjectStore> {
  const blob = await load('@azure/storage-blob', () => import('@azure/storage-blob'));
  const account = location.account!;
  const base = (settings.endpoint ?? `https://${account}.blob.core.windows.net`).replace(/\/+$/, '');
  const key = leaseKeyFor(location);
  const sas = process.env.SQLIB_SQLITE_REPLICA_AZURE_SAS?.trim().replace(/^\?/, '');
  const accountKey = process.env.LITESTREAM_AZURE_ACCOUNT_KEY?.trim();

  let service: InstanceType<typeof blob.BlobServiceClient>;
  if (sas) {
    service = new blob.BlobServiceClient(`${base}?${sas}`);
  } else if (accountKey) {
    service = new blob.BlobServiceClient(base, new blob.StorageSharedKeyCredential(account, accountKey));
  } else {
    const identity = await load('@azure/identity', () => import('@azure/identity'));
    service = new blob.BlobServiceClient(base, new identity.DefaultAzureCredential());
  }
  const client = service.getContainerClient(location.bucket).getBlockBlobClient(key);

  const upload = async (body: string, conditions: { ifNoneMatch: string } | { ifMatch: string }) => {
    try {
      const result = await client.upload(body, Buffer.byteLength(body), {
        conditions,
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
      return result.etag ?? null;
    } catch (error) {
      if (isConflict(error)) return null;
      throw error;
    }
  };

  return {
    description: `abs://${account}@${location.bucket}/${key}`,
    async read() {
      try {
        // One response carries both the body and its ETag, so they always match.
        const response = await client.download();
        const chunks: Buffer[] = [];
        for await (const chunk of response.readableStreamBody ?? []) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
        }
        return response.etag ? { body: Buffer.concat(chunks).toString('utf8'), version: response.etag } : null;
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },
    create: (body) => upload(body, { ifNoneMatch: '*' }),
    replace: (body, version) => upload(body, { ifMatch: version }),
  };
}

/**
 * A GCS client. With `STORAGE_EMULATOR_HOST` set (tests, fake-gcs-server), the
 * Go SDK in Litestream wants a bare host and adds `/storage/v1` itself, while
 * the Node SDK takes the variable as the whole base URL. So the host is given
 * as `apiEndpoint` instead, with the variable hidden while the client is made,
 * and put back at once for Litestream.
 */
function gcsClient<T>(Storage: new (options?: { apiEndpoint?: string }) => T): T {
  const emulator = process.env.STORAGE_EMULATOR_HOST;
  if (!emulator || /\/storage\/v1\/?$/.test(emulator)) return new Storage();
  delete process.env.STORAGE_EMULATOR_HOST;
  try {
    return new Storage({ apiEndpoint: emulator.includes('://') ? emulator : `http://${emulator}` });
  } finally {
    process.env.STORAGE_EMULATOR_HOST = emulator;
  }
}

async function gcsStore(location: ReplicaLocation): Promise<LeaseObjectStore> {
  const gcs = await load('@google-cloud/storage', () => import('@google-cloud/storage'));
  const storage = gcsClient(gcs.Storage);
  const name = leaseKeyFor(location);
  const file = storage.bucket(location.bucket).file(name);

  const save = async (body: string, ifGenerationMatch: number | string) => {
    try {
      await file.save(body, {
        resumable: false,
        contentType: 'application/json',
        preconditionOpts: { ifGenerationMatch: Number(ifGenerationMatch) },
      });
      const [metadata] = await file.getMetadata();
      return metadata.generation === undefined ? null : String(metadata.generation);
    } catch (error) {
      if (isConflict(error)) return null;
      throw error;
    }
  };

  return {
    description: `gs://${location.bucket}/${name}`,
    async read() {
      try {
        // Metadata first: if the object changes before the download, the
        // generation is the older one and a replace based on it fails safely.
        const [metadata] = await file.getMetadata();
        const [contents] = await file.download();
        return metadata.generation === undefined ? null : { body: contents.toString('utf8'), version: String(metadata.generation) };
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },
    create: (body) => save(body, 0),
    replace: (body, version) => save(body, version),
  };
}

export async function createLeaseStore(settings: ReplicaSettings): Promise<LeaseObjectStore> {
  const location = settings.location;
  if (!location) throw new Error('The replica lease needs SQLIB_SQLITE_REPLICA_URL.');
  switch (location.scheme) {
    case 's3':
      return s3Store(location, settings);
    case 'abs':
      return azureStore(location, settings);
    case 'gs':
      return gcsStore(location);
  }
}
