import { SupplierDetailContent } from "../../../_features/suppliers/supplier-detail-content";

export default async function SupplierDetailPage({
  params,
}: Readonly<{ params: Promise<{ supplierId: string }> }>) {
  const { supplierId } = await params;
  return <SupplierDetailContent supplierId={supplierId} />;
}
