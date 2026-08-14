"use client";

import {
  type MfaRolloutReadiness,
  type OrganizationSettingsCatalog,
  type OrganizationSettingsValues,
  type RetentionPolicy,
} from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { useState } from "react";

import {
  useUpdateOrganizationSettingsMutation,
  useUpdateRetentionMutation,
} from "../../_features/organizations/organizations.queries";
import {
  ConflictNotice,
  ErrorText,
  isConflict,
  messageFor,
  ReadonlyNotice,
} from "./organization-administration-ui";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

const WORKING_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type WorkingDay = OrganizationSettingsValues["workingDays"][number];
type SettingsDraft = OrganizationSettingsValues;

function labelize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function toggleValue<T extends string>(
  values: readonly T[],
  value: T,
): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function toDraft(values: OrganizationSettingsValues | null): SettingsDraft {
  return values ?? {
    timezone: "",
    workingDays: [],
    holidays: [],
    notificationChannelIds: [],
    mfaEnforcementDate: null,
    maximumSessionAgeMinutes: 0,
    aiProviderId: "",
    dataResidencyId: "",
  };
}

function listDraft(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function OrganizationSettingsSection({
  catalog,
  values,
  version,
  readiness,
  canEdit,
  onRefresh,
}: {
  catalog: OrganizationSettingsCatalog;
  values: OrganizationSettingsValues | null;
  version: number;
  readiness: MfaRolloutReadiness;
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const updateSettings = useUpdateOrganizationSettingsMutation();
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(values));
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const canSetMfaDate = readiness.safeToEnforce;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConflicted(false);

    if (draft.mfaEnforcementDate !== null && !canSetMfaDate) {
      setError(
        "MFA enforcement cannot be scheduled until every member has enrolled.",
      );
      return;
    }

    try {
      await updateSettings.mutateAsync({ expectedVersion: version, values: draft });
    } catch (submitError) {
      setConflicted(isConflict(submitError));
      setError(
        messageFor(
          submitError,
          "Settings could not be saved. Check the entered values and try again.",
        ),
      );
    }
  }

  return (
    <SectionCard
      title="Settings"
      action={
        values ? (
          <span className="text-caption-1-regular text-fg-muted">
            Version {version}
          </span>
        ) : (
          <span className="text-caption-1-regular text-warning">
            Unconfigured
          </span>
        )
      }
    >
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        {!canEdit ? (
          <ReadonlyNotice>
            You can inspect organization settings, but you do not have
            permission to change them.
          </ReadonlyNotice>
        ) : null}
        {!values ? (
          <p className="text-caption-1-regular text-fg-muted">
            Settings are unconfigured. Choose every required value from the
            server-provided catalog; no browser or deployment default is used.
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            IANA timezone
            <select
              value={draft.timezone}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
              disabled={!canEdit || updateSettings.isPending}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              required
            >
              <option value="">Select timezone</option>
              {catalog.timezones.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </label>
          <Input
            type="number"
            min={catalog.minimumSessionAgeMinutes}
            max={catalog.maximumSessionAgeMinutes}
            value={draft.maximumSessionAgeMinutes || ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maximumSessionAgeMinutes: Number(event.target.value),
              }))
            }
            disabled={!canEdit || updateSettings.isPending}
            label="Maximum session age minutes"
            required
          />
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            AI provider
            <select
              value={draft.aiProviderId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  aiProviderId: event.target.value,
                }))
              }
              disabled={!canEdit || updateSettings.isPending}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              required
            >
              <option value="">Select provider</option>
              {catalog.aiProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {labelize(provider)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Data residency indicator
            <select
              value={draft.dataResidencyId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  dataResidencyId: event.target.value,
                }))
              }
              disabled={!canEdit || updateSettings.isPending}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
              required
            >
              <option value="">Select residency</option>
              {catalog.dataResidencies.map((residency) => (
                <option key={residency} value={residency}>
                  {labelize(residency)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-caption-1-regular text-fg">
            Working days
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKING_DAYS.map((day) => (
              <Checkbox
                key={day}
                checked={draft.workingDays.includes(day)}
                onCheckedChange={() =>
                  setDraft((current) => ({
                    ...current,
                    workingDays: toggleValue(current.workingDays, day) as WorkingDay[],
                  }))
                }
                disabled={!canEdit || updateSettings.isPending}
                label={labelize(day)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-caption-1-regular text-fg">
            Default notification channels
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.notificationChannels.map((channel) => (
              <Checkbox
                key={channel}
                checked={draft.notificationChannelIds.includes(channel)}
                onCheckedChange={() =>
                  setDraft((current) => ({
                    ...current,
                    notificationChannelIds: toggleValue(
                      current.notificationChannelIds,
                      channel,
                    ),
                  }))
                }
                disabled={!canEdit || updateSettings.isPending}
                label={labelize(channel)}
              />
            ))}
          </div>
        </fieldset>
        <Input
          value={draft.holidays.join(", ")}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              holidays: listDraft(event.target.value),
            }))
          }
          disabled={!canEdit || updateSettings.isPending}
          label="Organization holidays"
          helperText="Use comma-separated ISO dates, such as 2026-12-25."
          placeholder="2026-12-25, 2027-01-01"
        />
        <Input
          type="date"
          value={draft.mfaEnforcementDate ?? ""}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              mfaEnforcementDate: event.target.value || null,
            }))
          }
          disabled={!canEdit || updateSettings.isPending || !canSetMfaDate}
          label="MFA enforcement date"
          helperText={
            canSetMfaDate
              ? "Choose a future rollout date after every member has enrolled."
              : "MFA enforcement is unavailable until every member has enrolled."
          }
        />
        <p className="text-caption-1-regular text-fg-muted">
          MFA readiness: {readiness.enrolledMemberCount} enrolled, {" "}
          {readiness.unenrolledMemberCount} not enrolled. Session policy
          tightening invalidates affected tenant sessions immediately.
        </p>
        <ErrorText>{error}</ErrorText>
        {conflicted ? (
          <ConflictNotice label="Settings" onRefresh={onRefresh} />
        ) : null}
        {canEdit ? (
          <Button type="submit" loading={updateSettings.isPending}>
            Save settings
          </Button>
        ) : null}
      </form>
    </SectionCard>
  );
}

