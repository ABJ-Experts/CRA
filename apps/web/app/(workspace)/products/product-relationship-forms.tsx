"use client";

import {
  appendSoftwareBaselineRevisionInputSchema,
  archiveSoftwareBaselineInputSchema,
  assignSoftwareBaselineMembershipInputSchema,
  createProductComponentLinkInputSchema,
  createProductVariantRelationshipInputSchema,
  createSoftwareBaselineInputSchema,
  endProductComponentLinkInputSchema,
  endProductVariantRelationshipInputSchema,
  endSoftwareBaselineMembershipInputSchema,
  previewProductComponentLinkInputSchema,
  requestRelationshipReevaluationInputSchema,
  supersedeProductComponentLinkInputSchema,
  type ProductComponentLink,
  type ProductVariantRelationship,
  type SoftwareBaselineReleaseMembership,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { useEffect, useRef, useState } from "react";

import {
  useAppendSoftwareBaselineRevisionMutation,
  useArchiveSoftwareBaselineMutation,
  useAssignSoftwareBaselineMembershipMutation,
  useCreateProductComponentLinkMutation,
  useCreateProductVariantRelationshipMutation,
  useCreateSoftwareBaselineMutation,
  useEndProductComponentLinkMutation,
  useEndProductVariantRelationshipMutation,
  useEndSoftwareBaselineMembershipMutation,
  useProductReleasesQuery,
  useProductsQuery,
  usePreviewProductComponentLinkMutation,
  useRequestRelationshipReevaluationMutation,
  useSoftwareBaselinesQuery,
  useSoftwareBaselineRevisionsQuery,
  useSupersedeProductComponentLinkMutation,
} from "../../_features/products/products.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { ProductRelationshipEvidenceInputs } from "./product-relationship-evidence-inputs";
import { ProductRelationshipLifecycleControls } from "./product-relationship-lifecycle-controls";

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;

type FormProps = Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  graphVersion: number;
  memberships: readonly SoftwareBaselineReleaseMembership[];
  variants: readonly ProductVariantRelationship[];
  components: readonly ProductComponentLink[];
  organizationTimezone: string | null;
  onReload: () => void;
}>;

type ProductSearchSelectProps = Readonly<{
  label: string;
  searchLabel: string;
  search: string;
  selectedId: string;
  selectedLabel: string;
  excludedProductId: string;
  onSearchChange: (value: string) => void;
  onSelectionChange: (product: Readonly<{ id: string; name: string }>) => void;
}>;

function ProductSearchSelect({
  label,
  searchLabel,
  search,
  selectedId,
  selectedLabel,
  excludedProductId,
  onSearchChange,
  onSelectionChange,
}: ProductSearchSelectProps) {
  const trimmedSearch = search.trim();
  const products = useProductsQuery(
    { q: trimmedSearch, page: 1, pageSize: 25, archived: false },
    trimmedSearch.length > 0,
  );
  const rows = (products.data?.products.rows ?? []).filter(
    (product) => product.id !== excludedProductId,
  );

  return (
    <div className="grid gap-2">
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        {searchLabel}
        <input
          aria-label={searchLabel}
          autoComplete="off"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Type a product name or internal code"
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        {label}
        <select
          aria-label={label}
          value={selectedId}
          disabled={trimmedSearch.length === 0 || products.isPending}
          onChange={(event) => {
            const selected = rows.find(
              (product) => product.id === event.target.value,
            );
            if (selected) {
              onSelectionChange({ id: selected.id, name: selected.name });
            }
          }}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg disabled:cursor-not-allowed disabled:text-fg-muted"
        >
          <option value="">
            {products.isPending ? "Searching products…" : "Select product"}
          </option>
          {selectedId !== "" &&
          !rows.some((product) => product.id === selectedId) ? (
            <option value={selectedId}>{selectedLabel}</option>
          ) : null}
          {rows.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {product.internalCode}
            </option>
          ))}
        </select>
      </label>
      {trimmedSearch.length === 0 ? (
        <p className="text-caption-1-regular text-fg-muted">
          Search the current organization before selecting a product.
        </p>
      ) : null}
      {products.isError ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          Product search is unavailable. Try again.
        </p>
      ) : null}
      {!products.isPending &&
      !products.isError &&
      trimmedSearch.length > 0 &&
      rows.length === 0 ? (
        <p className="text-caption-1-regular text-fg-muted">
          No products match this search.
        </p>
      ) : null}
    </div>
  );
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to perform that action.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This relationship resource is unavailable.";
  }
  if (error instanceof ApiClientError && error.code === "cycle_detected") {
    return "This link would create a cycle and was not recorded.";
  }
  if (error instanceof ApiClientError && error.code === "depth_exceeded") {
    return "This link exceeds the supported relationship depth and was not recorded.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "The relationship graph changed in another session. Reload it before trying again.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  ) {
    return "The relationship registry is temporarily unavailable. Try again.";
  }
  return error instanceof ApiClientError && error.kind === "api"
    ? error.message
    : fallback;
}

