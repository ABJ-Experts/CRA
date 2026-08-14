"use client";

import {
  ISO_3166_ALPHA_2_CODES,
  iso3166Alpha2CountrySchema,
  type CreateLegalEntityInput,
  type Iso3166Alpha2Country,
  type LegalEntity,
} from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { useState } from "react";

import {
  useCreateLegalEntityMutation,
  useTransitionLegalEntityMutation,
  useUpdateLegalEntityMutation,
} from "../../_features/organizations/organizations.queries";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { ErrorText, messageFor, ReadonlyNotice } from "./organization-administration-ui";

type LegalEntityDraft = Omit<CreateLegalEntityInput, "idempotencyKey">;

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_OPTIONS = ISO_3166_ALPHA_2_CODES.map(
  (value) => [value, countryNames.of(value) ?? value] as const,
);

function blankDraft(): LegalEntityDraft {
  return {
    identifier: "",
    displayName: "",
    legalName: "",
    registeredAddress: {
      addressLine1: "",
      addressLine2: undefined,
      locality: "",
      administrativeArea: undefined,
      postalCode: "",
      country: "GB",
    },
    mainEstablishmentCountry: "GB",
    phone: undefined,
    registrationIdentifier: undefined,
    taxIdentifier: undefined,
    manufacturerContactName: "",
    manufacturerContactEmail: "",
  };
}

