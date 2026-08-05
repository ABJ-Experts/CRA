import { Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './storage-provider';

/**
 * ADR-013: the only place in the codebase that speaks S3. Supabase Storage and
 * MinIO expose the same API, so there is no per-deployment branch here — only
 * configuration. `forcePathStyle` is required by both (neither serves
 * virtual-host-style bucket subdomains).
 */
export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Signed URL lifetime in seconds. ADR-002 wants these short lived. */
  signedUrlTtlSeconds: number;
}

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, bytes: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType ?? 'application/octet-stream',
        // SEC-010: stored artefacts are attacker-influenced bytes. Never let a
        // browser render them inline off the storage origin.
        ContentDisposition: 'attachment',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`No object at ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  signedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: this.config.signedUrlTtlSeconds },
    );
  }

  /** Release the underlying socket pool (graceful shutdown, FR-JOB-006). */
  destroy(): void {
    this.client.destroy();
  }
}
