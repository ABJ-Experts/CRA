"use client";

import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";

import { SbomNormalizedDocumentDetail } from "./sbom-normalized-document-detail";

export function SbomNormalizedDocumentRouteContent({
  productId,
  documentId,
  sourceId,
}: Readonly<{ productId: string; documentId: string; sourceId?: string }>) {
  const { permissions, isLoading } = useSession();
  const mocksReady = useMocksReady();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <SbomNormalizedDocumentDetail
        productId={productId}
        documentId={documentId}
        sourceId={sourceId}
        canView={permissions.can_view_sboms === true}
        enabled={!isLoading && mocksReady}
      />
    </main>
  );
}
