import { notFound } from "next/navigation";
import { PageHeading, SectionCard } from "../../../dashboard/_components/dashboard-chrome";
import { apiGet, type FindingRow, type PrincipalData } from "../../_lib/api";
import { FindingDetail } from "./finding-detail";

export const dynamic = "force-dynamic";

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: finding, error }, { data: principal }] = await Promise.all([
    apiGet<FindingRow>(`/findings/${id}`),
    apiGet<PrincipalData>("/identity/current"),
  ]);
  if (!finding && !error) notFound();
  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <PageHeading
        title={finding?.advisoryId ?? "Finding"}
        subtitle="Review match provenance and record a triage decision."
      />
      <SectionCard>
        {error || !finding ? (
          <p role="alert" className="text-danger-fg">
            {error ?? "Finding not found."}
          </p>
        ) : (
          <FindingDetail finding={finding} principal={principal ?? null} />
        )}
      </SectionCard>
    </div>
  );
}
