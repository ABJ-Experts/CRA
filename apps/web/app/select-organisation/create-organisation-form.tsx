"use client";

import { Button } from "@repo/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi, jsonRequest } from "../app/_lib/browser-api";

export function CreateOrganisationForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createOrganisation(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await browserApi<{ id: string }>(
      "/organisations",
      jsonRequest({
        legalName: String(formData.get("legalName") ?? ""),
        countryMainEstablishment: String(formData.get("country") ?? "").toUpperCase(),
        registeredAddress: String(formData.get("registeredAddress") ?? "") || undefined,
      }),
    );
    if (!result.data) {
      setError(result.error ?? "Could not create the organisation.");
      setBusy(false);
      return;
    }
    const selected = await fetch("/api/auth/organisation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organisationId: result.data.id }),
    });
    if (!selected.ok) {
      setError("Organisation created, but it could not be selected. Please sign in again.");
      setBusy(false);
      return;
    }
    router.push("/app/onboarding");
    router.refresh();
  }

  return (
    <form
      action={createOrganisation}
      className="mt-6 space-y-4 rounded-xl border border-border p-5"
    >
      <div>
        <label className="block text-sm font-medium" htmlFor="legal-name">
          Organisation name
        </label>
        <input
          required
          id="legal-name"
          name="legalName"
          className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2"
          maxLength={200}
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="country">
          Country of main establishment
        </label>
        <input
          required
          id="country"
          name="country"
          className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 uppercase"
          minLength={2}
          maxLength={2}
          placeholder="DE"
        />
      </div>
      <div>
        <label className="block text-sm font-medium" htmlFor="registered-address">
          Registered address <span className="text-fg-muted">(optional)</span>
        </label>
        <textarea
          id="registered-address"
          name="registeredAddress"
          className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2"
          maxLength={500}
          rows={3}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create organisation"}
      </Button>
    </form>
  );
}
