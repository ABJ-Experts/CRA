import { EvidenceLibrary } from "../../../../_features/evidence/evidence-library";

export default async function EvidenceLibraryPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return <EvidenceLibrary productId={productId} />;
}
