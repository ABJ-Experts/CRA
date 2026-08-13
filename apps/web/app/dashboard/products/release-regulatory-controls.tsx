"use client";

import {
  addReleaseMarketAvailabilityInputSchema,
  correctPlacedOnMarketDateInputSchema,
  correctReleaseMarketAvailabilityInputSchema,
  removeReleaseMarketAvailabilityInputSchema,
  transitionReleaseLifecycleInputSchema,
  type Release,
  type ReleaseLifecycleState,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { useEffect, useState } from "react";

import {
  useAddReleaseMarketAvailabilityMutation,
  useCorrectPlacedOnMarketDateMutation,
  useCorrectReleaseMarketAvailabilityMutation,
  useMemberStatesQuery,
  useReleaseLifecycleTimelineQuery,
  useReleaseMarketAvailabilityQuery,
  useRemoveReleaseMarketAvailabilityMutation,
  useTransitionReleaseLifecycleMutation,
} from "../../_features/products/products.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SupportPeriodRetentionSection } from "./support-period-retention-section";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 404)
    return "This product is unavailable.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (
    error instanceof ApiClientError &&
    error.code === "placement_requires_active_market_availability"
  )
    return "Add at least one active Member State before placing the release on the market.";
  if (
    error instanceof ApiClientError &&
    error.code === "placement_requires_placed_on_market_at"
  )
    return "Provide a UTC placed-on-market timestamp before placing the release on the market.";
  if (error instanceof ApiClientError && error.code === "invalid_transition")
    return "This lifecycle transition is not permitted.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This record changed in another session. Refresh it before trying again.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  )
    return "The registry is temporarily unavailable. Try again.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  return fallback;
}

function isStaleUpdate(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "conflict";
}

const LIFECYCLE_TARGETS = Object.freeze({
  development: ["placed_on_market", "withdrawn"],
  placed_on_market: ["in_support", "withdrawn"],
  in_support: ["end_of_support", "withdrawn"],
  end_of_support: ["withdrawn"],
  withdrawn: [],
} as const satisfies Record<
  ReleaseLifecycleState,
  readonly ReleaseLifecycleState[]
>);

function lifecycleLabel(state: ReleaseLifecycleState): string {
  return state.replaceAll("_", " ");
}

