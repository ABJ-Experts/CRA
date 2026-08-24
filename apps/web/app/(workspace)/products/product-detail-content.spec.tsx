// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  ProductRetentionCalculation,
  ProductSupportPeriod,
  Release,
  SupportAlertHistoryItem,
  SupportAlertIntervals,
} from "@repo/contracts/products";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { ProductDetailContent } from "./product-detail-content";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("../../_features/organizations/organizations.queries", () => ({
  useOrganizationSettingsQuery: () => ({ data: undefined }),
}));
vi.mock("../../_features/sboms/sboms.queries", () => ({
  useSbomJobQuery: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
  useSbomSourceHistoryQuery: () => ({
    data: { sources: [], nextCursor: null },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSbomValidationReportQuery: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
  }),
  useSbomDocumentsForReleaseQuery: () => ({
    data: { documents: [], nextCursor: null },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const PRODUCT = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "Sentinel",
  internalCode: "CRA-001",
  productType: "standalone_software",
  description: null,
  responsibleOwnerId: "33333333-3333-4333-8333-333333333333",
  legalEntity: {
    id: "44444444-4444-4444-8444-444444444444",
    identifier: "cra-gb",
    legalName: "CRA Ltd",
    mainEstablishmentCountry: "GB",
    version: 1,
  },
  archivedAt: null,
  version: 1,
  releaseCount: 0,
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
  createdBy: "33333333-3333-4333-8333-333333333333",
  updatedBy: "33333333-3333-4333-8333-333333333333",
} as const;
const RELEASE = {
  id: "55555555-5555-4555-8555-555555555555",
  organizationId: PRODUCT.organizationId,
  productId: PRODUCT.id,
  label: "Sentinel 1.0",
  version: "1.0.0",
  description: null,
  lifecycle: "development",
  placedOnMarketAt: null,
  marketAvailabilityWarning: "no_active_member_state_availability",
  legalEntity: PRODUCT.legalEntity,
  archivedAt: null,
  versionNumber: 1,
  createdAt: PRODUCT.createdAt,
  updatedAt: PRODUCT.updatedAt,
  createdBy: PRODUCT.createdBy,
  updatedBy: PRODUCT.updatedBy,
} as const;

type QueryState<TData> = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: TData;
  refetch: ReturnType<typeof vi.fn>;
};

const SUPPORT_PERIOD = {
  id: "66666666-6666-4666-8666-666666666666",
  releaseId: RELEASE.id,
  supportStartsAt: "2026-08-12T10:00:00.000Z",
  supportEndsAt: "2029-08-12T10:00:00.000Z",
  expectedLifetimeJustification: "Vendor support commitment",
  decisionActorId: PRODUCT.updatedBy,
  effectiveAt: PRODUCT.updatedAt,
  supersededAt: null,
  supersededById: null,
  scopeRevision: 1,
  version: 1,
  organizationId: PRODUCT.organizationId,
  productId: PRODUCT.id,
  createdAt: PRODUCT.createdAt,
  createdBy: PRODUCT.createdBy,
  updatedAt: PRODUCT.updatedAt,
  updatedBy: PRODUCT.updatedBy,
} satisfies ProductSupportPeriod;

const transitionMutation = {
  isPending: false,
  mutateAsync: vi.fn(async () => ({ release: RELEASE })),
};
const previewSupportPeriodMutation = {
  isPending: false,
  data: null as unknown,
  mutateAsync: vi.fn(async () => ({
    preview: {
      current: SUPPORT_PERIOD,
      proposed: {
        supportStartsAt: "2026-08-12T10:00:00.000Z",
        supportEndsAt: "2030-08-12T10:00:00.000Z",
        expectedLifetimeJustification: "Vendor support commitment",
      },
      lowering: false,
      previewDigest: "a".repeat(64),
      activeScopeRevision: 1,
      isShortening: false,
      retentionProtectionWouldReduce: false,
      blockedReasons: [],
      affectedCategories: ["retention_dates"],
      currentRetentionUntil: null,
      proposedRetentionUntil: "2036-08-12T10:00:00.000Z",
    },
  })),
};
const createSupportPeriodMutation = {
  isPending: false,
  mutateAsync: vi.fn(async () => ({
    supportPeriod: SUPPORT_PERIOD,
  })),
};
const supersedeSupportPeriodMutation = {
  isPending: false,
  mutateAsync: vi.fn(async () => ({ supportPeriod: SUPPORT_PERIOD })),
};
const updateSupportAlertIntervalsMutation = {
  isPending: false,
  mutateAsync: vi.fn(async () => ({
    alertIntervalsDays: [30, 180],
    version: 1,
    updatedAt: PRODUCT.updatedAt,
    updatedBy: PRODUCT.updatedBy,
  })),
};

const state = {
  session: {
    session: { organizations: [{ id: PRODUCT.organizationId }] },
    permissions: {
      can_view_products: true,
      can_create_products: true,
      can_edit_products: true,
      can_delete_products: true,
    } as Record<string, boolean>,
    isLoading: false,
    role: "owner",
  },
  product: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { product: PRODUCT },
    refetch: vi.fn(),
  },
  releases: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      releases: {
        rows: [] as readonly Release[],
        total: 0,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  },
  memberStates: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      memberStates: [
        { countryCode: "DE", name: "Germany", version: 1, active: true },
      ],
    },
    refetch: vi.fn(),
  },
  availability: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { marketAvailability: [] },
    refetch: vi.fn(),
  },
  timeline: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { timeline: [] },
    refetch: vi.fn(),
  },
  supportPeriods: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { supportPeriods: [] },
    refetch: vi.fn(),
  } as QueryState<{ supportPeriods: ProductSupportPeriod[] }>,
  supportRetention: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      retention: {
        ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
        status: "incomplete",
        placedOnMarketCandidate: null,
        supportPeriodCandidate: null,
        retentionUntil: null,
        retentionProtectionUntil: null,
        winningRule: null,
        incompleteReasons: ["missing_support_period"],
        legalHoldActive: false,
        releaseCalculations: [],
      },
    },
    refetch: vi.fn(),
  } as QueryState<{ retention: ProductRetentionCalculation }>,
  supportAlerts: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { alerts: [] },
    refetch: vi.fn(),
  } as QueryState<{ alerts: SupportAlertHistoryItem[] }>,
  supportAlertIntervals: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: {
      alertIntervalsDays: [30, 180],
      version: 1,
      updatedAt: PRODUCT.updatedAt,
      updatedBy: PRODUCT.updatedBy,
    },
    refetch: vi.fn(),
  } as QueryState<SupportAlertIntervals>,
};

