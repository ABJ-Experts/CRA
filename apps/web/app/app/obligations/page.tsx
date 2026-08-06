import { PageHeading, SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { apiGet, type ObligationRow } from "../_lib/api";
import { ObligationsList } from "./obligations-list";

export const dynamic = "force-dynamic";

export default async function ObligationsPage() {
  const { data, error } = await apiGet<ObligationRow[]>("/obligations");
  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title="Reporting obligations"
        subtitle="Track CRA notification deadlines and regulatory reporting stages."
      />
      <SectionCard>
        {error ? (
          <p role="alert" className="text-danger-fg">
            {error}
          </p>
        ) : (
          <ObligationsList obligations={data ?? []} />
        )}
      </SectionCard>
    </div>
  );
}