export function ReleaseRegulatoryControls({
  productId,
  release,
  canEdit,
  canCorrectPlacedDate,
  enabled,
  onReload,
}: {
  productId: string;
  release: Release;
  canEdit: boolean;
  canCorrectPlacedDate: boolean;
  enabled: boolean;
  onReload: () => void;
}) {
  const memberStates = useMemberStatesQuery(enabled);
  const availability = useReleaseMarketAvailabilityQuery(
    productId,
    release.id,
    enabled,
  );
  const timeline = useReleaseLifecycleTimelineQuery(
    productId,
    release.id,
    enabled,
  );
  const addAvailability = useAddReleaseMarketAvailabilityMutation(
    productId,
    release.id,
  );
  const removeAvailability = useRemoveReleaseMarketAvailabilityMutation(
    productId,
    release.id,
  );
  const correctAvailability = useCorrectReleaseMarketAvailabilityMutation(
    productId,
    release.id,
  );
  const transition = useTransitionReleaseLifecycleMutation(
    productId,
    release.id,
  );
  const correctPlacedDate = useCorrectPlacedOnMarketDateMutation(
    productId,
    release.id,
  );
  const [countryCode, setCountryCode] = useState("");
  const [marketReason, setMarketReason] = useState("");
  const [fromCountryCode, setFromCountryCode] = useState("");
  const [toCountryCode, setToCountryCode] = useState("");
  const [targetState, setTargetState] = useState<ReleaseLifecycleState>(
    LIFECYCLE_TARGETS[release.lifecycle][0] ?? "withdrawn",
  );
  const [placedOnMarketAt, setPlacedOnMarketAt] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [correctedPlacedOnMarketAt, setCorrectedPlacedOnMarketAt] = useState(
    release.placedOnMarketAt ?? "",
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);
  const activeAvailability =
    availability.data?.marketAvailability.filter((item) => item.active) ?? [];
  const targets = LIFECYCLE_TARGETS[release.lifecycle];
  const postMarket = release.placedOnMarketAt !== null;

  useEffect(() => {
    setTargetState(LIFECYCLE_TARGETS[release.lifecycle][0] ?? "withdrawn");
    setPlacedOnMarketAt("");
    setCorrectedPlacedOnMarketAt(release.placedOnMarketAt ?? "");
  }, [release.lifecycle, release.placedOnMarketAt]);

  async function addMarket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const parsed = addReleaseMarketAvailabilityInputSchema.safeParse({
      countryCode,
      expectedVersion: release.versionNumber,
      reason: postMarket ? marketReason : undefined,
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Choose a Member State.");
      return;
    }
    try {
      await addAvailability.mutateAsync(parsed.data);
      setCountryCode("");
      setMarketReason("");
      setMessage("Member State availability recorded.");
    } catch (error) {
      setStaleUpdate(isStaleUpdate(error));
      setMessage(errorMessage(error, "Availability could not be recorded."));
    }
  }

  async function removeMarket(country: string) {
    setMessage(null);
    setStaleUpdate(false);
    const parsed = removeReleaseMarketAvailabilityInputSchema.safeParse({
      expectedVersion: release.versionNumber,
      reason: postMarket ? marketReason : undefined,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Provide a reason before removal.",
      );
      return;
    }
    try {
      await removeAvailability.mutateAsync({
        countryCode: country,
        input: parsed.data,
      });
      setMarketReason("");
      setMessage("Member State availability removed.");
    } catch (error) {
      setStaleUpdate(isStaleUpdate(error));
      setMessage(errorMessage(error, "Availability could not be removed."));
    }
  }

  async function correctMarket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const parsed = correctReleaseMarketAvailabilityInputSchema.safeParse({
      fromCountryCode,
      toCountryCode,
      expectedVersion: release.versionNumber,
      reason: postMarket ? marketReason : undefined,
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Check the correction.");
      return;
    }
    try {
      await correctAvailability.mutateAsync(parsed.data);
      setFromCountryCode("");
      setToCountryCode("");
      setMarketReason("");
      setMessage("Member State availability corrected.");
    } catch (error) {
      setStaleUpdate(isStaleUpdate(error));
      setMessage(errorMessage(error, "Availability could not be corrected."));
    }
  }

  async function transitionLifecycle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const parsed = transitionReleaseLifecycleInputSchema.safeParse({
      targetState,
      expectedVersion: release.versionNumber,
      placedOnMarketAt:
        targetState === "placed_on_market" ? placedOnMarketAt : undefined,
      reason: targetState === "withdrawn" ? lifecycleReason : undefined,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the lifecycle transition.",
      );
      return;
    }
    try {
      await transition.mutateAsync(parsed.data);
      setMessage("Lifecycle transition recorded.");
    } catch (error) {
      setStaleUpdate(isStaleUpdate(error));
      setMessage(errorMessage(error, "The lifecycle transition was blocked."));
    }
  }

  async function correctDate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setStaleUpdate(false);
    const parsed = correctPlacedOnMarketDateInputSchema.safeParse({
      correctedPlacedOnMarketAt,
      expectedVersion: release.versionNumber,
      reason: correctionReason,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the date correction.",
      );
      return;
    }
    try {
      await correctPlacedDate.mutateAsync(parsed.data);
      setCorrectionReason("");
      setMessage("Placed-on-market date correction recorded.");
    } catch (error) {
      setStaleUpdate(isStaleUpdate(error));
      setMessage(errorMessage(error, "The date could not be corrected."));
    }
  }

  return (
    <div className="mt-4 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
      <section aria-label={`Market availability for ${release.label}`}>
        <h3 className="text-subhead-semibold text-fg">Market availability</h3>
        {availability.isPending ? (
          <p
            role="status"
            className="mt-2 text-caption-1-regular text-fg-muted"
          >
            Loading Member State availability…
          </p>
        ) : availability.isError ? (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-caption-1-regular text-danger">
              {errorMessage(
                availability.error,
                "Availability could not be loaded.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void availability.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : activeAvailability.length === 0 ? (
          <p role="alert" className="mt-2 text-caption-1-regular text-danger">
            No Member State availability has been recorded.
          </p>
        ) : (
          <ul
            className="mt-2 flex flex-wrap gap-2"
            aria-label="Available Member States"
          >
            {activeAvailability.map((item) => (
              <li
                key={item.countryCode}
                className="rounded-lg border border-border px-2 py-1 text-caption-1-regular text-fg"
              >
                {item.memberStateName} ({item.countryCode})
                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    className="ml-2"
                    loading={removeAvailability.isPending}
                    loadingLabel="Removing Member State"
                    onClick={() => void removeMarket(item.countryCode)}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && postMarket ? (
          <label className="mt-3 block text-caption-1-regular text-fg">
            Market change reason
            <input
              aria-label="Market change reason"
              value={marketReason}
              onChange={(event) => setMarketReason(event.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
            />
          </label>
        ) : null}
        {canEdit ? (
          <>
            {memberStates.isPending ? (
              <p
                role="status"
                className="mt-3 text-caption-1-regular text-fg-muted"
              >
                Loading Member States…
              </p>
            ) : memberStates.isError ? (
              <div
                role="alert"
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <p className="text-caption-1-regular text-danger">
                  {errorMessage(
                    memberStates.error,
                    "Member States could not be loaded.",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void memberStates.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <form
                className="mt-3 grid gap-2"
                noValidate
                onSubmit={(event) => void addMarket(event)}
              >
                <label className="text-caption-1-regular text-fg">
                  Add Member State
                  <select
                    aria-label="Add Member State"
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                  >
                    <option value="">Select a Member State</option>
                    {memberStates.data?.memberStates
                      .filter(
                        (state) =>
                          state.active &&
                          !activeAvailability.some(
                            (item) => item.countryCode === state.countryCode,
                          ),
                      )
                      .map((state) => (
                        <option
                          key={state.countryCode}
                          value={state.countryCode}
                        >
                          {state.name}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  type="submit"
                  loading={addAvailability.isPending}
                  loadingLabel="Adding Member State"
                >
                  Add Member State
                </Button>
              </form>
            )}
            {activeAvailability.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-caption-1-regular text-fg-muted">
                  Correct a Member State
                </summary>
                <form
                  className="mt-2 grid gap-2"
                  noValidate
                  onSubmit={(event) => void correctMarket(event)}
                >
                  <label className="text-caption-1-regular text-fg">
                    Replace
                    <select
                      aria-label="Replace Member State"
                      value={fromCountryCode}
                      onChange={(event) =>
                        setFromCountryCode(event.target.value)
                      }
                      className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                    >
                      <option value="">Select recorded Member State</option>
                      {activeAvailability.map((item) => (
                        <option key={item.countryCode} value={item.countryCode}>
                          {item.memberStateName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-caption-1-regular text-fg">
                    With
                    <select
                      aria-label="Replacement Member State"
                      value={toCountryCode}
                      onChange={(event) => setToCountryCode(event.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                    >
                      <option value="">Select replacement Member State</option>
                      {memberStates.data?.memberStates
                        .filter((state) => state.active)
                        .map((state) => (
                          <option
                            key={state.countryCode}
                            value={state.countryCode}
                          >
                            {state.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button
                    type="submit"
                    loading={correctAvailability.isPending}
                    loadingLabel="Correcting Member State"
                  >
                    Correct availability
                  </Button>
                </form>
              </details>
            ) : null}
          </>
        ) : null}
      </section>
      <section aria-label={`Lifecycle for ${release.label}`}>
        <h3 className="text-subhead-semibold text-fg">Lifecycle</h3>
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          Current state: {lifecycleLabel(release.lifecycle)}
          {release.placedOnMarketAt
            ? ` · placed on market ${release.placedOnMarketAt}`
            : ""}
        </p>
        {canEdit && targets.length > 0 ? (
          <form
            className="mt-3 grid gap-2"
            noValidate
            onSubmit={(event) => void transitionLifecycle(event)}
          >
            <label className="text-caption-1-regular text-fg">
              Transition to
              <select
                aria-label={`Lifecycle target for ${release.label}`}
                value={targetState}
                onChange={(event) =>
                  setTargetState(event.target.value as ReleaseLifecycleState)
                }
                className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
              >
                {targets.map((target) => (
                  <option key={target} value={target}>
                    {lifecycleLabel(target)}
                  </option>
                ))}
              </select>
            </label>
            {targetState === "placed_on_market" ? (
              <label className="text-caption-1-regular text-fg">
                Placed on market at (UTC)
                <input
                  aria-label="Placed on market at (UTC)"
                  placeholder="2026-08-12T10:00:00.000Z"
                  value={placedOnMarketAt}
                  onChange={(event) => setPlacedOnMarketAt(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                />
              </label>
            ) : null}
            {targetState === "withdrawn" ? (
              <label className="text-caption-1-regular text-fg">
                Withdrawal reason
                <input
                  aria-label="Withdrawal reason"
                  value={lifecycleReason}
                  onChange={(event) => setLifecycleReason(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                />
              </label>
            ) : null}
            <Button
              type="submit"
              loading={transition.isPending}
              loadingLabel="Recording lifecycle transition"
            >
              Transition lifecycle
            </Button>
          </form>
        ) : targets.length === 0 ? (
          <p className="mt-3 text-caption-1-regular text-fg-muted">
            This release is withdrawn and has no permitted lifecycle transition.
          </p>
        ) : null}
        {canCorrectPlacedDate && release.placedOnMarketAt ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-caption-1-regular text-fg-muted">
              Correct placed-on-market date
            </summary>
            <form
              className="mt-2 grid gap-2"
              noValidate
              onSubmit={(event) => void correctDate(event)}
            >
              <label className="text-caption-1-regular text-fg">
                Corrected UTC timestamp
                <input
                  aria-label="Corrected UTC timestamp"
                  value={correctedPlacedOnMarketAt}
                  onChange={(event) =>
                    setCorrectedPlacedOnMarketAt(event.target.value)
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                />
              </label>
              <label className="text-caption-1-regular text-fg">
                Correction reason
                <input
                  aria-label="Correction reason"
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                />
              </label>
              <Button
                type="submit"
                loading={correctPlacedDate.isPending}
                loadingLabel="Correcting placed-on-market date"
              >
                Correct date
              </Button>
            </form>
          </details>
        ) : null}
        {timeline.isPending ? (
          <p
            role="status"
            className="mt-3 text-caption-1-regular text-fg-muted"
          >
            Loading lifecycle timeline…
          </p>
        ) : timeline.isError ? (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-caption-1-regular text-danger">
              {errorMessage(
                timeline.error,
                "Lifecycle history could not be loaded.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void timeline.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : timeline.data?.timeline.length === 0 ? (
          <p className="mt-3 text-caption-1-regular text-fg-muted">
            No lifecycle events have been recorded.
          </p>
        ) : (
          <ol
            className="mt-3 space-y-1 text-caption-1-regular text-fg-muted"
            aria-label="Lifecycle timeline"
          >
            {timeline.data?.timeline.map((event) => (
              <li key={event.id}>
                {event.eventType.replaceAll("_", " ")} · {event.occurredAt}
              </li>
            ))}
          </ol>
        )}
      </section>
      {message ? (
        <div className="lg:col-span-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            {message}
          </p>
          {staleUpdate ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={onReload}
            >
              Reload current data
            </Button>
          ) : null}
        </div>
      ) : null}
      <SupportPeriodRetentionSection
        productId={productId}
        release={release}
        canEdit={canEdit}
        enabled={enabled}
        onReload={onReload}
      />
    </div>
  );
}
