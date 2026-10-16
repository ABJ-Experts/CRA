import { dashboardProductPostureParamsSchema } from "@repo/contracts/dashboard/schemas";
import { notFound } from "next/navigation";
import { DashboardContent } from "../../../../_features/dashboard/dashboard-content";

export default async function ProductPosturePage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const parsed = dashboardProductPostureParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <DashboardContent productId={parsed.data.productId} />;
}
