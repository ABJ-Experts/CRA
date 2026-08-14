"use client";

import type {
  OrganizationBrandingDraft,
  OrganizationBrandingLogo,
  ResolvedOrganizationBranding,
} from "@repo/contracts";
import { Button } from "@repo/ui/button";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  useBrandingLogoRemoveMutation,
  useBrandingLogoUploadMutation,
  useBrandingPublishMutation,
  useUpdateBrandingDraftMutation,
} from "../../_features/organizations/organizations.queries";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import {
  ErrorText,
  formatOrganizationInstant,
  messageFor,
  ReadonlyNotice,
} from "./organization-administration-ui";

const BRANDING_LOGO_PREVIEW_PATH =
  "/api/v1/organizations/current/branding/logo/preview";

type BrandingDraft = Readonly<{
  displayName: string;
  primary: string;
  secondary: string;
  footerText: string;
  contactText: string;
  altText: string;
}>;

type BrandingStyle = CSSProperties &
  Readonly<{
    "--organization-brand-primary": string;
    "--organization-brand-primary-text": string;
    "--organization-brand-secondary": string;
    "--organization-brand-secondary-text": string;
  }>;

function draftFromPreview(
  branding: ResolvedOrganizationBranding,
): BrandingDraft {
  return {
    displayName: branding.displayName,
    primary: branding.palette.primary,
    secondary: branding.palette.secondary,
    footerText: branding.footerText ?? "",
    contactText: branding.contactText ?? "",
    altText: branding.logo?.altText ?? "",
  };
}

function logoFromDraft(
  draft: OrganizationBrandingDraft,
): OrganizationBrandingLogo | null {
  return draft.logoAsset.status === "approved" ? draft.logoAsset.asset : null;
}

/**
 * The hash is trusted server-approved metadata, not a storage location. It
 * gives the browser a new binary endpoint URL after a draft logo changes while
 * the API keeps selecting the organization-scoped draft asset server-side.
 */
function draftLogoPreviewPath(logo: OrganizationBrandingLogo): string {
  return `${BRANDING_LOGO_PREVIEW_PATH}?v=${logo.sha256}`;
}

