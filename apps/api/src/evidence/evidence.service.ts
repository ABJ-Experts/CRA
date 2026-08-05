import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { evidenceDocument, withTenant } from '../db';
import { recordAuditInTx } from '../audit';
import { DomainError } from '../product';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage';

export interface UploadEvidenceInput {
  title: string;
  classification: string;
  productId?: string;
  validFrom?: string; // ISO date
  validUntil?: string;
  content: Buffer;
  contentType?: string;
}

export interface EvidenceView {
  id: string;
  title: string;
  classification: string;
  productId: string | null;
  contentHash: string;
  sizeBytes: number;
  tamperState: 'unverified' | 'intact' | 'tampered';
  uploadedAt: string;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

@Injectable()
export class EvidenceService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** FR-EVD-001/003: store bytes + capture the content hash at upload time. */
  async upload(
    organisationId: string,
    userAccountId: string,
    input: UploadEvidenceInput,
  ): Promise<EvidenceView> {
    const id = uuidv7();
    const contentHash = sha256(input.content);
    const storageKey = `evidence/${organisationId}/${id}`;
    // Write bytes first: an orphaned object is harmless, an orphaned row is not.
    await this.storage.put(storageKey, input.content, input.contentType);

    return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
      const [row] = await tx
        .insert(evidenceDocument)
        .values({
          id,
          organisationId,
          title: input.title,
          classification: input.classification,
          productId: input.productId ?? null,
          ownerUserId: userAccountId,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          storageKey,
          contentHash,
          contentType: input.contentType ?? null,
          sizeBytes: input.content.length,
          tamperState: 'intact',
          uploadedBy: userAccountId,
        })
        .returning();
      await recordAuditInTx(tx, organisationId, {
        actorType: 'user',
        actorId: userAccountId,
        action: 'evidence.uploaded',
        resourceType: 'evidence_document',
        resourceId: id,
        afterState: { title: input.title, contentHash },
      });
      // A single-row INSERT ... RETURNING always yields a row. If it somehow did
      // not, the audit event above has already been written for a document that
      // does not exist, so fail loudly rather than return a half-built view.
      if (!row) throw new Error('evidence insert returned no row');
      return toView(row);
    });
  }

  list(organisationId: string): Promise<EvidenceView[]> {
    return withTenant({ organisationId }, async (tx) => {
      const rows = await tx
        .select()
        .from(evidenceDocument)
        .orderBy(desc(evidenceDocument.uploadedAt));
      return rows.map(toView);
    });
  }

  /**
   * FR-EVD-003: on retrieval, re-hash the stored bytes and compare to the hash
   * captured at upload. A mismatch flags tampering, persists the verdict, and is
   * audited — a downloadable-but-tampered document must never look pristine.
   */
  async retrieve(
    organisationId: string,
    userAccountId: string,
    id: string,
  ): Promise<{ evidence: EvidenceView; signedUrl: string | null }> {
    const row = await withTenant({ organisationId }, async (tx) => {
      const [r] = await tx
        .select()
        .from(evidenceDocument)
        .where(eq(evidenceDocument.id, id))
        .limit(1);
      return r;
    });
    if (!row) throw new DomainError('not_found', 'Evidence not found');

    const bytes = await this.storage.get(row.storageKey);
    const actualHash = sha256(bytes);
    const intact = actualHash === row.contentHash;
    const tamperState: EvidenceView['tamperState'] = intact
      ? 'intact'
      : 'tampered';

    if (row.tamperState !== tamperState) {
      await withTenant(
        { organisationId, userId: userAccountId },
        async (tx) => {
          await tx
            .update(evidenceDocument)
            .set({ tamperState })
            .where(eq(evidenceDocument.id, id));
          await recordAuditInTx(tx, organisationId, {
            actorType: 'user',
            actorId: userAccountId,
            action: 'evidence.integrity_checked',
            resourceType: 'evidence_document',
            resourceId: id,
            beforeState: { tamperState: row.tamperState },
            afterState: {
              tamperState,
              expected: row.contentHash,
              actual: actualHash,
            },
          });
        },
      );
    }

    const signedUrl = intact
      ? await this.storage.signedUrl(row.storageKey)
      : null;
    return { evidence: toView({ ...row, tamperState }), signedUrl };
  }
}

function toView(row: typeof evidenceDocument.$inferSelect): EvidenceView {
  return {
    id: row.id,
    title: row.title,
    classification: row.classification,
    productId: row.productId,
    contentHash: row.contentHash,
    sizeBytes: row.sizeBytes,
    tamperState: row.tamperState as EvidenceView['tamperState'],
    uploadedAt: row.uploadedAt.toISOString(),
  };
}
