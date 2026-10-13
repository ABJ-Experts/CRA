import { EVIDENCE_MAX_UPLOAD_BYTES } from "@repo/contracts/evidence";
import { SBOM_MAX_UPLOAD_BYTES } from "@repo/contracts/sboms";
import { BRANDING_MAX_LOGO_BYTES } from "@repo/contracts/organizations";
import { productImportMaxBytes } from "@repo/contracts/products";

/** Preserve source wire limits; staging streams even the largest artifact to disk. */
export const UPLOAD_BUCKET_LIMITS = Object.freeze({
  "reporting-evidence": 10 * 1024 * 1024,
  "evidence-documents": EVIDENCE_MAX_UPLOAD_BYTES,
  "sbom-originals": SBOM_MAX_UPLOAD_BYTES,
  "security-update-artifacts": 2_147_483_647,
  "product-imports": productImportMaxBytes,
  "organization-branding": BRANDING_MAX_LOGO_BYTES,
});

/** Match existing source upload windows while retaining one-use authority. */
export const UPLOAD_BUCKET_TTL_MS = Object.freeze({
  "reporting-evidence": 5 * 60_000,
  "evidence-documents": 15 * 60_000,
  "sbom-originals": 10 * 60_000,
  "security-update-artifacts": 2 * 60 * 60_000,
  "product-imports": 10 * 60_000,
  "organization-branding": 10 * 60_000,
});