function draftFromServerDraft(draft: OrganizationBrandingDraft): BrandingDraft {
  const logo = logoFromDraft(draft);
  return {
    displayName: draft.displayName,
    primary: draft.palette.primary,
    secondary: draft.palette.secondary,
    footerText: draft.footerText ?? "",
    contactText: draft.contactText ?? "",
    altText: logo?.altText ?? "",
  };
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function statusLabel(branding: ResolvedOrganizationBranding): string {
  if (branding.source === "sentinel") return "CRA Sentinel fallback active";
  if (branding.source === "draft_preview") {
    return `Draft preview version ${branding.version}`;
  }
  return `Published version ${branding.version}`;
}

export function OrganizationBrandingSection({
  resolvedBranding,
  draftPreview,
  canManage,
  organizationTimezone,
  onRefresh,
}: {
  resolvedBranding: ResolvedOrganizationBranding;
  draftPreview: ResolvedOrganizationBranding;
  canManage: boolean;
  organizationTimezone: string | null;
  onRefresh: () => void;
}) {
  const updateBranding = useUpdateBrandingDraftMutation();
  const uploadLogo = useBrandingLogoUploadMutation();
  const publishBranding = useBrandingPublishMutation();
  const removeLogo = useBrandingLogoRemoveMutation();
  const [draft, setDraft] = useState<BrandingDraft>(() =>
    draftFromPreview(draftPreview),
  );
  const [draftVersion, setDraftVersion] = useState(draftPreview.version);
  const [draftLogo, setDraftLogo] = useState<OrganizationBrandingLogo | null>(
    draftPreview.logo,
  );
  const [isDraftLogoAvailable, setDraftLogoAvailable] = useState(true);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const brandStyle = useMemo<BrandingStyle>(
    () => ({
      "--organization-brand-primary": resolvedBranding.palette.primary,
      "--organization-brand-primary-text": resolvedBranding.palette.primaryText,
      "--organization-brand-secondary": resolvedBranding.palette.secondary,
      "--organization-brand-secondary-text":
        resolvedBranding.palette.secondaryText,
    }),
    [resolvedBranding.palette],
  );

  useEffect(() => {
    setDraft(draftFromPreview(draftPreview));
    setDraftVersion(draftPreview.version);
    setDraftLogo(draftPreview.logo);
  }, [draftPreview]);

  useEffect(() => {
    setDraftLogoAvailable(true);
  }, [draftLogo?.assetId, draftLogo?.sha256]);

  useEffect(() => {
    if (selectedLogo === null) {
      setPreviewUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedLogo);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedLogo]);

  function applyServerDraft(serverDraft: OrganizationBrandingDraft) {
    setDraft(draftFromServerDraft(serverDraft));
    setDraftVersion(serverDraft.version);
    setDraftLogo(logoFromDraft(serverDraft));
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      const response = await updateBranding.mutateAsync({
        expectedVersion: draftVersion,
        displayName: draft.displayName,
        palette: {
          primary: draft.primary,
          secondary: draft.secondary,
        },
        footerText: optionalText(draft.footerText),
        contactText: optionalText(draft.contactText),
        logoAssetId: draftLogo?.assetId ?? null,
      });
      applyServerDraft(response.draft);
      setMessage("Branding draft saved.");
      onRefresh();
    } catch (error) {
      setMessage(messageFor(error, "Branding draft could not be saved."));
    }
  }

  async function uploadSelectedLogo() {
    if (selectedLogo === null) return;
    setMessage(null);
    try {
      const response = await uploadLogo.mutateAsync({
        fields:
          optionalText(draft.altText) === null
            ? {}
            : { altText: optionalText(draft.altText) ?? undefined },
        file: selectedLogo,
      });
      applyServerDraft(response.draft);
      setSelectedLogo(null);
      setMessage("Logo uploaded.");
      onRefresh();
    } catch (error) {
      setMessage(messageFor(error, "Logo could not be uploaded."));
    }
  }

  async function publish() {
    setMessage(null);
    try {
      await publishBranding.mutateAsync({
        expectedVersion: draftVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage("Branding published.");
      onRefresh();
    } catch (error) {
      setMessage(messageFor(error, "Branding could not be published."));
    }
  }

  async function removeCurrentLogo() {
    if (
      resolvedBranding.source !== "published" ||
      resolvedBranding.logo === null
    ) {
      return;
    }
    setMessage(null);
    try {
      await removeLogo.mutateAsync({
        expectedVersion: resolvedBranding.version,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(
        "Published logo removed. The selected draft logo is preserved for a future publication.",
      );
      onRefresh();
    } catch (error) {
      setMessage(messageFor(error, "Logo could not be removed."));
    }
  }

  return (
    <SectionCard
      title="Organization branding"
      action={
        <span className="text-caption-1-regular text-fg-muted">
          {statusLabel(resolvedBranding)}
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        {!canManage ? (
          <ReadonlyNotice>
            You can inspect organization branding, but only organization owners
            with edit permission can publish changes.
          </ReadonlyNotice>
        ) : null}
        <div
          style={brandStyle}
          className="grid gap-4 border-b border-border pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]"
        >
          <div className="flex flex-col gap-3">
            <div className="min-h-20 rounded-xl border border-border bg-[var(--organization-brand-primary)] p-4 text-[var(--organization-brand-primary-text)]">
              <p className="text-subhead-semibold">
                {resolvedBranding.displayName}
              </p>
              <p className="text-caption-1-regular">Resolved brand snapshot</p>
            </div>
            <div className="min-h-16 rounded-xl border border-border bg-[var(--organization-brand-secondary)] p-4 text-[var(--organization-brand-secondary-text)]">
              <p className="text-caption-1-regular">
                {resolvedBranding.footerText ?? "Secondary brand surface"}
              </p>
            </div>
          </div>
          <dl className="grid gap-3 text-caption-1-regular">
            <div>
              <dt className="text-fg-muted">Resolved version</dt>
              <dd className="text-fg">{resolvedBranding.version}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Published</dt>
              <dd className="text-fg">
                {resolvedBranding.publishedAt
                  ? formatOrganizationInstant(
                      resolvedBranding.publishedAt,
                      organizationTimezone,
                    )
                  : "Not published"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Draft preview version</dt>
              <dd className="text-fg">{draftVersion}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Logo asset</dt>
              <dd className="break-all text-fg">
                {draftLogo
                  ? `${draftLogo.assetId} (${draftLogo.width}x${draftLogo.height})`
                  : "No organization logo"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="grid gap-4 border-b border-border pb-5 lg:grid-cols-[minmax(0,1fr)_120px]">
          <div
            className="min-h-20 rounded-xl border border-border p-4"
            style={{
              backgroundColor: draftPreview.palette.primary,
              color: draftPreview.palette.primaryText,
            }}
          >
            <p className="text-subhead-semibold">{draftPreview.displayName}</p>
            <p className="text-caption-1-regular">
              {draftPreview.footerText ?? "Draft preview"}
            </p>
            {draftPreview.contactText ? (
              <p className="mt-2 text-caption-1-regular">
                {draftPreview.contactText}
              </p>
            ) : null}
          </div>
          {draftLogo ? (
            isDraftLogoAvailable ? (
              <div className="flex items-center justify-center rounded-xl border border-border bg-canvas p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draftLogoPreviewPath(draftLogo)}
                  alt={draftLogo.altText ?? "Organization logo"}
                  className="max-h-20 max-w-20 object-contain"
                  onError={() => setDraftLogoAvailable(false)}
                />
              </div>
            ) : (
              <div
                className="flex items-center justify-center rounded-xl border border-border bg-canvas p-3 text-center text-caption-1-regular text-fg-muted"
                role="status"
              >
                The selected logo is unavailable. No logo is displayed.
              </div>
            )
          ) : null}
        </div>
        {canManage ? (
          <>
            <form className="grid gap-4 lg:grid-cols-2" onSubmit={saveDraft}>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Brand display name
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
                Primary brand color
                <input
                  value={draft.primary}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      primary: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Secondary brand color
                <input
                  value={draft.secondary}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      secondary: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Logo alt text
                <input
                  value={draft.altText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      altText: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Footer text
                <input
                  value={draft.footerText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      footerText: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Contact text
                <input
                  value={draft.contactText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      contactText: event.target.value,
                    }))
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <div className="flex flex-wrap gap-3 lg:col-span-2">
                <Button
                  type="submit"
                  loading={updateBranding.isPending}
                  loadingLabel="Saving branding draft"
                >
                  Save branding draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void publish()}
                  loading={publishBranding.isPending}
                  loadingLabel="Publishing branding"
                >
                  Publish branding
                </Button>
              </div>
            </form>
            <div className="flex flex-col gap-3 border-t border-border pt-5">
              <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
                Logo image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    setSelectedLogo(event.target.files?.[0] ?? null)
                  }
                  className="text-caption-1-regular text-fg"
                />
              </label>
              {previewUrl ? (
                <div className="flex size-20 items-center justify-center rounded-xl border border-border bg-canvas p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Selected logo preview"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => void uploadSelectedLogo()}
                  disabled={selectedLogo === null}
                  loading={uploadLogo.isPending}
                  loadingLabel="Uploading logo"
                >
                  Upload logo
                </Button>
                {resolvedBranding.source === "published" &&
                resolvedBranding.logo !== null ? (
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => void removeCurrentLogo()}
                    loading={removeLogo.isPending}
                    loadingLabel="Removing logo"
                  >
                    Remove published logo
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
        <ErrorText>{message}</ErrorText>
      </div>
    </SectionCard>
  );
}
