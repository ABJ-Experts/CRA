"use client";

import { Button } from "@repo/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi, jsonRequest } from "../_lib/browser-api";
import type { OrganisationData, PrincipalData } from "../_lib/api";
import { hasPermission } from "../_lib/permissions";

export function OnboardingFlow({
  organisation,
  principal,
}: {
  organisation: OrganisationData;
  principal: PrincipalData | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = organisation.onboardingState?.step ?? "organisation_created";
  const canCreateProduct = hasPermission(principal, "product:create");

  async function createFirstProduct(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await browserApi<{ id: string }>(
      "/products",
      jsonRequest({
        name: String(formData.get("name") ?? ""),
        internalCode: String(formData.get("internalCode") ?? ""),
        productType: "standalone_software",
      }),
    );
    if (!result.data) {
      setError(result.error ?? "Could not create the product.");
      setBusy(false);
      return;
    }
    router.push(`/app/products/${result.data.id}`);
    router.refresh();
  }

  if (step === "sbom_uploaded") {
    return (
      <div className="rounded-xl border border-success-border bg-success-subtle p-5">
        <h2 className="font-semibold">Setup complete</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Your first SBOM is being monitored for vulnerabilities.
        </p>
        <Button className="mt-4" asChild>
          <Link href="/app/dashboard">Open dashboard</Link>
        </Button>
      </div>
    );
  }

  if (step === "product_created" && organisation.onboardingState.productId) {
    return (
      <div className="rounded-xl border border-border p-5">
        <h2 className="font-semibold">Add the first release and SBOM</h2>
        <p className="mt-1 text-sm text-fg-muted">
          A release is where its source SBOM and resulting findings are tracked.
        </p>
        <Button className="mt-4" asChild>
          <Link href={`/app/products/${organisation.onboardingState.productId}`}>
            Continue setup
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-5">
      <h2 className="font-semibold">Register your first product</h2>
      <p className="mt-1 text-sm text-fg-muted">
        This starts the lifecycle and compliance record for software you ship.
      </p>
      {canCreateProduct ? (
        <form action={createFirstProduct} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            Product name
            <input
              required
              name="name"
              maxLength={200}
              className="mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Internal code
            <input
              required
              name="internalCode"
              maxLength={100}
              className="mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger-fg md:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create product"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-fg-muted">
          Your role cannot create products. Ask an organisation owner or Product Security Manager to
          complete setup.
        </p>
      )}
    </div>
  );
}