export function OrganizationRetentionSection({
  policies,
  canEdit,
  onRefresh,
}: {
  policies: readonly RetentionPolicy[];
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const updateRetention = useUpdateRetentionMutation();
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);

  async function save(policy: RetentionPolicy, value: string) {
    setError(null);
    setConflicted(false);
    try {
      await updateRetention.mutateAsync({
        expectedVersion: policy.version,
        evidenceClass: policy.evidenceClass,
        requestedRetentionDays: Number(value),
      });
    } catch (submitError) {
      setConflicted(isConflict(submitError));
      setError(messageFor(submitError, "Retention policy could not be saved."));
    }
  }

  return (
    <SectionCard title="Evidence retention">
      <div className="flex flex-col gap-4">
        {!canEdit ? (
          <ReadonlyNotice>
            You can inspect retention floors, but cannot change retention
            policy.
          </ReadonlyNotice>
        ) : null}
        {policies.length === 0 ? (
          <p className="text-subhead-regular text-fg-muted">
            No evidence retention policies are available yet.
          </p>
        ) : null}
        <ErrorText>{error}</ErrorText>
        {conflicted ? (
          <ConflictNotice label="Retention policies" onRefresh={onRefresh} />
        ) : null}
        {policies.map((policy) => (
          <form
            key={policy.id}
            className="grid gap-3 rounded-xl bg-surface-subtle p-4 lg:grid-cols-[1fr_180px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                policy,
                String(new FormData(event.currentTarget).get("days") ?? ""),
              );
            }}
          >
            <div>
              <p className="text-subhead-semibold text-fg">
                {labelize(policy.evidenceClass)}
              </p>
              <p className="text-caption-1-regular text-fg-muted">
                Effective: {policy.effectiveRetentionDays} days. Legal floor: {" "}
                {policy.effectiveFloorDays} days.
              </p>
              {policy.controllingReasons.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-caption-1-regular text-fg-muted">
                  {policy.controllingReasons.map((reason) => (
                    <li key={`${reason.kind}-${reason.recordId}`}>
                      {labelize(reason.kind)} requires {" "}
                      {reason.requiredRetentionDays} days.
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Input
              name="days"
              type="number"
              min={policy.effectiveFloorDays}
              defaultValue={policy.requestedRetentionDays}
              disabled={!canEdit || updateRetention.isPending}
              label="Requested days"
              required
            />
            {canEdit ? (
              <Button
                type="submit"
                className="lg:self-end"
                loading={updateRetention.isPending}
              >
                Save retention
              </Button>
            ) : null}
          </form>
        ))}
      </div>
    </SectionCard>
  );
}
