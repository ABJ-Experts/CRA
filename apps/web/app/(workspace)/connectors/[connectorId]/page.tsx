import { ConnectorDetailContent } from "../connector-detail-content";

export default async function ConnectorDetailPage({
  params,
}: {
  params: Promise<{ connectorId: string }>;
}) {
  const { connectorId } = await params;
  return <ConnectorDetailContent connectorId={connectorId} />;
}
