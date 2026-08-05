// Public interface (Facade) for the storage module. ADR-013: every binary in the
// system — evidence documents and byte-exact SBOM originals — goes through this
// one port, so cloud and on-premises share a single code path.
export {
  STORAGE_PROVIDER,
  InMemoryStorageProvider,
  type StorageProvider,
} from './storage-provider';
export { S3StorageProvider, type S3StorageConfig } from './s3-storage-provider';
export { StorageModule, buildStorageProvider } from './storage.module';
