"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Membership {
  organisationId: string;
  legalName: string;
  roleKey: string;
  roleName: string;
}

/**
 * Client half of the picker: selecting writes the organisation into the session
 * cookie via /api/auth/organisation, then moves on.
 *
 * The id is sent to OUR route handler, never attached to an API call directly —
 * apps/api trusts X-Organisation-Id to resolve the principal, so the proxy fills
 * it from the cookie. The API still verifies membership when resolving, so a
 * forged id fails closed rather than granting access.
 */
export function OrgPicker({ memberships }: { memberships: Membership[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback(async function choose(organisationId: string) {
    setBusy(organisationId);
    setError(null);
    try {
      const res = await fetch("/api/auth/organisation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!body.ok) {
        setError(body.message ?? "Could not select that organisation.");
        setBusy(null);
        return;
      }
      router.push("/app/dashboard");
      /* The cookie changed, so any cached server render is now stale. */
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(null);
    }
  }, [router]);

  /* One membership is not a choice, so do not stage it as one. Runs here rather
   * than in the server component because only a Route Handler may write the
   * session cookie. The ref guards against React 18 double-invoking effects in
   * development, which would otherwise fire two selects. */
  const autoSelected = useRef(false);
  const only = memberships.length === 1 ? memberships[0] : undefined;
  useEffect(() => {
    if (!only || autoSelected.current) return;
    autoSelected.current = true;
    void choose(only.organisationId);
  }, [only, choose]);

  if (only) {
    return (
      <p className="mt-6 text-sm opacity-70">
        Signing you in to {only.legalName} as {only.roleName}…
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
          {error}
        </p>
      ) : null}

      <ul className="mt-6 space-y-2">
        {memberships.map((m) => (
          <li key={m.organisationId}>
            <button
              type="button"
              onClick={() => void choose(m.organisationId)}
              disabled={busy !== null}
              className="flex w-full items-center justify-between rounded-md border p-4 text-left transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
            >
              <span>
                <span className="block font-medium">{m.legalName}</span>
                <span className="block text-sm opacity-70">{m.roleName}</span>
              </span>
              <span className="text-sm opacity-70">
                {busy === m.organisationId ? "Selecting…" : "Select"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
