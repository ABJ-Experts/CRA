import { SupplierDetailContent } from "../../../_features/suppliers/supplier-detail-content";
import { supplierEvidenceRequestParamsSchema } from "@repo/contracts/supplier-evidence";

export default async function SupplierDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<{ requestId?: string | string[] }>;
}>) {
  const { supplierId } = await params;
  const query = await searchParams;
  const parsed = supplierEvidenceRequestParamsSchema.safeParse({
    requestId: query.requestId,
  });
  return (
    <SupplierDetailContent
      supplierId={supplierId}
      selectedRequestId={parsed.success ? parsed.data.requestId : null}
    />
  );
}
