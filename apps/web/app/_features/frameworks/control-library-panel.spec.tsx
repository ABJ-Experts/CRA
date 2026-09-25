/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";

const state = vi.hoisted(() => ({
  list: { controls: [], nextCursor: null } as {
    controls: Array<Record<string, unknown>>;
    nextCursor: string | null;
  },
  detail: null as Record<string, unknown> | null,
  coverage: null as Record<string, unknown> | null,
  coverageError: false,
  products: [] as Array<{ id: string; name: string }>,
  evidenceDocuments: [] as Array<Record<string, unknown>>,
  evidenceVersions: [] as Array<Record<string, unknown>>,
  requirements: [] as Array<Record<string, unknown>>,
  owners: [] as Array<{ id: string; displayName: string }>,
  create: vi.fn(),
  listError: false,
  update: vi.fn(),
  archive: vi.fn(),
  linkEvidence: vi.fn(),
  endEvidenceLink: vi.fn(),
  addMapping: vi.fn(),
  updateMapping: vi.fn(),
  endMapping: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("./controls.api", () => ({
  controlsApi: {
    list: vi.fn(async () => {
      if (state.listError) throw new ApiClientError("network", "Offline");
      return state.list;
    }),
    get: vi.fn(async () => state.detail),
    create: state.create,
    update: state.update,
    archive: state.archive,
    linkEvidence: state.linkEvidence,
    endEvidenceLink: state.endEvidenceLink,
    addMapping: state.addMapping,
    updateMapping: state.updateMapping,
    endMapping: state.endMapping,
    coverage: vi.fn(
      async (_packKey: string, _versionKey: string, productId: string) => {
        if (state.coverageError) throw new ApiClientError("network", "Offline");
        return (
          state.coverage ?? {
            packKey: "cra-annex-i",
            versionKey: "oj-2024-11-20",
            productId,
            calculation: {
              status: "current",
              calculatedAt: "2026-09-24T10:00:00Z",
            },
            summary: {
              totalRequirements: 0,
              applicableRequirements: 0,
              excludedRequirements: 0,
              evidenceBackedRequirements: 0,
              gapRequirements: 0,
            },
            requirements: [],
            nextCursor: null,
          }
        );
      },
    ),
    ownerCandidates: vi.fn(async () => ({
      owners: state.owners,
      nextCursor: null,
    })),
  },
}));
vi.mock("../products/products.api", () => ({
  productsApi: {
    list: vi.fn(async () => ({
      products: {
        rows: state.products,
        total: state.products.length,
        page: 1,
        pageSize: 100,
        pageCount: 1,
      },
    })),
  },
}));
vi.mock("../evidence/evidence.api", () => ({
  evidenceApi: {
    list: vi.fn(async () => ({
      items: state.evidenceDocuments,
      nextCursor: null,
    })),
    versions: vi.fn(async () => ({ versions: state.evidenceVersions })),
  },
}));
vi.mock("./frameworks.api", () => ({
  frameworksApi: {
    tree: vi.fn(async () => ({
      requirements: state.requirements,
      nextCursor: null,
    })),
  },
}));

import { ControlLibraryPanel } from "./control-library-panel";

const organizationId = "11111111-1111-4111-8111-111111111111";
const controlId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const evidenceDocumentId = "44444444-4444-4444-8444-444444444444";
const historicalVersionId = "55555555-5555-4555-8555-555555555555";

function detailFixture(
  status: "not_started" | "in_progress" | "implemented" = "not_started",
) {
  return {
    id: controlId,
    title: "Secure updates",
    description: "Review update design.",
    ownerUserId: organizationId,
    ownerActive: true,
    status,
    revision: 3,
    archivedAt: null,
    createdAt: "2026-09-24T00:00:00Z",
    updatedAt: "2026-09-24T00:00:00Z",
    evidenceLinks: [],
    evidenceRestricted: false,
    mappings: [],
  };
}

function mount(
  overrides: Partial<React.ComponentProps<typeof ControlLibraryPanel>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ControlLibraryPanel
        organizationId={organizationId}
        actorUserId={organizationId}
        canManage
        canViewProducts
        canViewEvidence
        activePackKey="cra-annex-i"
        activeVersionKey="oj-2024-11-20"
        initialControlId={null}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.list = { controls: [], nextCursor: null };
  state.detail = null;
  state.coverage = null;
  state.coverageError = false;
  state.products = [];
  state.evidenceDocuments = [];
  state.evidenceVersions = [];
  state.requirements = [];
  state.owners = [];
  state.create.mockReset();
  state.listError = false;
  state.update.mockReset();
  state.archive.mockReset();
  state.linkEvidence.mockReset();
  state.endEvidenceLink.mockReset();
  state.addMapping.mockReset();
  state.updateMapping.mockReset();
  state.endMapping.mockReset();
  state.refetch.mockReset();
});

describe("ControlLibraryPanel", () => {
  it("shows a useful empty state and preserves draft input after an offline create", async () => {
    state.create.mockRejectedValueOnce(
      new ApiClientError("network", "Offline"),
    );
    mount();
    expect(await screen.findByText(/No controls yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create control" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Control title" }), {
      target: { value: "Review secure updates" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Review every update flow." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save control" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /unreachable|offline/i,
    );
    expect(screen.getByRole("textbox", { name: "Control title" })).toHaveValue(
      "Review secure updates",
    );
  });

  it("separates implementation, evidence, and product mapping without rendering markup", async () => {
    state.list = {
      controls: [
        {
          id: controlId,
          title: "Secure updates",
          description: "Update controls",
          ownerUserId: organizationId,
          ownerActive: false,
          status: "implemented",
          revision: 3,
          archivedAt: null,
          createdAt: "2026-09-24T00:00:00Z",
          updatedAt: "2026-09-24T00:00:00Z",
        },
      ],
      nextCursor: null,
    };
    state.detail = {
      ...state.list.controls[0],
      evidenceLinks: [
        {
          id: organizationId,
          evidenceVersionId: organizationId,
          productId: organizationId,
          evidenceTitle: "Test evidence",
          evidenceVersionNumber: 2,
          availability: "expired",
          sourceControlRevision: 2,
          endedAt: null,
          createdAt: "2026-09-24T00:00:00Z",
        },
      ],
      mappings: [
        {
          id: organizationId,
          packKey: "cra-annex-i",
          versionKey: "oj-2024-11-20",
          requirementKey: "part-i-1",
          identifier: "Annex I, Part I, 1",
          heading: null,
          requirementText: "<script>alert(1)</script> legal requirement",
          rationale: "Applies to the selected product.",
          productIds: [organizationId],
          productsRestricted: false,
          sourceControlRevision: 2,
          endedAt: null,
          createdAt: "2026-09-24T00:00:00Z",
        },
      ],
      evidenceRestricted: false,
    };
    mount({ initialControlId: controlId });
    expect(await screen.findByText("Secure updates")).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/Owner needs reassignment/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Evidence: Expired/i)).toBeInTheDocument();
    expect(
      screen.getByText("<script>alert(1)</script> legal requirement"),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByText(/compliant/i)).not.toBeInTheDocument();
  });

  it("keeps writes unavailable for a reader", async () => {
    mount({ canManage: false });
    expect(await screen.findByText(/No controls yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create control" }),
    ).not.toBeInTheDocument();
  });

  it("requires a reason for a backward status edit and preserves a conflicted draft", async () => {
    state.list = { controls: [detailFixture("implemented")], nextCursor: null };
    state.detail = detailFixture("implemented");
    state.update.mockRejectedValueOnce(
      new ApiClientError("api", "Conflict", 409),
    );
    mount({ initialControlId: controlId });
    await screen.findByRole("button", { name: "Edit control" });
    fireEvent.click(screen.getByRole("button", { name: "Edit control" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Implementation status" }),
      {
        target: { value: "in_progress" },
      },
    );
    expect(
      screen.getByRole("textbox", {
        name: "Reason for moving status backward",
      }),
    ).toBeRequired();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Reason for moving status backward",
      }),
      {
        target: { value: "New test failure" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        controlId,
        expect.objectContaining({
          status: "in_progress",
          transitionReason: "New test failure",
          expectedRevision: 3,
        }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed in another session/i,
    );
    expect(
      screen.getByRole("textbox", {
        name: "Reason for moving status backward",
      }),
    ).toHaveValue("New test failure");
  });

  it("maps exact requirement text to an explicitly checked product", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    state.products = [{ id: productId, name: "Run-scoped product" }];
    state.requirements = [
      {
        requirementKey: "part-i",
        identifier: "Annex I, Part I",
        heading: "Products with digital elements",
        text: "Structural heading",
        parentKey: null,
        position: 0,
        depth: 0,
        sourceReference: "Annex I, Part I",
      },
      {
        requirementKey: "part-i-1",
        identifier: "Annex I, Part I, 1",
        heading: "Secure updates",
        text: "<script>inert</script> exact source text",
        parentKey: null,
        position: 1,
        depth: 1,
        sourceReference: "Annex I, Part I, 1",
      },
    ];
    state.addMapping.mockResolvedValue({
      controlId,
      revision: 4,
      mappingId: organizationId,
    });
    mount({ initialControlId: controlId });
    fireEvent.click(
      await screen.findByRole("button", { name: "Map requirement" }),
    );
    await screen.findByRole("option", { name: /Annex I, Part I, 1/ });
    expect(
      screen.queryByRole("option", { name: /Products with digital elements/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Requirement" }), {
      target: { value: "part-i-1" },
    });
    expect(
      screen.getByText("<script>inert</script> exact source text"),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Applies to this product." },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Run-scoped product" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Run-scoped product" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Run-scoped product" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() =>
      expect(state.addMapping).toHaveBeenCalledWith(
        controlId,
        expect.objectContaining({
          packKey: "cra-annex-i",
          versionKey: "oj-2024-11-20",
          requirementKey: "part-i-1",
          productIds: [productId],
        }),
      ),
    );
  });

  it("offers a clean historical evidence version without substituting the current version", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    state.products = [{ id: productId, name: "Run-scoped product" }];
    state.evidenceDocuments = [
      {
        document: {
          id: evidenceDocumentId,
          currentVersion: { title: "Design review", id: organizationId },
        },
      },
    ];
    state.evidenceVersions = [
      {
        id: historicalVersionId,
        title: "Design review historical",
        versionNumber: 2,
        status: "clean",
        productIds: [productId],
        validFrom: null,
        validUntil: null,
      },
    ];
    state.linkEvidence.mockResolvedValue({
      controlId,
      revision: 4,
      linkId: organizationId,
    });
    mount({ initialControlId: controlId });
    fireEvent.click(
      await screen.findByRole("button", { name: "Link evidence version" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Evidence product" }),
      { target: { value: productId } },
    );
    await screen.findByRole("option", { name: "Design review" });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Evidence document" }),
      { target: { value: evidenceDocumentId } },
    );
    await screen.findByRole("option", {
      name: "Design review historical · Version 2",
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Clean evidence version" }),
      {
        target: { value: historicalVersionId },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save evidence link" }));
    await waitFor(() =>
      expect(state.linkEvidence).toHaveBeenCalledWith(
        controlId,
        expect.objectContaining({
          evidenceVersionId: historicalVersionId,
          productId,
        }),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close evidence picker" }),
    );
    expect(
      screen.queryByRole("combobox", { name: "Clean evidence version" }),
    ).not.toBeInTheDocument();
  });

  it("shows restricted projections honestly and requires archive confirmation", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = {
      ...detailFixture(),
      evidenceRestricted: true,
      mappings: [
        {
          id: organizationId,
          packKey: "cra-annex-i",
          versionKey: "oj-2024-11-20",
          requirementKey: "part-i-1",
          identifier: "Annex I, Part I, 1",
          heading: null,
          requirementText: "Exact text",
          rationale: "Reason",
          productIds: [],
          productsRestricted: true,
          sourceControlRevision: 1,
          endedAt: null,
          createdAt: "2026-09-24T00:00:00Z",
        },
      ],
    };
    state.archive.mockResolvedValue({ controlId, revision: 4 });
    mount({
      initialControlId: controlId,
      canViewProducts: false,
      canViewEvidence: false,
    });
    expect(
      await screen.findByText(/Evidence links are restricted/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Product scope restricted/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/No evidence versions linked/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive control" }));
    expect(state.archive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive control" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() =>
      expect(state.archive).toHaveBeenCalledWith(
        controlId,
        expect.objectContaining({ expectedRevision: 3 }),
      ),
    );
  });

  it("edits an active mapping and ends links without erasing history", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.products = [{ id: productId, name: "Run-scoped product" }];
    state.requirements = [
      {
        requirementKey: "part-i-1",
        identifier: "Annex I, Part I, 1",
        heading: "Secure updates",
        text: "Exact source text",
        parentKey: null,
        position: 1,
        depth: 1,
        sourceReference: "Annex I, Part I, 1",
      },
    ];
    state.detail = {
      ...detailFixture(),
      evidenceLinks: [
        {
          id: evidenceDocumentId,
          evidenceVersionId: historicalVersionId,
          productId,
          evidenceTitle: "Test evidence",
          evidenceVersionNumber: 2,
          availability: "available",
          sourceControlRevision: 2,
          endedAt: null,
          createdAt: "2026-09-24T00:00:00Z",
        },
      ],
      mappings: [
        {
          id: organizationId,
          packKey: "cra-annex-i",
          versionKey: "oj-2024-11-20",
          requirementKey: "part-i-1",
          identifier: "Annex I, Part I, 1",
          heading: "Secure updates",
          requirementText: "Exact source text",
          rationale: "Original reason",
          productIds: [productId],
          productsRestricted: false,
          sourceControlRevision: 2,
          endedAt: null,
          createdAt: "2026-09-24T00:00:00Z",
        },
      ],
    };
    state.updateMapping.mockResolvedValue({ controlId, revision: 4 });
    state.endMapping.mockResolvedValue({ controlId, revision: 4 });
    state.endEvidenceLink.mockResolvedValue({ controlId, revision: 4 });
    mount({ initialControlId: controlId });
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit mapping" }),
    );
    await screen.findByRole("option", { name: /Annex I, Part I, 1/ });
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Updated reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() =>
      expect(state.updateMapping).toHaveBeenCalledWith(
        controlId,
        organizationId,
        expect.objectContaining({
          rationale: "Updated reason",
          productIds: [productId],
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "End link" }));
    await waitFor(() =>
      expect(state.endEvidenceLink).toHaveBeenCalledWith(
        controlId,
        evidenceDocumentId,
        expect.objectContaining({ expectedRevision: 3 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "End mapping" }));
    await waitFor(() =>
      expect(state.endMapping).toHaveBeenCalledWith(
        controlId,
        organizationId,
        expect.objectContaining({ expectedRevision: 3 }),
      ),
    );
    expect(screen.getByText("Exact source text")).toBeInTheDocument();
  });

  it("opens a listed control and filters archived controls", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Secure updates" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Secure updates" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show archived controls" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Show archived controls" }),
    ).toBeChecked();
  });

  it("shows a product-scope prompt when no edition is enabled", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    mount({
      initialControlId: controlId,
      activePackKey: null,
      activeVersionKey: null,
    });
    expect(
      await screen.findByText(
        /Enable a framework edition before adding a mapping/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Map requirement" }),
    ).not.toBeInTheDocument();
  });

  it("creates a control and opens its detail after a successful command", async () => {
    state.create.mockResolvedValue({ controlId, revision: 1 });
    state.detail = detailFixture();
    state.owners = [
      { id: organizationId, displayName: "Current owner" },
      { id: productId, displayName: "Another active owner" },
    ];
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Create control" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Control title" }), {
      target: { value: "Secure updates" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Review update design." },
    });
    await screen.findByRole("option", { name: "Another active owner" });
    fireEvent.change(screen.getByRole("combobox", { name: "Owner" }), {
      target: { value: productId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save control" }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "not_started",
          expectedRevision: null,
          ownerUserId: productId,
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Secure updates" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Control title" }),
    ).not.toBeInTheDocument();
  });

  it("advances status and closes the edit form after a successful update", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    state.update.mockResolvedValue({ controlId, revision: 4 });
    mount({ initialControlId: controlId });
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit control" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Implementation status" }),
      { target: { value: "in_progress" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Owner" }), {
      target: { value: organizationId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        controlId,
        expect.objectContaining({ status: "in_progress" }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it("shows mapped controls for the selected product and retries a failed list", async () => {
    state.listError = true;
    const first = mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    state.listError = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry controls" }));
    expect(await screen.findByText(/No controls yet/i)).toBeInTheDocument();
    first.unmount();

    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    state.products = [{ id: productId, name: "Run-scoped product" }];
    state.coverage = {
      packKey: "cra-annex-i",
      versionKey: "oj-2024-11-20",
      productId,
      calculation: { status: "current", calculatedAt: "2026-09-24T10:00:00Z" },
      summary: {
        totalRequirements: 1,
        applicableRequirements: 1,
        excludedRequirements: 0,
        evidenceBackedRequirements: 0,
        gapRequirements: 1,
      },
      requirements: [
        {
          requirementKey: "part-i-1",
          identifier: "Annex I, Part I, 1",
          heading: null,
          text: "Exact source text",
          parentKey: null,
          controls: [
            {
              id: controlId,
              title: "Secure updates",
              status: "not_started",
              ownerActive: false,
              evidencePresent: false,
            },
          ],
        },
      ],
      nextCursor: null,
    };
    mount({ initialControlId: controlId });
    const table = await screen.findByRole("table", {
      name: "Requirement coverage for selected product",
    });
    expect(table).toHaveTextContent("Mapped");
    expect(table).toHaveTextContent("Evidence absent");
    expect(table).toHaveTextContent("Owner gap");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Coverage product" }),
      { target: { value: productId } },
    );
  });

  it("loads the next bounded control page and cancels an unsaved create", async () => {
    state.list = { controls: [detailFixture()], nextCursor: "next-cursor" };
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more controls" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create control" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Control title" }), {
      target: { value: "Draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("textbox", { name: "Control title" }),
    ).not.toBeInTheDocument();
  });

  it("retries a failed product coverage read without changing the control", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    state.products = [{ id: productId, name: "Run-scoped product" }];
    state.coverageError = true;
    mount({ initialControlId: controlId });
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
    state.coverageError = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry coverage" }));
    expect(
      await screen.findByRole("table", {
        name: "Requirement coverage for selected product",
      }),
    ).toBeInTheDocument();
  });

  it("does not present stale control coverage as current", async () => {
    state.list = { controls: [detailFixture()], nextCursor: null };
    state.detail = detailFixture();
    state.products = [{ id: productId, name: "Run-scoped product" }];
    state.coverage = {
      packKey: "cra-annex-i",
      versionKey: "oj-2024-11-20",
      productId,
      calculation: { status: "stale", calculatedAt: "2026-09-23T10:00:00Z" },
      summary: null,
      requirements: [
        {
          requirementKey: "part-i-1",
          identifier: "I.1",
          heading: null,
          text: "Exact source text",
          parentKey: null,
          controls: [
            {
              id: controlId,
              title: "Secure updates",
              status: "implemented",
              ownerActive: true,
              evidencePresent: true,
            },
          ],
        },
      ],
      nextCursor: null,
    };
    mount({ initialControlId: controlId });
    expect(await screen.findByRole("alert")).toHaveTextContent(/stale/i);
    expect(
      screen.queryByRole("table", {
        name: "Requirement coverage for selected product",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence present/i)).not.toBeInTheDocument();
  });
});
