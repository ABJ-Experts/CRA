/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { customFrameworksApi } from "./custom-frameworks.api";

const state = vi.hoisted(() => ({
  listLoading: false,
  listError: false,
  nextOffset: null as number | null,
  listOffset: vi.fn(),
  selectedDetail: null as null | {
    draftId: string;
    packKey: string;
    title: string;
    status: "draft" | "published" | "update_available" | "archived";
    revision: number;
    latestVersionKey: string | null;
    selectedVersionKey: string | null;
    contentHash: string | null;
    archivedAt: string | null;
    updatedAt: string;
    content: typeof content;
  },
  command: vi.fn(),
}));

const content = {
  title: "Internal controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Internal policy",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Design review",
      text: "Document design control decisions.",
      sourceReference: "Policy 1",
    },
  ],
};

const draftId = "11111111-1111-4111-8111-111111111111";

const item = {
  draftId,
  packKey: "custom.11111111-1111-4111-8111-111111111111",
  title: content.title,
  status: "draft" as const,
  revision: 1,
  latestVersionKey: "v1",
  selectedVersionKey: null,
  contentHash: null,
  archivedAt: null,
  updatedAt: "2026-09-25T00:00:00Z",
};

vi.mock("./custom-frameworks.queries", () => ({
  useCustomFrameworks: (_orgId: string, _enabled: boolean, offset: number) => {
    state.listOffset(offset);
    return {
      data: { items: [item], nextOffset: state.nextOffset },
      isLoading: state.listLoading,
      isError: state.listError,
    };
  },
  useCustomFrameworkDetail: () => ({ data: state.selectedDetail }),
  useCustomFrameworkCommand: () => ({
    mutateAsync: state.command,
    isPending: false,
  }),
}));

import { CustomFrameworksPanel } from "./custom-frameworks-panel";

function renderPanel(canManage = true) {
  return render(
    <CustomFrameworksPanel
      organizationId="11111111-1111-4111-8111-111111111111"
      canManage={canManage}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.listLoading = false;
  state.listError = false;
  state.nextOffset = null;
  state.listOffset.mockReset();
  state.selectedDetail = null;
  state.command.mockReset().mockResolvedValue({
    ...item,
    revision: 2,
    contentHash: "a".repeat(64),
  });
});

