import { dashboardFindingsDrilldownQuerySchema } from "@repo/contracts/dashboard/schemas";

export function readDashboardTriageLink(
  params: Pick<URLSearchParams, "getAll">,
) {
  const query = Object.fromEntries(
    ["productId", "severity", "openOnly"].flatMap((key) => {
      const values = params.getAll(key);
      return values.length
        ? [[key, values.length === 1 ? values[0] : values]]
        : [];
    }),
  );
  if (Object.keys(query).length === 0) return null;
  const parsed = dashboardFindingsDrilldownQuerySchema.safeParse(query);
  if (!parsed.success) return null;
  return {
    ...(parsed.data.productId ? { productIds: [parsed.data.productId] } : {}),
    ...(parsed.data.severity ? { severities: [parsed.data.severity] } : {}),
    openOnly: parsed.data.openOnly,
  };
}
