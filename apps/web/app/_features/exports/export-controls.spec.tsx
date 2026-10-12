// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportControls } from "./export-controls";

const id = "00000000-0000-4000-8000-000000000001";
const job = {
  id,
  source: "products.registry",
  kind: "list",
  format: "csv",
  state: "queued",
  version: 1,
  requestedAt: "2026-10-09T12:00:00.000Z",
  snapshotAsOf: null,
  rowCount: null,
  progress: { processedRows: 0, totalRows: null },
  artifacts: [],
  expiresAt: null,
  failure: null,
};
afterEach(cleanup);
function gateway() {
  return {
    create: vi.fn().mockResolvedValue({ data: job }),
    get: vi.fn().mockResolvedValue({ data: job }),
    cancel: vi.fn(),
    retry: vi.fn(),
    grant: vi.fn(),
    manifest: vi.fn(),
    createReadiness: vi.fn(),
  };
}
const props = {
  source: "products.registry" as const,
  context: {},
  filters: { page: 1, pageSize: 25, q: "café", archived: false },
  enabled: true,
};
describe("ExportControls", () => {
  it("sends the actual filters and defaults to all filtered, independently of displayed page size", async () => {
    const client = gateway();
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await waitFor(() => expect(client.create).toHaveBeenCalled());
    expect(client.create.mock.calls[0]?.[0]).toMatchObject({
      source: "products.registry",
      filters: props.filters,
      scope: "all_filtered",
      format: "csv",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Queued");
  });
  it("does not show or request export without permission", () => {
    const client = gateway();
    render(<ExportControls {...props} enabled={false} gateway={client} />);
    expect(
      screen.queryByRole("button", { name: "Export list" }),
    ).not.toBeInTheDocument();
    expect(client.create).not.toHaveBeenCalled();
  });
  it("keeps request choices and displays permission revocation without metadata", async () => {
    const client = gateway();
    const { ApiClientError } = await import("../../_lib/http/api-client");
    client.create.mockRejectedValue(
      new ApiClientError("api", "forbidden", 403),
    );
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.change(screen.getByLabelText("Export format"), {
      target: { value: "xlsx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
    expect(screen.getByLabelText("Export format")).toHaveValue("xlsx");
  });
});

describe("Export job lifecycle", () => {
  async function start(client: ReturnType<typeof gateway>, extra = {}) {
    render(<ExportControls {...props} {...extra} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("status");
  }
  it("supports current page only when the source has pagination", async () => {
    const client = gateway();
    await start(client);
    fireEvent.change(screen.getByLabelText("Export scope"), {
      target: { value: "current_page" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(2));
    expect(client.create.mock.calls[1]?.[0].scope).toBe("current_page");
    expect(
      screen.queryByRole("option", { name: "Selected rows" }),
    ).not.toBeInTheDocument();
  });
  it("refreshes and cancels with optimistic job version", async () => {
    const client = gateway();
    client.cancel.mockResolvedValue({
      data: { ...job, state: "cancelled", version: 2 },
    });
    await start(client);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(client.get).toHaveBeenCalledWith(id));
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith(id, 1));
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled");
  });
  it("shows empty ready captures and obtains fresh one-use delivery grants", async () => {
    const client = gateway();
    client.create.mockResolvedValue({
      data: {
        ...job,
        state: "ready",
        rowCount: 0,
        snapshotAsOf: job.requestedAt,
        artifacts: [{ id, name: "products.csv" }],
      },
    });
    client.grant.mockResolvedValue({
      data: {
        grantId: id,
        downloadPath: `/api/v1/exports/${id}/download/${id}`,
        expiresAt: job.requestedAt,
      },
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await start(client);
    expect(screen.getByText(/No rows matched/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Download products.csv" }),
    );
    await waitFor(() => expect(client.grant).toHaveBeenCalledWith(id, id));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
  it("keeps a creation idempotency key after a network failure", async () => {
    const client = gateway();
    client.create.mockRejectedValueOnce(new Error("offline"));
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("status");
    expect(client.create.mock.calls[0]?.[0].idempotencyKey).toBe(
      client.create.mock.calls[1]?.[0].idempotencyKey,
    );
  });
  it("removes cached counts/artifact metadata when download permission is revoked", async () => {
    const client = gateway();
    const { ApiClientError } = await import("../../_lib/http/api-client");
    client.create.mockResolvedValue({
      data: {
        ...job,
        state: "ready",
        rowCount: 23,
        artifacts: [{ id, name: "products.csv" }],
      },
    });
    client.grant.mockRejectedValue(new ApiClientError("api", "forbidden", 403));
    await start(client);
    fireEvent.click(
      screen.getByRole("button", { name: "Download products.csv" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Export status")).not.toBeInTheDocument();
  });
  it("requests readiness PDF+JSON without altering the current technical file", async () => {
    const client = gateway();
    client.createReadiness.mockResolvedValue({
      data: { ...job, kind: "readiness", format: "report" },
    });
    render(
      <ExportControls {...props} readinessProductId={id} gateway={client} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Export readiness report" }),
    );
    expect(screen.getByText(/does not certify conformity/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Export format")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await waitFor(() => expect(client.createReadiness).toHaveBeenCalled());
    expect(client.create).not.toHaveBeenCalled();
  });
});
describe("Export recovery and bounded scopes", () => {
  it("retries retryable failed jobs and shows conflict recovery", async () => {
    const client = gateway();
    client.create.mockResolvedValue({
      data: {
        ...job,
        state: "failed",
        failure: { code: "offline", message: "retry", retryable: true },
      },
    });
    const { ApiClientError } = await import("../../_lib/http/api-client");
    client.retry.mockRejectedValue(new ApiClientError("api", "conflict", 409));
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Retry export" }));
    await waitFor(() => expect(client.retry).toHaveBeenCalledWith(id, 1));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "another session",
    );
  });
  it("includes selected IDs only in supported selected scope", async () => {
    const client = gateway();
    render(
      <ExportControls
        {...props}
        source="findings.triage_queue"
        filters={{ limit: 50 }}
        selectedIds={[id]}
        gateway={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.change(screen.getByLabelText("Export scope"), {
      target: { value: "selected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("status");
    expect(client.create.mock.calls[0]?.[0].selectedIds).toEqual([id]);
  });
  it("explains unsupported size and expired artifact states", async () => {
    const client = gateway();
    const { ApiClientError } = await import("../../_lib/http/api-client");
    client.create.mockRejectedValueOnce(
      new ApiClientError("api", "limit", 422),
    );
    client.create.mockResolvedValue({ data: { ...job, state: "expired" } });
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("choose CSV");
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByText(/download window expired/);
  });
});
it("polls bounded jobs and hides metadata after session revocation", async () => {
  vi.useFakeTimers();
  try {
    const client = gateway();
    const { ApiClientError } = await import("../../_lib/http/api-client");
    client.get.mockRejectedValue(new ApiClientError("api", "revoked", 403));
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Queued");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(client.get).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Export status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
  } finally {
    vi.useRealTimers();
  }
});
it("rejects substituted artifact URLs and never navigates to another resource", async () => {
  const client = gateway();
  client.create.mockResolvedValue({
    data: { ...job, state: "ready", artifacts: [{ id, name: "products.csv" }] },
  });
  client.grant.mockResolvedValue({
    data: {
      grantId: id,
      downloadPath: "https://example.invalid/private-file",
      expiresAt: job.requestedAt,
    },
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  render(<ExportControls {...props} gateway={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Export list" }));
  fireEvent.click(screen.getByRole("button", { name: "Create export" }));
  await screen.findByRole("status");
  fireEvent.click(
    screen.getByRole("button", { name: "Download products.csv" }),
  );
  await screen.findByRole("alert");
  expect(click).not.toHaveBeenCalled();
  click.mockRestore();
});

describe("Manifest delivery", () => {
  const artifact = {
    id,
    name: "products.csv",
    mediaType: "text/csv",
    byteLength: 10,
    rowCount: 1,
    sha256: "a".repeat(64),
  };
  const manifest = {
    version: "m14_03_v1",
    jobId: id,
    source: "products.registry",
    requestedAt: job.requestedAt,
    snapshotAsOf: job.requestedAt,
    scope: "all_filtered",
    requestDigest: "a".repeat(64),
    rowCount: 1,
    columns: [{ key: "id", label: "ID", type: "text" }],
    artifacts: [artifact],
    sourceVersionsDigest: "b".repeat(64),
    documentationReadinessOnly: false,
  };
  const ready = {
    ...job,
    state: "ready",
    rowCount: 1,
    snapshotAsOf: job.requestedAt,
    artifacts: [artifact],
    manifest,
  };
  async function startManifest(client: ReturnType<typeof gateway>) {
    client.create.mockResolvedValue({ data: ready });
    render(<ExportControls {...props} gateway={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Export list" }));
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    await screen.findByRole("button", { name: "Download manifest JSON" });
  }
  it("rechecks access and downloads fresh parsed hashes without storage URLs", async () => {
    const client = gateway();
    const fresh = { ...manifest, requestDigest: "c".repeat(64) };
    client.manifest.mockResolvedValue({ data: fresh });
    const createObjectURL = vi.fn().mockReturnValue("blob:manifest");
    const revokeObjectURL = vi.fn();
    const originalURL = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends originalURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      await startManifest(client);
      fireEvent.click(
        screen.getByRole("button", { name: "Download manifest JSON" }),
      );
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
      expect(client.manifest).toHaveBeenCalledWith(id);
      const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
      expect(blob.type).toBe("application/json;charset=utf-8");
      expect(blob.size).toBeGreaterThan(0);
      const reader = new FileReader();
      const contents = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsText(blob);
      });
      expect(JSON.parse(contents)).toEqual(fresh);
      expect(click).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:manifest"),
      );
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("cannot download a cached manifest after revocation", async () => {
    const client = gateway();
    const { ApiClientError } = await import("../../_lib/http/api-client");
    client.manifest.mockRejectedValue(
      new ApiClientError("api", "not found", 404),
    );
    const createObjectURL = vi.fn();
    const originalURL = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends originalURL {
        static createObjectURL = createObjectURL;
      },
    );
    try {
      await startManifest(client);
      fireEvent.click(
        screen.getByRole("button", { name: "Download manifest JSON" }),
      );
      await screen.findByRole("alert");
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Export status")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Download manifest JSON" }),
      ).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects a manifest for another job before creating a file", async () => {
    const client = gateway();
    client.manifest.mockResolvedValue({
      data: { ...manifest, jobId: "00000000-0000-4000-8000-000000000002" },
    });
    const createObjectURL = vi.fn();
    const originalURL = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends originalURL {
        static createObjectURL = createObjectURL;
      },
    );
    try {
      await startManifest(client);
      fireEvent.click(
        screen.getByRole("button", { name: "Download manifest JSON" }),
      );
      await screen.findByRole("alert");
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not finish delivery after the view loses permission", async () => {
    const client = gateway();
    client.create.mockResolvedValue({ data: ready });
    let finish!: (value: { data: typeof manifest }) => void;
    client.manifest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const createObjectURL = vi.fn();
    const originalURL = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends originalURL {
        static createObjectURL = createObjectURL;
      },
    );
    try {
      const view = render(<ExportControls {...props} gateway={client} />);
      fireEvent.click(screen.getByRole("button", { name: "Export list" }));
      fireEvent.click(screen.getByRole("button", { name: "Create export" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Download manifest JSON" }),
      );
      view.rerender(
        <ExportControls {...props} enabled={false} gateway={client} />,
      );
      await act(async () => finish({ data: manifest }));
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it("preserves an active job during source refresh while disabling new creation", async () => {
  const client = gateway();
  const view = render(<ExportControls {...props} gateway={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Export list" }));
  fireEvent.click(screen.getByRole("button", { name: "Create export" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Queued"),
  );
  view.rerender(
    <ExportControls {...props} creationEnabled={false} gateway={client} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Queued");
  expect(screen.getByRole("button", { name: "Create export" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Create export" }));
  expect(client.create).toHaveBeenCalledTimes(1);
  view.rerender(<ExportControls {...props} gateway={client} />);
  expect(screen.getByRole("button", { name: "Create export" })).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent("Queued");
});
