import { notFound } from "next/navigation";
import { PageHeading, SectionCard } from "../../../dashboard/_components/dashboard-chrome";
import { apiGet, type PrincipalData, type ProductRow, type ReleaseRow } from "../../_lib/api";
import { ProductDetail } from "./product-detail";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: product, error }, { data: releases }, { data: principal }] = await Promise.all([
    apiGet<ProductRow>(`/products/${id}`),
    apiGet<ReleaseRow[]>(`/releases?productId=${encodeURIComponent(id)}`),
    apiGet<PrincipalData>("/identity/current"),
  ]);
  if (!product && !error) notFound();
  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title={product?.name ?? "Product"}
        subtitle="Manage releases, SBOMs, and lifecycle."
      />
      <SectionCard>
        {error || !product ? (
          <p role="alert" className="text-danger-fg">
            {error ?? "Product not found."}
          </p>
        ) : (
          <ProductDetail
            product={product}
            releases={releases ?? []}
            principal={principal ?? null}
          />
        )}
      </SectionCard>
    </div>
  );
}
