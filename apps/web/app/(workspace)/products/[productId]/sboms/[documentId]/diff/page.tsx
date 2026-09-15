import { SbomDiffRouteContent } from "../../../../sbom-diff-route-content";

export default async function SbomDiffPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ productId: string; documentId: string }>;
  searchParams: Promise<{ sourceId?: string }>;
}>) {
  const { productId, documentId } = await params;
  const { sourceId } = await searchParams;
  return (
    <SbomDiffRouteContent
      productId={productId}
      documentId={documentId}
      sourceId={sourceId}
    />
  );
}
