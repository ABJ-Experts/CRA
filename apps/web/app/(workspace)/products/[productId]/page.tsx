import { ProductDetailContent } from "../product-detail-content";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ProductDetailContent productId={productId} />;
}
