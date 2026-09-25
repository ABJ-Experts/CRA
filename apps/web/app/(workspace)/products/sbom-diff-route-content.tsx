"use client";

import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";

import { SbomDiffReport } from "./sbom-diff-report";

export function SbomDiffRouteContent({
  productId,
  documentId,
  sourceId,
}: Readonly<{ productId: string; documentId: string; sourceId?: string }>) {
  const { permissions, isLoading } = useSession();
  const mocksReady = useMocksReady();
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <SbomDiffReport
        productId={productId}
        documentId={documentId}
        sourceId={sourceId}
        canView={isLoading || permissions.can_view_sboms === true}
        canStart={permissions.can_upload_sboms === true}
        enabled={!isLoading && mocksReady}
      />
    </main>
  );
}
