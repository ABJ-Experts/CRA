import { Injectable } from '@nestjs/common';

// Adapter (ADR-013): object storage behind our contract so the domain never
// imports an S3 SDK directly. Bytes live here; only metadata + hash live in PG.
// One S3 code path covers Supabase Storage (cloud) and MinIO (on premises), so
// an on-premises customer can point us at storage they already run.
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Time-boxed download URL (ADR-002: the browser fetches bytes via signed URL). */
  signedUrl(key: string): Promise<string>;
}

/**
 * Development and test transport: in-process store. Deterministic and
 * dependency-free so tamper detection is testable (a test can mutate a stored
 * buffer). Never select this in a deployment that keeps evidence — it is
 * per-process, so the API and the worker would not see each other's objects,
 * and nothing survives a restart. StorageModule refuses to default to it.
 */
@Injectable()
export class InMemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, Buffer>();

  put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const bytes = this.objects.get(key);
    if (!bytes) return Promise.reject(new Error(`No object at ${key}`));
    return Promise.resolve(bytes);
  }

  signedUrl(key: string): Promise<string> {
    return Promise.resolve(`memory://${key}`);
  }

  /** Test seam: simulate tampering with the stored bytes. */
  overwriteForTest(key: string, bytes: Buffer): void {
    this.objects.set(key, Buffer.from(bytes));
  }
}