vi.mock("../../_features/products/products.queries", () => ({
  useProductsQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      products: { rows: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
    },
    refetch: vi.fn(),
  }),
  useProductQuery: () => state.product,
  useProductReleasesQuery: () => state.releases,
  useSubstantialModificationAssessmentsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      assessments: { rows: [], total: 0, page: 1, pageSize: 15, pageCount: 1 },
    },
    refetch: vi.fn(),
  }),
  useSecurityUpdateArtifactsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      artifacts: { rows: [], total: 0, page: 1, pageSize: 15, pageCount: 1 },
    },
    refetch: vi.fn(),
  }),
  useCreateSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCreateSubstantialModificationAssessmentDraftMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReassessSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReviewSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReserveSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useFinalizeSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useFinalizeReservedSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReviewSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  usePublishSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReplaceSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useWithdrawSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdateProductMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useArchiveProductMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateReleaseMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateReleaseMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useArchiveReleaseMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useMemberStatesQuery: () => state.memberStates,
  useReleaseMarketAvailabilityQuery: () => state.availability,
  useReleaseLifecycleTimelineQuery: () => state.timeline,
  useAddReleaseMarketAvailabilityMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRemoveReleaseMarketAvailabilityMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCorrectReleaseMarketAvailabilityMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useTransitionReleaseLifecycleMutation: () => transitionMutation,
  useCorrectPlacedOnMarketDateMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSupportPeriodHistoryQuery: () => state.supportPeriods,
  useSupportPeriodRetentionQuery: () => state.supportRetention,
  useSupportAlertsQuery: () => state.supportAlerts,
  useSupportAlertIntervalsQuery: () => state.supportAlertIntervals,
  usePreviewSupportPeriodMutation: () => previewSupportPeriodMutation,
  useCreateSupportPeriodMutation: () => createSupportPeriodMutation,
  useSupersedeSupportPeriodMutation: () => supersedeSupportPeriodMutation,
  useUpdateSupportAlertIntervalsMutation: () =>
    updateSupportAlertIntervalsMutation,
  useSoftwareBaselineMembershipsQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: { memberships: [], baselines: [] },
    refetch: vi.fn(),
  }),
  useProductVariantRelationshipsQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: { relationships: [] },
    refetch: vi.fn(),
  }),
  useProductComponentLinksQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: { links: [] },
    refetch: vi.fn(),
  }),
  useProductRelationshipGraphQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: { graph: { graphVersion: 0, nodes: [], links: [] } },
    refetch: vi.fn(),
  }),
  useRelationshipPropagationEventsQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: { events: [] },
    refetch: vi.fn(),
  }),
  usePreviewProductComponentLinkMutation: () => ({
    isPending: false,
    data: undefined,
    mutateAsync: vi.fn(),
  }),
  useCreateProductComponentLinkMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useEndProductComponentLinkMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSupersedeProductComponentLinkMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useAssignSoftwareBaselineMembershipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useEndSoftwareBaselineMembershipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCreateProductVariantRelationshipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useEndProductVariantRelationshipMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSoftwareBaselineRevisionsQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: { baselines: [] },
    refetch: vi.fn(),
  }),
  useSoftwareBaselinesQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      baselines: { items: [], nextCursor: null },
    },
    refetch: vi.fn(),
  }),
  useCreateSoftwareBaselineMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useAppendSoftwareBaselineRevisionMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useArchiveSoftwareBaselineMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRequestRelationshipReevaluationMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));
