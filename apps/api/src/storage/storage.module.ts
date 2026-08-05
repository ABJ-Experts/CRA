import { Global, Module } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  InMemoryStorageProvider,
  type StorageProvider,
} from './storage-provider';
import { S3StorageProvider, type S3StorageConfig } from './s3-storage-provider';

/**
 * FR-DEP-002: configuration is validated at startup with an error that names the
 * offending variable. A misconfigured storage layer must not surface as a failed
 * upload hours later — evidence and SBOM originals are the product's output.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is required when STORAGE_DRIVER=s3. ` +
        `Set it, or use STORAGE_DRIVER=memory for local development.`,
    );
  return value;
}

export function buildStorageProvider(): StorageProvider {
  // Explicit rather than inferred. Silently falling back to an in-process store
  // because an endpoint was missing is how a deployment discovers six months
  // later that its evidence was never persisted.
  const driver = process.env.STORAGE_DRIVER ?? 'memory';

  if (driver === 'memory') return new InMemoryStorageProvider();

  if (driver !== 's3')
    throw new Error(
      `STORAGE_DRIVER must be 's3' or 'memory', received '${driver}'.`,
    );

  const config: S3StorageConfig = {
    endpoint: required('STORAGE_ENDPOINT'),
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    bucket: required('STORAGE_BUCKET'),
    accessKeyId: required('STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: required('STORAGE_SECRET_ACCESS_KEY'),
    signedUrlTtlSeconds: Number(process.env.STORAGE_SIGNED_URL_TTL ?? 300),
  };
  return new S3StorageProvider(config);
}

/**
 * Global because two modules need the same object store: evidence documents
 * (FR-EVD-001) and byte-exact SBOM originals (FR-SBOM-003). Registering it per
 * module would give each its own in-memory instance under STORAGE_DRIVER=memory,
 * which is exactly the bug the shared token exists to prevent.
 */
@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useFactory: buildStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
