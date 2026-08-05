import { redirect } from "next/navigation";
import { readSession } from "../../lib/session";
import { OrgPicker, type Membership } from "./org-picker";

/**
 * Post-sign-in organisation picker.
 *
 * Everything in apps/api is tenant-scoped and resolves the active org from the
 * X-Organisation-Id header, which the proxy fills from the SESSION. Until one is
 * chosen, every call 401s with "No active organisation context" — so this step
 * is not optional chrome, it is what makes the rest of the app reachable.
 *
 * A user with exactly one membership is auto-selected rather than being shown a
 * one-item list, which is a decision dressed up as a choice.
 */

export const dynamic = "force-dynamic";

async function fetchMemberships(accessToken: string): Promise<Membership[]> {
  const res = await fetch(
    `${process.env.API_URL ?? "http://127.0.0.1:3333"}/organisations`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!res.ok) return [];
  return (await res.json()) as Membership[];
}

export default async function SelectOrganisationPage() {
  const session = await readSession();
  if (!session) redirect("/sign-in");

  const memberships = await fetchMemberships(session.accessToken);

  /* The single-membership auto-select happens in OrgPicker, not here. Next only
   * permits cookie writes from a Server Action or Route Handler — a Server
   * Component render cannot set one — so the client posts to
   * /api/auth/organisation, which is the same path the manual choice takes. */
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Choose an organisation</h1>

      {memberships.length === 0 ? (
        <div className="mt-6 rounded-md border p-4 text-sm">
          <p className="font-medium">You are not a member of any organisation.</p>
          <p className="mt-2 opacity-70">
            Create one to get started — whoever creates an organisation becomes
            its owner. There is no self-serve invite flow yet, so additional
            members are added directly in the database.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm opacity-70">
            Your role differs per organisation, so this also decides what you can
            do.
          </p>
          <OrgPicker memberships={memberships} />
        </>
      )}
      {memberships.length === 0 && (
        <p className="mt-4 text-sm">
          <a className="underline" href="/sign-in">
            Back to sign in
          </a>
        </p>
      )}
    </main>
  );
}
