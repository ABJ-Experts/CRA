"use client";

import type { ResolvedOrganizationBranding } from "@repo/contracts";
import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useActiveOrganizationBrandingQuery } from "../_features/organizations/active-organization-branding.queries";
import { useSession } from "../_providers/session-provider";

type OrganizationBrandingStyle = CSSProperties &
  Readonly<{
    "--organization-brand-primary": string;
    "--organization-brand-primary-text": string;
    "--organization-brand-secondary": string;
    "--organization-brand-secondary-text": string;
  }>;

const DashboardOrganizationBrandingContext =
  createContext<ResolvedOrganizationBranding | null>(null);

function publishedBranding(
  branding: ResolvedOrganizationBranding | null | undefined,
  enabled: boolean,
): ResolvedOrganizationBranding | null {
  return enabled && branding?.source === "published" ? branding : null;
}

function styleForBranding(
  branding: ResolvedOrganizationBranding | null,
): OrganizationBrandingStyle | undefined {
  if (branding === null) return undefined;

  return {
    "--organization-brand-primary": branding.palette.primary,
    "--organization-brand-primary-text": branding.palette.primaryText,
    "--organization-brand-secondary": branding.palette.secondary,
    "--organization-brand-secondary-text": branding.palette.secondaryText,
  };
}

export function OrganizationThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { session } = useSession();
  const organizationId = session?.organization?.id ?? null;
  const brandingQuery = useActiveOrganizationBrandingQuery(
    organizationId,
    organizationId !== null,
  );
  const branding = useMemo(
    () =>
      publishedBranding(
        brandingQuery.data?.branding,
        organizationId !== null &&
          !brandingQuery.isLoading &&
          !brandingQuery.isError,
      ),
    [
      brandingQuery.data,
      brandingQuery.isError,
      brandingQuery.isLoading,
      organizationId,
    ],
  );
  const style = useMemo(() => styleForBranding(branding), [branding]);

  return (
    <DashboardOrganizationBrandingContext.Provider value={branding}>
      <div
        className="block"
        data-organization-theme={branding ? "published" : undefined}
        style={style}
      >
        {children}
      </div>
    </DashboardOrganizationBrandingContext.Provider>
  );
}

export function useDashboardOrganizationBranding(): ResolvedOrganizationBranding | null {
  return useContext(DashboardOrganizationBrandingContext);
}
