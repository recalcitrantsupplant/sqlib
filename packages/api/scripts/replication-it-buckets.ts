/**
 * Creates the bucket or container the replication integration test writes to,
 * on the local emulators that scripts/ci/litestream-it.sh starts.
 *
 *   tsx scripts/replication-it-buckets.ts s3|abs|gs <name>
 *
 * Reads the same environment the supervisor reads (endpoint, keys), so the
 * test proves nothing it did not have to set up.
 */
const [store, name] = process.argv.slice(2);

async function main(): Promise<void> {
  if (store === 's3') {
    const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      endpoint: process.env.SQLIB_SQLITE_REPLICA_ENDPOINT,
      region: process.env.SQLIB_SQLITE_REPLICA_REGION ?? 'us-east-1',
      forcePathStyle: true,
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: name }));
    } catch (error) {
      if ((error as { name?: string }).name !== 'BucketAlreadyOwnedByYou') throw error;
    }
  } else if (store === 'abs') {
    const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob');
    const endpoint = process.env.SQLIB_SQLITE_REPLICA_ENDPOINT!;
    const account = new URL(endpoint).pathname.replace(/\//g, '');
    const service = new BlobServiceClient(endpoint, new StorageSharedKeyCredential(account, process.env.LITESTREAM_AZURE_ACCOUNT_KEY!));
    await service.getContainerClient(name).createIfNotExists();
  } else if (store === 'gs') {
    const response = await fetch(`${process.env.STORAGE_EMULATOR_HOST}/storage/v1/b`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok && response.status !== 409) throw new Error(`create bucket: HTTP ${response.status}`);
  } else {
    throw new Error(`Unknown store "${store}". Expected s3, abs or gs.`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
