export function buildAuditExportDownloadPath(
  grant: Readonly<{ url: string }>,
  createRequestId: () => string,
): string {
  const downloadUrl = new URL(grant.url, window.location.origin);
  downloadUrl.searchParams.set("requestId", createRequestId());
  return `${downloadUrl.pathname}${downloadUrl.search}`;
}

export function startAuditExportDownload(
  grant: Readonly<{ url: string }>,
  createRequestId: () => string,
  navigation: Pick<Location, "assign"> = window.location,
) {
  navigation.assign(buildAuditExportDownloadPath(grant, createRequestId));
}