function draftFromEntity(entity: LegalEntity): LegalEntityDraft {
  const fallback = blankDraft();
  return {
    identifier: entity.identifier ?? "",
    displayName: entity.displayName,
    legalName: entity.legalName ?? "",
    registeredAddress: entity.registeredAddress ?? fallback.registeredAddress,
    mainEstablishmentCountry:
      entity.mainEstablishmentCountry ?? fallback.mainEstablishmentCountry,
    phone: entity.phone ?? undefined,
    registrationIdentifier: entity.registrationIdentifier ?? undefined,
    taxIdentifier: entity.taxIdentifier ?? undefined,
    manufacturerContactName: entity.manufacturerContactName ?? "",
    manufacturerContactEmail: entity.manufacturerContactEmail ?? "",
  };
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

function countryFromSelect(value: string): Iso3166Alpha2Country {
  return iso3166Alpha2CountrySchema.parse(value);
}

function normalizeDraft(draft: LegalEntityDraft): LegalEntityDraft {
  return {
    ...draft,
    phone: optionalValue(draft.phone),
    registrationIdentifier: optionalValue(draft.registrationIdentifier),
    taxIdentifier: optionalValue(draft.taxIdentifier),
    registeredAddress: {
      ...draft.registeredAddress,
      addressLine2: optionalValue(draft.registeredAddress.addressLine2),
      administrativeArea: optionalValue(
        draft.registeredAddress.administrativeArea,
      ),
    },
  };
}

function labelize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function dependencySummary(entity: LegalEntity): string {
  const count = entity.dependencyProjections.reduce(
    (total, projection) => total + projection.count,
    0,
  );
  return `${count} dependent ${count === 1 ? "record" : "records"}`;
}

function entityLifecycleTarget(entity: LegalEntity): LegalEntity["status"] | null {
  if (entity.status === "active") return "inactive";
  if (entity.status === "inactive" && entity.completionStatus === "complete") {
    return "active";
  }
  return null;
}

function lifecycleLabel(entity: LegalEntity): string | null {
  const target = entityLifecycleTarget(entity);
  if (target === "inactive") return `Deactivate ${entity.displayName}`;
  if (target === "active") return `Activate ${entity.displayName}`;
  return null;
}

export function OrganizationLegalEntitiesSection({
  legalEntities,
  canManage,
  onRefresh,
}: {
  legalEntities: readonly LegalEntity[];
  canManage: boolean;
  onRefresh: () => void;
}) {
  const createLegalEntity = useCreateLegalEntityMutation();
  const updateLegalEntity = useUpdateLegalEntityMutation();
  const transitionLegalEntity = useTransitionLegalEntityMutation();
  const [draft, setDraft] = useState<LegalEntityDraft>(() => blankDraft());
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const editingEntity =
    editingEntityId === null
      ? null
      : (legalEntities.find((entity) => entity.id === editingEntityId) ?? null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    try {
      const normalized = normalizeDraft(draft);
      if (editingEntity !== null) {
        await updateLegalEntity.mutateAsync({
          legalEntityId: editingEntity.id,
          input: {
            ...normalized,
            expectedVersion: editingEntity.version,
          },
        });
        setMessage("Legal entity saved.");
      } else {
        await createLegalEntity.mutateAsync({
          ...normalized,
          idempotencyKey: crypto.randomUUID(),
        });
        setMessage("Legal entity created.");
      }
      setDraft(blankDraft());
      setEditingEntityId(null);
      onRefresh();
    } catch (error) {
      setMessage(messageFor(error, "Legal entity could not be saved."));
    }
  }

  async function transition(
    entity: LegalEntity,
    status: LegalEntity["status"] | null,
  ) {
    if (status === null) return;
    setMessage(null);
    try {
      await transitionLegalEntity.mutateAsync({
        legalEntityId: entity.id,
        input: { expectedVersion: entity.version, status },
      });
      setMessage("Legal entity updated.");
      onRefresh();
    } catch (error) {
      setMessage(messageFor(error, "Legal entity status could not be changed."));
    }
  }

  function editEntity(entity: LegalEntity) {
    setDraft(draftFromEntity(entity));
    setEditingEntityId(entity.id);
    setMessage(null);
  }

  function cancelEdit() {
    setDraft(blankDraft());
    setEditingEntityId(null);
    setMessage(null);
  }

  return (
    <SectionCard title="Legal entities">
      <div className="flex flex-col gap-5">
        {!canManage ? (
          <ReadonlyNotice>
            You can inspect legal entities, but only organization owners with
            edit permission can change them.
          </ReadonlyNotice>
        ) : null}
        <div className="divide-y divide-border">
          {legalEntities.map((entity) => (
            <div key={entity.id} className="flex flex-col gap-3 py-4 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-subhead-semibold text-fg">
                    {entity.displayName}
                  </p>
                  <p className="text-caption-1-regular text-fg-muted">
                    {entity.completionStatus === "complete"
                      ? entity.legalName
                      : "Legal profile completion required"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-border px-3 py-1 text-caption-1-regular text-fg-muted">
                    {labelize(entity.status)}
                  </span>
                  <span className="rounded-full border border-border px-3 py-1 text-caption-1-regular text-fg-muted">
                    {labelize(entity.completionStatus)}
                  </span>
                </div>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-caption-1-regular text-fg-muted">
                    Identifier
                  </dt>
                  <dd className="text-subhead-regular text-fg">
                    {entity.identifier ?? "Not assigned"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption-1-regular text-fg-muted">
                    Main establishment
                  </dt>
                  <dd className="text-subhead-regular text-fg">
                    {entity.mainEstablishmentCountry ?? "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption-1-regular text-fg-muted">Phone</dt>
                  <dd className="text-subhead-regular text-fg">
                    {entity.phone ?? "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption-1-regular text-fg-muted">
                    Dependencies
                  </dt>
                  <dd className="text-subhead-regular text-fg">
                    {dependencySummary(entity)}
                  </dd>
                </div>
              </dl>
              {canManage ? (
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => editEntity(entity)}
                  >
                    Edit {entity.displayName}
                  </Button>
                  {lifecycleLabel(entity) ? (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() =>
                        void transition(entity, entityLifecycleTarget(entity))
                      }
                      loading={transitionLegalEntity.isPending}
                      loadingLabel="Updating legal entity"
                    >
                      {lifecycleLabel(entity)}
                    </Button>
                  ) : (
                    <p className="text-caption-1-regular text-fg-muted">
                      Complete this entity before activation.
                    </p>
                  )}
                  {entity.status !== "deleted" ? (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() => void transition(entity, "deleted")}
                      loading={transitionLegalEntity.isPending}
                      loadingLabel="Deleting legal entity"
                    >
                      Delete {entity.displayName}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {canManage ? (
          <form
            className="flex flex-col gap-4 border-t border-border pt-5"
            onSubmit={submit}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Entity identifier
                <input
                  value={draft.identifier}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      identifier: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Display name
                <input
                  value={draft.displayName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Legal name
                <input
                  value={draft.legalName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      legalName: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Main establishment country
                <select
                  value={draft.mainEstablishmentCountry}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      mainEstablishmentCountry: countryFromSelect(
                        event.target.value,
                      ),
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                >
                  {COUNTRY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Manufacturer contact name
                <input
                  value={draft.manufacturerContactName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      manufacturerContactName: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Manufacturer contact email
                <input
                  type="email"
                  value={draft.manufacturerContactEmail}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      manufacturerContactEmail: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Phone
                <input
                  value={draft.phone ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  placeholder="+442079460000"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Registration identifier
                <input
                  value={draft.registrationIdentifier ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registrationIdentifier: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Tax identifier
                <input
                  value={draft.taxIdentifier ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      taxIdentifier: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Address line 1
                <input
                  value={draft.registeredAddress.addressLine1}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registeredAddress: {
                        ...current.registeredAddress,
                        addressLine1: event.target.value,
                      },
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Address line 2
                <input
                  value={draft.registeredAddress.addressLine2 ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registeredAddress: {
                        ...current.registeredAddress,
                        addressLine2: event.target.value,
                      },
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Locality
                <input
                  value={draft.registeredAddress.locality}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registeredAddress: {
                        ...current.registeredAddress,
                        locality: event.target.value,
                      },
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                State, province, or region
                <input
                  value={draft.registeredAddress.administrativeArea ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registeredAddress: {
                        ...current.registeredAddress,
                        administrativeArea: event.target.value,
                      },
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Postal code
                <input
                  value={draft.registeredAddress.postalCode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registeredAddress: {
                        ...current.registeredAddress,
                        postalCode: event.target.value,
                      },
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Registered address country
                <select
                  value={draft.registeredAddress.country}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      registeredAddress: {
                        ...current.registeredAddress,
                        country: countryFromSelect(event.target.value),
                      },
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                >
                  {COUNTRY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ErrorText>{message}</ErrorText>
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                loading={createLegalEntity.isPending || updateLegalEntity.isPending}
                loadingLabel={
                  editingEntity === null
                    ? "Creating legal entity"
                    : "Saving legal entity"
                }
              >
                {editingEntity === null ? "Create legal entity" : "Save legal entity"}
              </Button>
              {editingEntity !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={cancelEdit}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </SectionCard>
  );
}
