// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductImportSection } from "./product-import-section";

const IMPORT_ID = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-08-17T10:00:00.000Z";

const mutations = vi.hoisted(() => ({
  upload: { mutateAsync: vi.fn(), isPending: false },
  commit: { mutateAsync: vi.fn(), isPending: false },
  cancel: { mutateAsync: vi.fn(), isPending: false },
  report: { mutateAsync: vi.fn(), isPending: false },
}));

const queryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

const queries = vi.hoisted(() => ({
  template: { refetch: vi.fn(), isFetching: false },
  detail: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null,
  },
  rows: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
}));

vi.mock("../../_features/products/products.queries", () => ({
  useProductImportTemplateQuery: () => queries.template,
  useProductImportsQuery: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
  }),
  useProductImportQuery: () => queries.detail,
  useProductImportRowsQuery: () => queries.rows,
  useUploadProductImportMutation: () => mutations.upload,
  useCommitProductImportMutation: () => mutations.commit,
  useCancelProductImportMutation: () => mutations.cancel,
  useProductImportReportMutation: () => mutations.report,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));

function dryRun() {
  return {
    import: {
      id: IMPORT_ID,
      schemaVersion: "m2-product-release-import-v1",
      status: "dry_run_completed",
      contentHash: "a".repeat(64),
      byteSize: 64,
      rowCount: 2,
      processedRowCount: 2,
      counts: {
        create: 2,
        update: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        warnings: 0,
      },
      errorCode: null,
      expiresAt: "2026-08-18T10:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      committedAt: null,
    },
  };
}

function completedImport() {
  return {
    import: {
      ...dryRun().import,
      status: "completed" as const,
      committedAt: NOW,
    },
  };
}

describe("ProductImportSection", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "88888888-8888-4888-8888-888888888888",
    });
    mutations.upload.mutateAsync.mockResolvedValue(dryRun());
    mutations.commit.mutateAsync.mockResolvedValue(dryRun());
    mutations.cancel.mutateAsync.mockResolvedValue(dryRun());
    queryClient.invalidateQueries.mockClear();
    queries.detail = {
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
    };
    queries.rows = {
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads a selected CSV as a mandatory dry run and shows its safe summary", async () => {
    render(<ProductImportSection canView canCreate canEdit canExport />);
    const file = new File(["record_type\nproduct\n"], "products.csv", {
      type: "text/csv",
    });

    fireEvent.change(screen.getByLabelText("Import CSV file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate CSV" }));

    await waitFor(() =>
      expect(mutations.upload.mutateAsync).toHaveBeenCalledWith({
        fields: { idempotencyKey: "88888888-8888-4888-8888-888888888888" },
        file,
      }),
    );
    expect(await screen.findByText("Dry run completed")).toBeInTheDocument();
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Commit validated import" }),
    ).toBeEnabled();
  });

  it("does not offer import actions to a user without write permission", () => {
    render(
      <ProductImportSection
        canView={false}
        canCreate={false}
        canEdit={false}
        canExport={false}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
    expect(screen.queryByLabelText("Import CSV file")).not.toBeInTheDocument();
  });

  it("allows a viewer to review imports without enabling mutations", () => {
    render(
      <ProductImportSection
        canView
        canCreate={false}
        canEdit={false}
        canExport={false}
      />,
    );

    expect(screen.getByText(/You can review imports/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Import CSV file")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Validate CSV" })).toBeDisabled();
  });

  it("refreshes completed imports and displays committed canonical records", async () => {
    queries.detail = {
      data: completedImport(),
      isPending: false,
      isError: false,
      error: null,
    };
    queries.rows = {
      data: {
        rows: {
          rows: [
            {
              sourceRowNumber: 2,
              rowType: "release",
              proposedAction: "create",
              result: "committed",
              productInternalCode: "E2E-IMPORT-001",
              releaseVersion: "1.0.0",
              issues: [],
            },
          ],
          page: 1,
          pageSize: 25,
          pageCount: 1,
          total: 1,
        },
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };

    render(<ProductImportSection canView canCreate canEdit canExport />);

    expect(
      await screen.findByRole("columnheader", { name: "Record" }),
    ).toBeInTheDocument();
    expect(screen.getByText("E2E-IMPORT-001 · 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("committed")).toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2),
    );
  });
});