describe("CustomFrameworksPanel", () => {
  it("opens later draft pages and returns to the first page", () => {
    state.nextOffset = 20;
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Next custom frameworks" }),
    );
    expect(state.listOffset).toHaveBeenLastCalledWith(20);
    fireEvent.click(
      screen.getByRole("button", { name: "Previous custom frameworks" }),
    );
    expect(state.listOffset).toHaveBeenLastCalledWith(0);
  });
  it("edits metadata and requirements through labeled form fields before creating a draft", async () => {
    state.command.mockResolvedValueOnce({
      ...item,
      revision: 1,
      contentHash: "a".repeat(64),
    });
    renderPanel();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Operational controls" },
    });
    fireEvent.change(screen.getByLabelText("Requirement 1 text"), {
      target: { value: "Maintain an operational detail record." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add requirement" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Save imported draft" }),
    );
    await waitFor(() =>
      expect(state.command).toHaveBeenCalledWith({
        draftId: null,
        input: expect.objectContaining({
          action: "create_draft",
          content: expect.objectContaining({
            title: "Operational controls",
            requirements: expect.arrayContaining([
              expect.objectContaining({
                text: "Maintain an operational detail record.",
              }),
              expect.objectContaining({ requirementKey: "control-2" }),
            ]),
          }),
        }),
      }),
    );
  });

  it("preserves edited content when a save conflicts", async () => {
    state.selectedDetail = { ...item, content };
    state.command.mockRejectedValueOnce(
      new ApiClientError("api", "Conflict", 409, "custom_framework_conflict"),
    );
    renderPanel();

    const editor = screen.getByLabelText("JSON import");
    fireEvent.change(editor, {
      target: {
        value: JSON.stringify(
          {
            schemaVersion: 1,
            kind: "customer_defined",
            content: { ...content, title: "Changed draft" },
          },
          null,
          2,
        ),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/preserved/i);
    expect((editor as HTMLTextAreaElement).value).toContain("Changed draft");
    expect(state.command).toHaveBeenCalledWith({
      draftId: item.draftId,
      input: expect.objectContaining({
        action: "save_draft",
        expectedRevision: 1,
      }),
    });
  });

  it("preserves dirty editor text when a detail refetch arrives until explicit reload", async () => {
    state.selectedDetail = { ...item, content };
    const view = renderPanel();

    const requirement = screen.getByLabelText("Requirement 1 text");
    fireEvent.change(requirement, {
      target: { value: "Unsaved local requirement text." },
    });

    state.selectedDetail = {
      ...item,
      revision: 2,
      content: {
        ...content,
        title: "Server draft",
        requirements: [
          {
            ...content.requirements[0]!,
            text: "Server-side requirement text.",
          },
        ],
      },
    };
    view.rerender(
      <CustomFrameworksPanel
        organizationId="11111111-1111-4111-8111-111111111111"
        canManage
      />,
    );

    await screen.findByText(/unsaved edits are preserved/i);
    expect((requirement as HTMLTextAreaElement).value).toBe(
      "Unsaved local requirement text.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reload server draft" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Title")).toHaveValue("Server draft"),
    );
    expect(screen.getByLabelText("Requirement 1 text")).toHaveValue(
      "Server-side requirement text.",
    );
  });

  it("keeps publish and archive disabled for read-only users", () => {
    state.selectedDetail = { ...item, content };
    renderPanel(false);

    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Publish version" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Archive draft" }),
    ).toBeDisabled();
    expect(screen.getByText(/cannot save drafts/i)).toBeInTheDocument();
  });

  it("blocks publishing unsaved edits until the draft is saved", async () => {
    state.selectedDetail = { ...item, content };
    state.command.mockResolvedValueOnce({
      ...item,
      status: "update_available",
      revision: 2,
      contentHash: "b".repeat(64),
    });
    renderPanel();

    expect(
      screen.getByRole("button", { name: "Publish version" }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Requirement 1 text"), {
      target: { value: "Keep a saved operational record before publishing." },
    });

    expect(
      screen.getByRole("button", { name: "Publish version" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/save the draft before publishing this edited content/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(state.command).toHaveBeenCalledWith({
        draftId: item.draftId,
        input: expect.objectContaining({
          action: "save_draft",
          content: expect.objectContaining({
            requirements: [
              expect.objectContaining({
                text: "Keep a saved operational record before publishing.",
              }),
            ],
          }),
        }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Publish version" }),
      ).toBeEnabled(),
    );
  });

  it("shows exact import validation errors and blocks invalid draft export", async () => {
    state.selectedDetail = { ...item, content };
    const validateSpy = vi
      .spyOn(customFrameworksApi, "validate")
      .mockResolvedValueOnce({
        valid: false,
        errors: [
          {
            path: "content.requirements.0.text",
            message: "Requirement text is required",
          },
        ],
      });
    renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: "Validate JSON import" }),
    );

    expect(
      await screen.findByText(/content\.requirements\.0\.text/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Requirement text is required/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("JSON import"), {
      target: { value: "{bad json" },
    });

    expect(
      screen.getByRole("button", { name: "Prepare export" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        /fix json import errors before preparing a draft export/i,
      ),
    ).toBeInTheDocument();
    validateSpy.mockRestore();
  });

  it("selects existing drafts, edits optional metadata fields, and can start over with the sample", async () => {
    state.selectedDetail = { ...item, content };
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Internal controls/i }));
    fireEvent.change(screen.getByLabelText("Edition date"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "de" },
    });
    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "https://example.test/framework" },
    });
    fireEvent.change(screen.getByLabelText("Attribution"), {
      target: { value: "Updated attribution" },
    });
    fireEvent.change(screen.getByLabelText("Requirement 1 key"), {
      target: { value: "control-renamed" },
    });
    fireEvent.change(screen.getByLabelText("Requirement 1 identifier"), {
      target: { value: "INT-RENAMED" },
    });
    fireEvent.change(screen.getByLabelText("Requirement 1 heading"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Requirement 1 source reference"), {
      target: { value: "Updated source" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(state.command).toHaveBeenCalledWith({
        draftId: item.draftId,
        input: expect.objectContaining({
          action: "save_draft",
          content: expect.objectContaining({
            editionDate: "2026-10-01",
            language: "de",
            sourceUrl: "https://example.test/framework",
            attribution: "Updated attribution",
            requirements: [
              expect.objectContaining({
                requirementKey: "control-renamed",
                identifier: "INT-RENAMED",
                heading: null,
                sourceReference: "Updated source",
              }),
            ],
          }),
        }),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Start new custom framework" }),
    );
  });

  it("resets a new unsaved import back to the sample", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Temporary draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start new custom framework" }),
    );
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Internal product controls",
    );

    fireEvent.change(screen.getByLabelText("JSON import"), {
      target: { value: "{bad json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load sample" }));
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Internal product controls",
    );
  });

  it("publishes, archives, and restores revisioned drafts", async () => {
    state.selectedDetail = { ...item, content };
    state.command
      .mockResolvedValueOnce({
        ...item,
        status: "published",
        revision: 2,
        latestVersionKey: "v2",
        contentHash: "c".repeat(64),
      })
      .mockResolvedValueOnce({
        ...item,
        status: "archived",
        revision: 3,
        latestVersionKey: "v2",
        contentHash: "c".repeat(64),
      })
      .mockResolvedValueOnce({
        ...item,
        status: "draft",
        revision: 4,
        latestVersionKey: "v2",
        contentHash: "c".repeat(64),
      });
    const view = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Publish version" }));
    await waitFor(() =>
      expect(state.command).toHaveBeenLastCalledWith({
        draftId: item.draftId,
        input: expect.objectContaining({
          action: "publish_version",
          expectedRevision: 1,
        }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Version published/i,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive draft" }));
    await waitFor(() =>
      expect(state.command).toHaveBeenLastCalledWith({
        draftId: item.draftId,
        input: expect.objectContaining({
          action: "archive_draft",
          expectedRevision: 2,
        }),
      }),
    );

    state.selectedDetail = {
      ...item,
      status: "archived",
      revision: 3,
      content,
    };
    view.rerender(
      <CustomFrameworksPanel
        organizationId="11111111-1111-4111-8111-111111111111"
        canManage
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));
    await waitFor(() =>
      expect(state.command).toHaveBeenLastCalledWith({
        draftId: item.draftId,
        input: expect.objectContaining({
          action: "restore_draft",
          expectedRevision: 3,
        }),
      }),
    );
  });

  it("surfaces syntax, schema, network, and published export errors without losing edits", async () => {
    state.selectedDetail = { ...item, content };
    renderPanel();

    fireEvent.change(screen.getByLabelText("JSON import"), {
      target: { value: "{bad json" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Validate JSON import" }),
    );
    expect(await screen.findByText("JSON")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load sample" }));
    state.command.mockRejectedValueOnce(
      new ApiClientError("network", "Offline", 0, "network_error"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByText(/server is unreachable/i)).toBeInTheDocument(),
    );

    const exportSpy = vi
      .spyOn(customFrameworksApi, "export")
      .mockRejectedValueOnce(
        new ApiClientError("network", "Offline", 0, "network_error"),
      );
    fireEvent.click(screen.getByRole("button", { name: "Load sample" }));
    fireEvent.click(
      screen.getByRole("radio", { name: /Published version v1/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare export" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /server is unreachable|offline/i,
    );
    exportSpy.mockRestore();
  });

  it("loads an exact published version export when selected", async () => {
    state.selectedDetail = { ...item, content };
    const createUrl = vi.fn().mockReturnValue("blob:published-export");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createUrl,
      revokeObjectURL: revokeUrl,
    });
    const exportSpy = vi
      .spyOn(customFrameworksApi, "export")
      .mockResolvedValueOnce({
        schemaVersion: 1,
        kind: "customer_defined",
        content: { ...content, title: "Published export" },
      });
    renderPanel();

    fireEvent.click(
      screen.getByRole("radio", { name: /Published version v1/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare export" }));

    await waitFor(() =>
      expect(exportSpy).toHaveBeenCalledWith(item.draftId, "v1"),
    );
    expect(
      (screen.getByLabelText("Export JSON") as HTMLTextAreaElement).value,
    ).toContain("Published export");
    const download = screen.getByRole("link", { name: "Download JSON" });
    expect(download).toHaveAttribute("href", "blob:published-export");
    expect(download).toHaveAttribute("download", "published-export-v1.json");
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
    exportSpy.mockRestore();
  });
});
