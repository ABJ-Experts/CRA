import {
  PageHeading,
  SectionCard,
  Stagger,
  StaggerItem,
} from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type PrincipalData, type ProductRow } from "../_lib/api";
import { ProductsWorkspace } from "./products-workspace";

/**
 * Products list. Real rows from Postgres, RLS-scoped to the active organisation.
 *
 * Read-only for now: creating a product needs the `product:create` permission,
 * which a Security Engineer does not hold, so an always-visible "Add product"
 * button would violate FR-FE-001 (hide what the caller cannot do). Wiring the
 * form means reading the principal's permissions here first.
 */

export const dynamic = "force-dynamic";

export default async function AppProductsPage() {
  const [{ data, error }, { data: principal }] = await Promise.all([
    apiGet<ProductRow[]>("/products"),
    apiGet<PrincipalData>("/identity/current"),
  ]);
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
            ) : (
              <ProductsWorkspace products={rows} principal={principal ?? null} />
            )}
          </SectionCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