function needsGraphReload(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === "conflict" ||
      error.code === "cycle_detected" ||
      error.code === "depth_exceeded")
  );
}

function toUtcInstant(value: string): string | undefined {
  if (value === "") return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

export function ProductRelationshipMutationForms({
  productId,
  releases,
  graphVersion,
  memberships,
  variants,
  components,
  organizationTimezone,
  onReload,
}: FormProps) {
  const createBaseline = useCreateSoftwareBaselineMutation();
  const [baselineId, setBaselineId] = useState("");
  const [baselineRevisionId, setBaselineRevisionId] = useState("");
  const [baselineVersion, setBaselineVersion] = useState("0");
  const [baselineSearch, setBaselineSearch] = useState("");
  const [baselineCursor, setBaselineCursor] = useState<string | undefined>();
  const [selectedBaselineLabel, setSelectedBaselineLabel] = useState("");
  const appendBaseline = useAppendSoftwareBaselineRevisionMutation(baselineId);
  const archiveBaseline = useArchiveSoftwareBaselineMutation(baselineId);
  const assignMembership =
    useAssignSoftwareBaselineMembershipMutation(productId);
  const endMembership = useEndSoftwareBaselineMembershipMutation(productId);
  const createVariant = useCreateProductVariantRelationshipMutation(productId);
  const endVariant = useEndProductVariantRelationshipMutation(productId);
  const previewComponent = usePreviewProductComponentLinkMutation(productId);
  const createComponent = useCreateProductComponentLinkMutation(productId);
  const supersedeComponent =
    useSupersedeProductComponentLinkMutation(productId);
  const endComponent = useEndProductComponentLinkMutation(productId);
  const requestReevaluation =
    useRequestRelationshipReevaluationMutation(productId);
  const [baselineIdentifier, setBaselineIdentifier] = useState("");
  const [baselineName, setBaselineName] = useState("");
  const [baselineSummary, setBaselineSummary] = useState("");
  const [selectedReleaseId, setSelectedReleaseId] = useState(
    releases[0]?.id ?? "",
  );
  const hasInitializedRelease = useRef(releases[0] !== undefined);
  const [variantSourceType, setVariantSourceType] = useState<
    "base_release" | "baseline_revision"
  >("base_release");
  const [variantProductSearch, setVariantProductSearch] = useState("");
  const [variantProductId, setVariantProductId] = useState("");
  const [variantProductName, setVariantProductName] = useState("");
  const [variantReleaseId, setVariantReleaseId] = useState("");
  const [componentProductSearch, setComponentProductSearch] = useState("");
  const [componentProductId, setComponentProductId] = useState("");
  const [componentProductName, setComponentProductName] = useState("");
  const [componentReleaseId, setComponentReleaseId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const [source, setSource] = useState("");
  const [provenance, setProvenance] = useState("");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(false);
  const baselines = useSoftwareBaselinesQuery(
    {
      q: baselineSearch.trim(),
      cursor: baselineCursor,
      pageSize: 25,
      includeArchived: false,
    },
    baselineSearch.trim().length > 0,
  );
  const baselineRevisions = useSoftwareBaselineRevisionsQuery(
    baselineId,
    baselineId !== "",
  );
  const variantReleases = useProductReleasesQuery(
    variantProductId,
    { page: 1, pageSize: 100, archived: false },
    variantProductId !== "",
  );
  const componentReleases = useProductReleasesQuery(
    componentProductId,
    { page: 1, pageSize: 100, archived: false },
    componentProductId !== "",
  );

  useEffect(() => {
    if (!hasInitializedRelease.current && releases[0]) {
      setSelectedReleaseId(releases[0].id);
      hasInitializedRelease.current = true;
    }
  }, [releases]);

  const evidence = {
    source,
    provenance,
    reason,
    effectiveStartsAt: toUtcInstant(startsAt),
    effectiveEndsAt: toUtcInstant(endsAt),
  };
  const hasSharedEvidence =
    source.trim().length > 0 &&
    provenance.trim().length > 0 &&
    reason.trim().length > 0;
  const hasEndEvidence =
    hasSharedEvidence && evidence.effectiveEndsAt !== undefined;
  const hasUpdateEvidence =
    hasSharedEvidence && evidence.effectiveStartsAt !== undefined;

  function report(error: unknown, fallback: string) {
    setReload(needsGraphReload(error));
    setMessage(messageFor(error, fallback));
  }

  function selectBaseline(
    baseline: Readonly<{
      id: string;
      baselineId: string;
      version: number;
      name?: string;
    }>,
  ) {
    setBaselineId(baseline.baselineId);
    setBaselineRevisionId(baseline.id);
    setBaselineVersion(String(baseline.version));
    setSelectedBaselineLabel(baseline.name ?? baseline.baselineId);
  }

  function selectVariantProduct(
    product: Readonly<{ id: string; name: string }>,
  ) {
    setVariantProductId(product.id);
    setVariantProductName(product.name);
    setVariantReleaseId("");
  }

  function selectComponentProduct(
    product: Readonly<{ id: string; name: string }>,
  ) {
    setComponentProductId(product.id);
    setComponentProductName(product.name);
    setComponentReleaseId("");
  }

  async function createBaselineRecord() {
    const parsed = createSoftwareBaselineInputSchema.safeParse({
      identifier: baselineIdentifier,
      name: baselineName,
      revisionSummary: baselineSummary,
      source,
      provenance,
      effectiveStartsAt: evidence.effectiveStartsAt,
      effectiveEndsAt: evidence.effectiveEndsAt,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the software baseline.",
      );
    try {
      const result = await createBaseline.mutateAsync(parsed.data);
      selectBaseline(result.baseline);
      setBaselineSearch(result.baseline.name ?? "");
      setSelectedBaselineLabel(result.baseline.name ?? "");
      setMessage("Software baseline recorded and selected for membership.");
    } catch (error) {
      report(error, "The software baseline could not be recorded.");
    }
  }

  async function appendBaselineRevision() {
    const parsed = appendSoftwareBaselineRevisionInputSchema.safeParse({
      name: baselineName,
      revisionSummary: baselineSummary,
      source,
      provenance,
      effectiveStartsAt: evidence.effectiveStartsAt,
      effectiveEndsAt: evidence.effectiveEndsAt,
      expectedVersion: Number(baselineVersion),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the baseline revision.",
      );
    try {
      const result = await appendBaseline.mutateAsync(parsed.data);
      selectBaseline(result.baseline);
      setMessage("Software baseline revision recorded and selected.");
    } catch (error) {
      report(error, "The baseline revision could not be recorded.");
    }
  }

  async function archiveBaselineRecord() {
    const parsed = archiveSoftwareBaselineInputSchema.safeParse({
      expectedVersion: Number(baselineVersion),
      reason,
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ??
          "Check the baseline archive request.",
      );
    try {
      await archiveBaseline.mutateAsync(parsed.data);
      setMessage("Software baseline archived.");
    } catch (error) {
      report(error, "The software baseline could not be archived.");
    }
  }

  async function assignMembershipRecord() {
    const parsed = assignSoftwareBaselineMembershipInputSchema.safeParse({
      releaseId: selectedReleaseId,
      baselineId,
      baselineRevisionId,
      expectedBaselineVersion: Number(baselineVersion),
      source,
      provenance,
      effectiveStartsAt: evidence.effectiveStartsAt,
      effectiveEndsAt: evidence.effectiveEndsAt,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the baseline membership.",
      );
    try {
      await assignMembership.mutateAsync(parsed.data);
      setMessage("Software baseline membership recorded.");
    } catch (error) {
      report(error, "The baseline membership could not be recorded.");
    }
  }

  async function endMembershipRecord() {
    const membership = memberships.find(
      (item) => item.id === selectedMembershipId,
    );
    if (!membership) return setMessage("Select an active baseline membership.");
    const parsed = endSoftwareBaselineMembershipInputSchema.safeParse({
      expectedVersion: membership.version,
      reason,
      effectiveEndsAt: evidence.effectiveEndsAt,
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ??
          "Check the baseline membership end request.",
      );
    try {
      await endMembership.mutateAsync({
        membershipId: membership.id,
        input: parsed.data,
      });
      setMessage("Software baseline membership ended.");
    } catch (error) {
      report(error, "The baseline membership could not be ended.");
    }
  }

  async function createVariantRecord() {
    const parsed = createProductVariantRelationshipInputSchema.safeParse({
      sourceType: variantSourceType,
      baseReleaseId:
        variantSourceType === "base_release" ? selectedReleaseId : undefined,
      baselineRevisionId:
        variantSourceType === "baseline_revision"
          ? baselineRevisionId
          : undefined,
      variantProductId,
      variantReleaseId,
      source,
      provenance,
      reason,
      effectiveStartsAt: evidence.effectiveStartsAt,
      effectiveEndsAt: evidence.effectiveEndsAt,
      expectedGraphVersion: graphVersion,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the variant relationship.",
      );
    try {
      await createVariant.mutateAsync(parsed.data);
      setMessage("Variant relationship recorded.");
    } catch (error) {
      report(error, "The variant relationship could not be recorded.");
    }
  }

  async function endVariantRecord() {
    const relationship = variants.find((item) => item.id === selectedVariantId);
    if (!relationship)
      return setMessage("Select an active variant relationship.");
    const parsed = endProductVariantRelationshipInputSchema.safeParse({
      expectedVersion: relationship.version,
      expectedGraphVersion: graphVersion,
      reason,
      effectiveEndsAt: evidence.effectiveEndsAt,
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ??
          "Check the variant relationship end request.",
      );
    try {
      await endVariant.mutateAsync({
        relationshipId: relationship.id,
        input: parsed.data,
      });
      setMessage("Variant relationship ended.");
    } catch (error) {
      report(error, "The variant relationship could not be ended.");
    }
  }

  function componentInput() {
    return {
      componentProductId,
      parentReleaseId: selectedReleaseId || undefined,
      componentReleaseId: componentReleaseId || undefined,
      quantity: Number(quantity),
      source,
      provenance,
      reason,
      effectiveStartsAt: evidence.effectiveStartsAt,
      effectiveEndsAt: evidence.effectiveEndsAt,
      expectedGraphVersion: graphVersion,
    };
  }

  async function previewComponentRecord() {
    const parsed =
      previewProductComponentLinkInputSchema.safeParse(componentInput());
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the component link.",
      );
    try {
      await previewComponent.mutateAsync(parsed.data);
      setMessage("Component-link preview updated.");
    } catch (error) {
      report(error, "The component link preview could not be prepared.");
    }
  }

  async function createComponentRecord() {
    const parsed = createProductComponentLinkInputSchema.safeParse({
      ...componentInput(),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the component link.",
      );
    try {
      await createComponent.mutateAsync(parsed.data);
      setMessage("Component link recorded.");
    } catch (error) {
      report(error, "The component link could not be recorded.");
    }
  }

  async function updateComponentRecord() {
    const link = components.find((item) => item.id === selectedComponentId);
    if (!link) return setMessage("Select an active component link to update.");
    const parsed = supersedeProductComponentLinkInputSchema.safeParse({
      ...componentInput(),
      expectedVersion: link.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ??
          "Check the replacement component link.",
      );
    try {
      await supersedeComponent.mutateAsync({
        relationshipId: link.id,
        input: parsed.data,
      });
      setMessage("Component link superseded.");
    } catch (error) {
      report(error, "The component link could not be superseded.");
    }
  }

  async function endComponentRecord() {
    const link = components.find((item) => item.id === selectedComponentId);
    if (!link) return setMessage("Select an active component link.");
    const parsed = endProductComponentLinkInputSchema.safeParse({
      expectedVersion: link.version,
      expectedGraphVersion: graphVersion,
      reason,
      effectiveEndsAt: evidence.effectiveEndsAt,
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ??
          "Check the component link end request.",
      );
    try {
      await endComponent.mutateAsync({
        relationshipId: link.id,
        input: parsed.data,
      });
      setMessage("Component link ended.");
    } catch (error) {
      report(error, "The component link could not be ended.");
    }
  }

  async function requestReevaluationRecord() {
    const parsed = requestRelationshipReevaluationInputSchema.safeParse({
      expectedGraphVersion: graphVersion,
      reason,
      source,
      provenance,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message ?? "Check the re-evaluation request.",
      );
    try {
      await requestReevaluation.mutateAsync(parsed.data);
      setMessage("Relationship re-evaluation queued.");
    } catch (error) {
      report(error, "The relationship re-evaluation could not be queued.");
    }
  }

  return (
    <section
      aria-label="Relationship commands"
      className="grid gap-4 border-t border-border pt-5"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-subhead-semibold text-fg">Record a change</h3>
        <p className="text-caption-1-regular text-fg-muted">
          Times display in {organizationTimezone ?? "UTC"} and submit as UTC.
        </p>
      </header>
      <section
        aria-label="Relationship evidence"
        className="rounded-xl border border-border bg-surface-subtle p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-caption-1-semibold text-fg">
            Evidence for this change
          </h4>
          <p className="text-caption-1-regular text-fg-muted">
            Set the source, evidence, and effective interval once.
          </p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProductRelationshipEvidenceInputs
            source={source}
            provenance={provenance}
            reason={reason}
            startsAt={startsAt}
            endsAt={endsAt}
            onSource={setSource}
            onProvenance={setProvenance}
            onReason={setReason}
            onStartsAt={setStartsAt}
            onEndsAt={setEndsAt}
          />
        </div>
      </section>
      <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <section className="grid min-w-0 content-start gap-3 rounded-xl border border-border bg-canvas p-4">
          <h4 className="text-subhead-semibold text-fg">Software baseline</h4>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Baseline identifier
            <input
              aria-label="Baseline identifier"
              required
              value={baselineIdentifier}
              onChange={(event) => setBaselineIdentifier(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            />
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Baseline name
            <input
              aria-label="Baseline name"
              required
              value={baselineName}
              onChange={(event) => setBaselineName(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            />
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Revision summary
            <input
              aria-label="Baseline revision summary"
              required
              value={baselineSummary}
              onChange={(event) => setBaselineSummary(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            />
          </label>
          <Button
            type="button"
            loading={createBaseline.isPending}
            loadingLabel="Recording software baseline"
            onClick={() => void createBaselineRecord()}
          >
            Record software baseline
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={baselineId === ""}
              loading={appendBaseline.isPending}
              loadingLabel="Recording baseline revision"
              onClick={() => void appendBaselineRevision()}
            >
              Record baseline revision
            </Button>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={baselineId === ""}
              loading={archiveBaseline.isPending}
              loadingLabel="Archiving software baseline"
              onClick={() => void archiveBaselineRecord()}
            >
              Archive software baseline
            </Button>
          </div>
        </section>
        <section className="grid min-w-0 content-start gap-3 rounded-xl border border-border bg-canvas p-4">
          <h4 className="text-subhead-semibold text-fg">Assign baseline</h4>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Release
            <select
              aria-label="Relationship release"
              value={selectedReleaseId}
              onChange={(event) => setSelectedReleaseId(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="">Select release</option>
              {releases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.label} {release.version}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Search software baselines
            <input
              aria-label="Search software baselines"
              autoComplete="off"
              value={baselineSearch}
              onChange={(event) => {
                setBaselineSearch(event.target.value);
                setBaselineCursor(undefined);
              }}
              placeholder="Type a baseline name or identifier"
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            />
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Software baseline
            <select
              aria-label="Software baseline"
              value={baselineRevisionId}
              disabled={
                baselineSearch.trim().length === 0 || baselines.isPending
              }
              onChange={(event) => {
                const baseline = baselines.data?.baselines.items.find(
                  (item) => item.id === event.target.value,
                );
                if (baseline) selectBaseline(baseline);
              }}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg disabled:cursor-not-allowed disabled:text-fg-muted"
            >
              <option value="">
                {baselines.isPending
                  ? "Searching baselines…"
                  : "Select baseline"}
              </option>
              {baselineRevisionId !== "" &&
              !baselines.data?.baselines.items.some(
                (baseline) => baseline.id === baselineRevisionId,
              ) ? (
                <option value={baselineRevisionId}>
                  {selectedBaselineLabel}
                </option>
              ) : null}
              {baselines.data?.baselines.items.map((baseline) => (
                <option key={baseline.id} value={baseline.id}>
                  {baseline.name} · {baseline.identifier} · revision{" "}
                  {baseline.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Baseline revision
            <select
              aria-label="Baseline revision"
              value={baselineRevisionId}
              disabled={baselineId === "" || baselineRevisions.isPending}
              onChange={(event) => {
                const baseline = baselineRevisions.data?.baselines.find(
                  (item) => item.id === event.target.value,
                );
                if (baseline) selectBaseline(baseline);
              }}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg disabled:cursor-not-allowed disabled:text-fg-muted"
            >
              <option value="">
                {baselineRevisions.isPending
                  ? "Loading revisions…"
                  : "Select revision"}
              </option>
              {baselineRevisions.data?.baselines.map((baseline) => (
                <option key={baseline.id} value={baseline.id}>
                  Revision {baseline.revisionNumber} · version{" "}
                  {baseline.version}
                </option>
              ))}
            </select>
          </label>
          {baselines.isError ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              Software baseline search is unavailable. Try again.
            </p>
          ) : null}
          {!baselines.isPending &&
          !baselines.isError &&
          baselineSearch.trim().length > 0 &&
          (baselines.data?.baselines.items.length ?? 0) === 0 ? (
            <p className="text-caption-1-regular text-fg-muted">
              No software baselines match this search.
            </p>
          ) : null}
          {baselines.data?.baselines.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() =>
                setBaselineCursor(
                  baselines.data?.baselines.nextCursor ?? undefined,
                )
              }
            >
              More matching baselines
            </Button>
          ) : null}
          <Button
            type="button"
            loading={assignMembership.isPending}
            loadingLabel="Recording baseline membership"
            onClick={() => void assignMembershipRecord()}
          >
            Record baseline membership
          </Button>
        </section>
        <section className="grid min-w-0 content-start gap-3 rounded-xl border border-border bg-canvas p-4">
          <h4 className="text-subhead-semibold text-fg">
            Variant relationship
          </h4>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Variant source
            <select
              aria-label="Variant source"
              value={variantSourceType}
              onChange={(event) =>
                setVariantSourceType(
                  event.target.value === "baseline_revision"
                    ? "baseline_revision"
                    : "base_release",
                )
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            >
              <option value="base_release">Base release</option>
              <option value="baseline_revision">Baseline revision</option>
            </select>
          </label>
          <ProductSearchSelect
            label="Variant product"
            searchLabel="Search variant product"
            search={variantProductSearch}
            selectedId={variantProductId}
            selectedLabel={variantProductName}
            excludedProductId={productId}
            onSearchChange={setVariantProductSearch}
            onSelectionChange={selectVariantProduct}
          />
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Variant release
            <select
              aria-label="Variant release"
              value={variantReleaseId}
              disabled={variantProductId === "" || variantReleases.isPending}
              onChange={(event) => setVariantReleaseId(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg disabled:cursor-not-allowed disabled:text-fg-muted"
            >
              <option value="">
                {variantReleases.isPending
                  ? "Loading releases…"
                  : "Select release"}
              </option>
              {variantReleases.data?.releases.rows.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.label} · {release.version}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            loading={createVariant.isPending}
            loadingLabel="Recording variant relationship"
            onClick={() => void createVariantRecord()}
          >
            Record variant relationship
          </Button>
        </section>
      </div>
      <section className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h4 className="text-subhead-semibold text-fg">
              Embedded component
            </h4>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              Preview the graph impact before recording or replacing a link.
            </p>
          </div>
          <span className="text-caption-1-regular text-fg-muted">
            Graph v{graphVersion}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <ProductSearchSelect
            label="Component product"
            searchLabel="Search component product"
            search={componentProductSearch}
            selectedId={componentProductId}
            selectedLabel={componentProductName}
            excludedProductId={productId}
            onSearchChange={setComponentProductSearch}
            onSelectionChange={selectComponentProduct}
          />
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Component release <span className="text-fg-muted">(optional)</span>
            <select
              aria-label="Component release"
              value={componentReleaseId}
              disabled={
                componentProductId === "" || componentReleases.isPending
              }
              onChange={(event) => setComponentReleaseId(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg disabled:cursor-not-allowed disabled:text-fg-muted"
            >
              <option value="">
                {componentReleases.isPending
                  ? "Loading releases…"
                  : "All product releases"}
              </option>
              {componentReleases.data?.releases.rows.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.label} · {release.version}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Quantity
            <input
              aria-label="Component quantity"
              required
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            />
          </label>
        </div>
        {previewComponent.data?.preview ? (
          <p className="text-caption-1-regular text-fg-muted">
            Preview:{" "}
            {previewComponent.data.preview.outcome.replaceAll("_", " ")} ·
            candidate depth {previewComponent.data.preview.candidateDepth}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            tone="grey"
            loading={previewComponent.isPending}
            loadingLabel="Previewing component link"
            onClick={() => void previewComponentRecord()}
          >
            Preview component link
          </Button>
          <Button
            type="button"
            loading={createComponent.isPending}
            loadingLabel="Recording component link"
            onClick={() => void createComponentRecord()}
          >
            Record component link
          </Button>
        </div>
      </section>
      <ProductRelationshipLifecycleControls
        memberships={memberships}
        variants={variants}
        components={components}
        selectedMembershipId={selectedMembershipId}
        selectedVariantId={selectedVariantId}
        selectedComponentId={selectedComponentId}
        effectiveEndsAt={endsAt}
        hasEndEvidence={hasEndEvidence}
        hasUpdateEvidence={hasUpdateEvidence}
        hasReevaluationEvidence={hasSharedEvidence}
        endMembershipPending={endMembership.isPending}
        endVariantPending={endVariant.isPending}
        endComponentPending={endComponent.isPending}
        updateComponentPending={supersedeComponent.isPending}
        reevaluationPending={requestReevaluation.isPending}
        onSelectedMembershipChange={setSelectedMembershipId}
        onSelectedVariantChange={setSelectedVariantId}
        onSelectedComponentChange={setSelectedComponentId}
        onEffectiveEndsAtChange={setEndsAt}
        onEndMembership={() => void endMembershipRecord()}
        onEndVariant={() => void endVariantRecord()}
        onEndComponent={() => void endComponentRecord()}
        onUpdateComponent={() => void updateComponentRecord()}
        onRequestReevaluation={() => void requestReevaluationRecord()}
      />
      {message ? (
        <div className="lg:col-span-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            {message}
          </p>
          {reload ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={onReload}
            >
              Reload relationship graph
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
