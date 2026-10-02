import type { Metadata } from "next";

import { TechnicalFileAuditorView } from "../_features/technical-files/technical-file-auditor-view";

export const metadata: Metadata = { title: "Auditor snapshot access | CRA Sentinel", robots: { index: false, follow: false } };

export default async function AuditorPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <TechnicalFileAuditorView token={typeof token === "string" ? token : undefined} />;
}
