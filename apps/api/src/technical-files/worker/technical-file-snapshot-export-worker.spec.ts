import {
  shouldRemoveUploadedArtifacts,
  snapshotExportFailureCode,
} from "./technical-file-snapshot-export-worker";
import { TechnicalFileSnapshotRenderError } from "./technical-file-snapshot-export-renderer";
import { z } from "zod";

describe("TechnicalFileSnapshotExportWorker failure policy", () => {
  it("only permits cleanup after a durable failed, released lease", () => {
    expect(
      shouldRemoveUploadedArtifacts({ status: "failed", lease_owner: null }),
    ).toBe(true);
    expect(
      shouldRemoveUploadedArtifacts({
        status: "ready",
        lease_owner: null,
      }),
    ).toBe(false);
    expect(
      shouldRemoveUploadedArtifacts({
        status: "generating",
        lease_owner: "00000000-0000-4000-8000-000000000001",
      }),
    ).toBe(false);
    expect(shouldRemoveUploadedArtifacts(null)).toBe(false);
  });

  it("maps only known render and invalid immutable-payload errors to durable codes", () => {
    expect(
      snapshotExportFailureCode(
        new TechnicalFileSnapshotRenderError("artifact_too_large"),
      ),
    ).toBe("artifact_too_large");
    expect(snapshotExportFailureCode(new z.ZodError([]))).toBe(
      "snapshot_unavailable",
    );
    expect(snapshotExportFailureCode(new Error("RPC response lost"))).toBe(
      "unknown",
    );
  });
});
