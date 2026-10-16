import { SbomNormalizedDocumentRouteContent } from "../../../sbom-normalized-document-route-content";

export default async function SbomNormalizedDocumentPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ productId: string; documentId: string }>;
  searchParams: Promise<{ sourceId?: string }>;
}>) {
  const { productId, documentId } = await params;
  const { sourceId } = await searchParams;
  return (
    <SbomNormalizedDocumentRouteContent
      productId={productId}
      documentId={documentId}
      sourceId={sourceId}
    />
  );
}
