import { SbomNormalizedDocumentRouteContent } from "../../../sbom-normalized-document-route-content";

export default async function SbomNormalizedDocumentPage({
  params,
}: Readonly<{ params: Promise<{ productId: string; documentId: string }> }>) {
  const { productId, documentId } = await params;
  return (
    <SbomNormalizedDocumentRouteContent
      productId={productId}
      documentId={documentId}
    />
  );
}