vi.mock("../../_features/findings/finding-impact.queries", () => ({
  useFindingImpactSummaryQuery: () => ({
    isPending: false,
    isError: false,
    error: null,
    data: {
      summary: {
        productId: PRODUCT.id,
        releaseId: null,
        activeImpactCount: 0,
        supersededImpactCount: 0,
        closedImpactCount: 0,
        overrideCount: 0,
        latestGraphVersion: null,
        latestEvaluatedAt: null,
        propagationState: "idle",
        queuedJobCount: 0,
        inProgressJobCount: 0,
        retryingJobCount: 0,
        deadLetterJobCount: 0,
      },
    },
    refetch: vi.fn(),
  }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state.session,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function openReleaseWorkspace(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Releases and compliance" }),
  );
}

describe("ProductDetailContent", () => {
  const previous = process.env.NEXT_PUBLIC_ENABLE_MOCKS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.session = {
      session: { organizations: [{ id: PRODUCT.organizationId }] },
      permissions: {
        can_view_products: true,
        can_create_products: true,
        can_edit_products: true,
        can_delete_products: true,
      },
      isLoading: false,
      role: "owner",
    };
    state.product.isPending = false;
    state.product.isError = false;
    state.product.data = { product: PRODUCT };
    state.releases.isPending = false;
    state.releases.isError = false;
    state.releases.data = {
      releases: { rows: [], total: 0, page: 1, pageSize: 50, pageCount: 1 },
    };
    state.memberStates.isPending = false;
    state.memberStates.isError = false;
    state.memberStates.data = {
      memberStates: [
        { countryCode: "DE", name: "Germany", version: 1, active: true },
      ],
    };
    state.availability.isPending = false;
    state.availability.isError = false;
    state.availability.data = { marketAvailability: [] };
    state.timeline.isPending = false;
    state.timeline.isError = false;
    state.timeline.data = { timeline: [] };
    state.supportPeriods.isPending = false;
    state.supportPeriods.isError = false;
    state.supportPeriods.data = { supportPeriods: [] };
    state.supportRetention.isPending = false;
    state.supportRetention.isError = false;
    state.supportRetention.data = {
      retention: {
        ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
        status: "incomplete",
        placedOnMarketCandidate: null,
        supportPeriodCandidate: null,
        retentionUntil: null,
        retentionProtectionUntil: null,
        winningRule: null,
        incompleteReasons: ["missing_support_period"],
        legalHoldActive: false,
        releaseCalculations: [],
      },
    };
    state.supportAlerts.isPending = false;
    state.supportAlerts.isError = false;
    state.supportAlerts.data = { alerts: [] };
    state.supportAlertIntervals.isPending = false;
    state.supportAlertIntervals.isError = false;
    state.supportAlertIntervals.data = {
      alertIntervalsDays: [30, 180],
      version: 1,
      updatedAt: PRODUCT.updatedAt,
      updatedBy: PRODUCT.updatedBy,
    };
    transitionMutation.mutateAsync.mockClear();
    previewSupportPeriodMutation.data = null;
    previewSupportPeriodMutation.mutateAsync.mockClear();
    createSupportPeriodMutation.mutateAsync.mockClear();
    supersedeSupportPeriodMutation.mutateAsync.mockClear();
    updateSupportAlertIntervalsMutation.mutateAsync.mockClear();
  });

  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = previous;
  });

  it("keeps the overview concise and opens product work in focused dialogs", async () => {
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(screen.getByText("CRA Ltd")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Product workbench" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Finding impact" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit product" }),
    ).toHaveAccessibleDescription("Update product identity and ownership.");

    fireEvent.click(screen.getByRole("button", { name: "Edit product" }));

    expect(
      screen.getByRole("dialog", { name: "Edit product" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Identity" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByRole("tab", { name: "Ownership" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit product" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Releases and compliance" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Releases and compliance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No releases have been added yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add release" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Releases" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByRole("tab", { name: "Lifecycle" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Support and retention" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Releases and compliance" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Modifications" }));
    expect(
      screen.getByRole("dialog", { name: "Modifications" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Substantial modifications" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(
      screen.getByRole("tab", { name: "Record assessment" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Security update artifacts" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Modifications" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Security artifacts" }));
    expect(
      screen.getByRole("dialog", { name: "Security artifacts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Security update artifacts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(
      screen.getByRole("tab", { name: "Reserve artifact" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Substantial modifications" }),
    ).not.toBeInTheDocument();
  });

  it("removes an open product editor when edit access is no longer available", () => {
    const view = render(<ProductDetailContent productId={PRODUCT.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit product" }));
    expect(
      screen.getByRole("dialog", { name: "Edit product" }),
    ).toBeInTheDocument();

    state.session.permissions = {
      can_view_products: true,
      can_create_products: true,
      can_edit_products: false,
      can_delete_products: true,
    };
    view.rerender(<ProductDetailContent productId={PRODUCT.id} />);

    expect(
      screen.queryByRole("dialog", { name: "Edit product" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it("keeps read-only product workspaces on review tabs", async () => {
    state.session.permissions = {
      can_view_products: true,
      can_create_products: false,
      can_edit_products: false,
      can_delete_products: false,
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);

    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Record change" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Relationships" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Modifications" }));
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Record assessment" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Modifications" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Security artifacts" }));
    expect(screen.getByRole("tab", { name: "Artifacts" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Reserve artifact" }),
    ).not.toBeInTheDocument();
  });

  it("shows a retryable unavailable state for tenant-safe product misses", () => {
    state.product.isError = true;
    state.product.data = undefined as never;
    state.product.error = new ApiClientError("api", "Not found", 404);
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("shows a terminal forbidden state instead of a disabled blank detail view", () => {
    state.session.permissions = {
      can_view_products: false,
      can_create_products: false,
      can_edit_products: false,
      can_delete_products: false,
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission to view products",
    );
    expect(screen.queryByText("CRA Ltd")).not.toBeInTheDocument();
  });

  it("shows the release-level availability warning and guarded lifecycle action", () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Lifecycle" }));

    expect(
      screen.getByText("No Member State availability has been recorded."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Transition lifecycle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tabpanel", { name: "Lifecycle" }),
    ).toBeInTheDocument();
  });

  it("adds the release-bound SBOM evidence surface only when the explicit view permission is present", () => {
    state.session.permissions = {
      can_view_products: true,
      can_create_products: true,
      can_edit_products: true,
      can_delete_products: true,
      can_view_sboms: true,
      can_upload_sboms: true,
    };
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);

    expect(
      screen.getByRole("heading", { name: "SBOM evidence" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Release")).toHaveTextContent(RELEASE.label);
  });

  it("groups each release into an accessible workspace with its compliance controls", () => {
    state.releases.data = {
      releases: {
        rows: [
          {
            ...RELEASE,
            description: "A release used to verify the compliance workflow.",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };

    render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Support and retention" }));

    const releaseWorkspace = screen.getByLabelText(
      "Release workspace for Sentinel 1.0",
    );
    expect(releaseWorkspace).toHaveTextContent(
      "A release used to verify the compliance workflow.",
    );
    expect(
      screen.getByLabelText("Product registry summary"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Support and retention for Sentinel 1.0",
      }),
    ).toBeInTheDocument();
  });

  it("reports a placement guard without presenting it as a stale update", async () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    transitionMutation.mutateAsync.mockRejectedValueOnce(
      new ApiClientError(
        "api",
        "Product registry request could not be completed.",
        409,
        "placement_requires_active_market_availability",
      ),
    );
    render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Lifecycle" }));

    fireEvent.change(screen.getByLabelText("Placed on market at (UTC)"), {
      target: { value: "2026-08-12T10:00:00.000Z" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Transition lifecycle" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Add at least one active Member State/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Reload current data" }),
    ).not.toBeInTheDocument();
  });

  it("submits the next permitted transition after a release changes state", async () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    const view = render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Lifecycle" }));
    expect(
      screen.getByRole("combobox", {
        name: `Lifecycle target for ${RELEASE.label}`,
      }),
    ).toHaveValue("placed_on_market");

    state.releases.data = {
      releases: {
        rows: [
          {
            ...RELEASE,
            lifecycle: "placed_on_market",
            placedOnMarketAt: "2026-08-12T10:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    view.rerender(<ProductDetailContent productId={PRODUCT.id} />);

    expect(
      screen.getByRole("combobox", {
        name: `Lifecycle target for ${RELEASE.label}`,
      }),
    ).toHaveValue("in_support");
    fireEvent.click(
      screen.getByRole("button", { name: "Transition lifecycle" }),
    );

    await waitFor(() =>
      expect(transitionMutation.mutateAsync).toHaveBeenCalledWith({
        targetState: "in_support",
        expectedVersion: 1,
      }),
    );
  });

  it("shows support period report states for each release", () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    state.supportPeriods.data = {
      supportPeriods: [SUPPORT_PERIOD],
    };
    state.supportRetention.data = {
      retention: {
        ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
        status: "current",
        placedOnMarketCandidate: "2036-08-12T10:00:00.000Z",
        supportPeriodCandidate: "2029-08-12T10:00:00.000Z",
        retentionUntil: "2036-08-12T10:00:00.000Z",
        retentionProtectionUntil: "2036-08-12T10:00:00.000Z",
        winningRule: "placed_on_market_plus_10_calendar_years",
        incompleteReasons: [],
        legalHoldActive: false,
        releaseCalculations: [
          {
            releaseId: RELEASE.id,
            ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
            status: "current",
            placedOnMarketCandidate: "2036-08-12T10:00:00.000Z",
            supportPeriodCandidate: "2029-08-12T10:00:00.000Z",
            retentionUntil: "2036-08-12T10:00:00.000Z",
            retentionProtectionUntil: "2036-08-12T10:00:00.000Z",
            winningRule: "placed_on_market_plus_10_calendar_years",
            incompleteReasons: [],
            legalHoldActive: false,
          },
        ],
      },
    };
    state.supportAlerts.data = {
      alerts: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          supportPeriodId: "66666666-6666-4666-8666-666666666666",
          supportPeriodRevision: 1,
          thresholdDays: 180,
          dueAt: "2029-02-13T10:00:00.000Z",
          deliveredAt: null,
          deliveryState: "scheduled",
          missed: false,
          obsolete: false,
          attempts: 0,
          lastErrorCode: null,
        },
      ],
    };

    render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Support and retention" }));

    expect(
      screen.getByRole("heading", { name: "Support and retention" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 Aug 2026.*12 Aug 2029/)).toBeInTheDocument();
    expect(screen.getByText("Legal retention outcome")).toBeInTheDocument();
    expect(screen.getByText(/Retained until 12 Aug 2036/)).toBeInTheDocument();
    expect(
      screen.getByText(/180 days before support end · scheduled/),
    ).toBeInTheDocument();
  });

  it("records a support period through parsed mutation input", async () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Support and retention" }));

    fireEvent.change(screen.getByLabelText(/Support starts/), {
      target: { value: "2026-08-12T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/Support ends/), {
      target: { value: "2029-08-12T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/Expected lifetime justification/), {
      target: { value: "Vendor support commitment" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record support period" }),
    );

    await waitFor(() =>
      expect(createSupportPeriodMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          releaseId: RELEASE.id,
          supportStartsAt: "2026-08-12T10:00:00.000Z",
          supportEndsAt: "2029-08-12T10:00:00.000Z",
          expectedLifetimeJustification: "Vendor support commitment",
        }),
      ),
    );
    expect(previewSupportPeriodMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("previews a support-period supersession with current and proposed values", async () => {
    state.releases.data = {
      releases: {
        rows: [RELEASE],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
    };
    state.supportPeriods.data = {
      supportPeriods: [SUPPORT_PERIOD],
    };
    render(<ProductDetailContent productId={PRODUCT.id} />);
    openReleaseWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Support and retention" }));

    fireEvent.change(screen.getByLabelText(/Support ends/), {
      target: { value: "2030-08-12T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview retention" }));

    await waitFor(() =>
      expect(previewSupportPeriodMutation.mutateAsync).toHaveBeenCalledWith({
        releaseId: RELEASE.id,
        expectedVersion: 1,
        current: {
          supportStartsAt: "2026-08-12T10:00:00.000Z",
          supportEndsAt: "2029-08-12T10:00:00.000Z",
          expectedLifetimeJustification: "Vendor support commitment",
        },
        proposed: {
          supportStartsAt: "2026-08-12T10:00:00.000Z",
          supportEndsAt: "2030-08-12T10:00:00.000Z",
          expectedLifetimeJustification: "Vendor support commitment",
        },
      }),
    );
  });
});
