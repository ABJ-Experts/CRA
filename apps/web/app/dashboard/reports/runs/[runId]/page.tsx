import { ReportRunDetail } from "../../../../_features/reports/report-run-detail";

export default async function ReportRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <ReportRunDetail runId={runId} />;
}
