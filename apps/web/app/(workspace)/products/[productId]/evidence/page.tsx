import { EvidenceLibrary } from "../../../../_features/evidence/evidence-library";
import { evidenceDocumentAccessParamsSchema } from "@repo/contracts/evidence";

export default async function EvidenceLibraryPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ productId: string }>;
  searchParams: Promise<{
    documentId?: string | string[];
    versionId?: string | string[];
  }>;
}>) {
  const { productId } = await params;
  const query = await searchParams;
  const linked = evidenceDocumentAccessParamsSchema.safeParse({
    productId,
    documentId: query.documentId,
    versionId: query.versionId,
  });
  return (
    <EvidenceLibrary
      productId={productId}
      selectedDocumentId={linked.success ? linked.data.documentId : null}
      selectedVersionId={linked.success ? linked.data.versionId : null}
    />
  );
}
