import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { detectFormat, parseSbom, type ParsedSbom } from '@repo/sbom-core';
import { productRelease, sbomComponent, sbomDocument, withTenant } from '../db';
import { recordAuditInTx } from '../audit';
import { DomainError } from '../product';
import type { StorageProvider } from '../storage';

/**
 * FR-SBOM-003: the byte-exact original is the evidence; the parsed components are
 * only an index over it. Keying the object by content hash rather than document id
 * makes the write idempotent, lets it happen safely before the transaction opens,
 * and means the key is derivable from `sbom_document.content_hash` alone.
 */
export function rawSbomKey(
  organisationId: string,
  contentHash: string,
): string {
  return `sbom/${organisationId}/${contentHash}`;
}

export interface ReleaseView {
  id: string;
  productId: string;
  versionLabel: string;
  lifecycleState: string;
  sbomCount: number;
  createdAt: string;
}

/** List releases (optionally for one product) with their SBOM count, for the UI. */
export async function listReleases(
  organisationId: string,
  productId?: string,
): Promise<ReleaseView[]> {
  return withTenant({ organisationId }, async (tx) => {
    const releases = await tx
      .select()
      .from(productRelease)
      .where(productId ? eq(productRelease.productId, productId) : undefined)
      .orderBy(desc(productRelease.createdAt));
    const docs = await tx
      .select({ releaseId: sbomDocument.productReleaseId })
      .from(sbomDocument);
    const counts = new Map<string, number>();
    for (const d of docs) {
      counts.set(d.releaseId, (counts.get(d.releaseId) ?? 0) + 1);
    }
    return releases.map((r) => ({
      id: r.id,
      productId: r.productId,
      versionLabel: r.versionLabel,
      lifecycleState: r.lifecycleState,
      sbomCount: counts.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

function isUniqueViolation(e: unknown): boolean {
  return (
    (e as { code?: string }).code === '23505' ||
    (e as { cause?: { code?: string } }).cause?.code === '23505'
  );
}

export async function createRelease(
  organisationId: string,
  userAccountId: string,
  productId: string,
  versionLabel: string,
): Promise<{ id: string }> {
  const id = uuidv7();
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    try {
      await tx.insert(productRelease).values({
        id,
        organisationId,
        productId,
        versionLabel,
        createdBy: userAccountId,
        updatedBy: userAccountId,
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new DomainError(
          'conflict',
          `Release "${versionLabel}" already exists`,
        );
      }
      throw e;
    }
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'release.created',
      resourceType: 'product_release',
      resourceId: id,
      afterState: { productId, versionLabel },
    });
    return { id };
  });
}

export interface IngestResult {
  sbomDocumentId: string;
  validationStatus: 'valid' | 'valid_with_warnings' | 'invalid';
  componentCount: number;
  deduplicated: boolean;
}

/**
 * FR-SBOM-002/003/004/007: single ingest pipeline. Stores the byte-exact original
 * hash, validates, and persists normalised components. An invalid document is
 * stored and reported, never quietly dropped. Identical re-uploads dedup by hash.
 */
export async function ingestSbom(
  organisationId: string,
  userAccountId: string,
  productReleaseId: string,
  raw: string,
  storage: StorageProvider,
  source = 'manual_upload',
): Promise<IngestResult> {
  const contentHash = createHash('sha256').update(raw).digest('hex');
  const rawObjectKey = rawSbomKey(organisationId, contentHash);

  // Write bytes first: an orphaned object is harmless, an orphaned row is not.
  // This runs for invalid documents too — FR-SBOM-004 stores and reports them,
  // never quietly drops them, and the original is what an authority would ask for.
  await storage.put(rawObjectKey, Buffer.from(raw, 'utf8'), 'application/json');

  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [rel] = await tx
      .select({ id: productRelease.id })
      .from(productRelease)
      .where(eq(productRelease.id, productReleaseId))
      .limit(1);
    if (!rel) throw new DomainError('not_found', 'Product release not found');

    const [existing] = await tx
      .select({
        id: sbomDocument.id,
        validationStatus: sbomDocument.validationStatus,
        componentCount: sbomDocument.componentCount,
      })
      .from(sbomDocument)
      .where(
        and(
          eq(sbomDocument.productReleaseId, productReleaseId),
          eq(sbomDocument.contentHash, contentHash),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        sbomDocumentId: existing.id,
        validationStatus:
          existing.validationStatus as IngestResult['validationStatus'],
        componentCount: existing.componentCount,
        deduplicated: true,
      };
    }

    const docId = uuidv7();
    let parsed: ParsedSbom | null = null;
    let validationStatus: IngestResult['validationStatus'] = 'valid';
    let validationReport: Record<string, unknown> = {};
    try {
      parsed = parseSbom(raw);
    } catch (e) {
      validationStatus = 'invalid';
      validationReport = {
        error: e instanceof Error ? e.message : 'parse failed',
      };
    }

    await tx.insert(sbomDocument).values({
      id: docId,
      organisationId,
      productReleaseId,
      format: parsed?.format ?? detectFormat(raw) ?? 'cyclonedx',
      specVersion: parsed?.specVersion ?? 'unknown',
      serialNumber: parsed?.serialNumber ?? null,
      source,
      rawObjectKey,
      contentHash,
      validationStatus,
      validationReport,
      componentCount: parsed?.componentCount ?? 0,
      depthMax: parsed?.depthMax ?? 0,
      createdBy: userAccountId,
    });

    if (parsed && parsed.components.length > 0) {
      await tx.insert(sbomComponent).values(
        parsed.components.map((c) => ({
          id: uuidv7(),
          organisationId,
          sbomDocumentId: docId,
          purl: c.purl,
          cpe: c.cpe,
          name: c.name,
          version: c.version,
          ecosystem: c.ecosystem,
          versionNormalised: c.versionNormalised,
          scope: c.scope,
          depth: c.depth,
          supplierName: c.supplierName,
          hashes: c.hashes,
        })),
      );
    }

    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'sbom.ingested',
      resourceType: 'sbom_document',
      resourceId: docId,
      afterState: {
        format: parsed?.format,
        componentCount: parsed?.componentCount ?? 0,
        validationStatus,
      },
    });

    return {
      sbomDocumentId: docId,
      validationStatus,
      componentCount: parsed?.componentCount ?? 0,
      deduplicated: false,
    };
  });
}
