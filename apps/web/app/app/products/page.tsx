import { Tag } from "@repo/ui/tag";
import {
  PageHeading,
  SectionCard,
  Stagger,
  StaggerItem,
} from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type ProductRow } from "../_lib/api";

/**
 * Products list. Real rows from Postgres, RLS-scoped to the active organisation.
 *
 * Read-only for now: creating a product needs the `product:create` permission,
 * which a Security Engineer does not hold, so an always-visible "Add product"
 * button would violate FR-FE-001 (hide what the caller cannot do). Wiring the
 * form means reading the principal's permissions here first.
 */

export const dynamic = "force-dynamic";

const LIFECYCLE_TONE: Record<string, "green" | "orange" | "blue" | "purple"> = {
  on_market: "green",
  development: "blue",
  end_of_support: "orange",
};

export default async function AppProductsPage() {
  const { data, error } = await apiGet<ProductRow[]>("/products");
  const rows = data ?? [];

  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title="Products"
        subtitle="The products you ship. Upload an SBOM per release to begin monitoring."
      />

      <Stagger>
        <StaggerItem>
          <SectionCard>
            {error ? (
              <p className="text-caption-1-regular text-danger-fg" role="alert">
                {error}
              </p>
            ) : rows.length === 0 ? (
              <p className="text-caption-1-regular text-fg-muted">
                No products yet. Register the products you ship, then upload an
                SBOM for each release.
              </p>
            ) : (
              <div className="-mx-6 overflow-x-auto px-6">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-3 pr-4 text-caption-2-semibold uppercase tracking-wide text-fg-muted">
                        Name
                      </th>
                      <th className="py-3 pr-4 text-caption-2-semibold uppercase tracking-wide text-fg-muted">
                        Internal code
                      </th>
                      <th className="py-3 pr-4 text-caption-2-semibold uppercase tracking-wide text-fg-muted">
                        Type
                      </th>
                      <th className="py-3 text-caption-2-semibold uppercase tracking-wide text-fg-muted">
                        Lifecycle
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-b-0">
                        <td className="py-3 pr-4 text-caption-1-semibold text-fg">{p.name}</td>
                        <td className="py-3 pr-4 font-mono text-caption-1-regular text-fg-muted">
                          {p.internalCode}
                        </td>
                        <td className="py-3 pr-4 text-caption-1-regular text-fg-muted">
                          {p.productType.replace(/_/g, " ")}
                        </td>
                        <td className="py-3">
                          <Tag variant="fill" tone={LIFECYCLE_TONE[p.lifecycleState] ?? "purple"}>
                            {p.lifecycleState.replace(/_/g, " ")}
                          </Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
