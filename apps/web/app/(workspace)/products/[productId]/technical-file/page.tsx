import { TechnicalFileWorkspace } from "../../technical-file-workspace";

export default async function TechnicalFilePage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <TechnicalFileWorkspace productId={productId} />;
}
