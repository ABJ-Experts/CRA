// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  buildAuditExportDownloadPath,
  startAuditExportDownload,
} from "./audit-download";

describe("audit download", () => {
  it("builds a same-origin download path with a fresh request id", () => {
    const requestId = vi.fn(() => "00000000-0000-4000-8000-000000000101");

    expect(
      buildAuditExportDownloadPath(
        {
          url: "/api/v1/audit/exports/00000000-0000-4000-8000-000000000030/download",
        },
        requestId,
      ),
    ).toBe(
      "/api/v1/audit/exports/00000000-0000-4000-8000-000000000030/download?requestId=00000000-0000-4000-8000-000000000101",
    );
    expect(requestId).toHaveBeenCalledTimes(1);
  });

  it("navigates to the granted same-origin download path", () => {
    const assign = vi.fn();

    startAuditExportDownload(
      {
        url: "/api/v1/audit/exports/00000000-0000-4000-8000-000000000030/download",
      },
      () => "00000000-0000-4000-8000-000000000102",
      { assign },
    );

    expect(assign).toHaveBeenCalledWith(
      "/api/v1/audit/exports/00000000-0000-4000-8000-000000000030/download?requestId=00000000-0000-4000-8000-000000000102",
    );
  });
});
