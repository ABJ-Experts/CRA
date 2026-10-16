import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { RunScopedAccounts } from "./helpers/accounts";
import { cleanupMail, control } from "./m11-03-live.helpers";

const createVerified = RunScopedAccounts.prototype.createVerified;
let emails: readonly string[] = [];
RunScopedAccounts.prototype.createVerified = async function (context, label) {
  const account = await createVerified.call(this, context, label);
  emails = [...emails, account.email.toLowerCase()];
  return account;
};
const trackOrganization = RunScopedAccounts.prototype.trackOrganization;
let organizations: readonly string[] = [];
RunScopedAccounts.prototype.trackOrganization = function (id) {
  trackOrganization.call(this, id);
  organizations = [...new Set([...organizations, id])];
};

// Register only exact organizations tracked by this regression process. The
// isolated connector worker keeps production authorization and vault adapters.
const tracked = RunScopedAccounts.prototype.trackM2V2Organization;
const registrations: Promise<unknown>[] = [];
RunScopedAccounts.prototype.trackM2V2Organization = function (id: string) {
  tracked.call(this, id);
  // The first tracked tenant owns the sync run; the second is only a foreign
  // tenant read probe and must never be added to worker discovery.
  if (registrations.length === 0)
    registrations.push(
      control("/register-connector-regression", { organizationId: id }),
    );
};
test.afterAll(async ({ browser }, testInfo) => {
  await Promise.all(registrations);
  await cleanupMail(emails);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error("Scoped regression cleanup requires fixture environment");
  for (const [table, column, values] of [
    ["users", "email", emails],
    ["organizations", "id", organizations],
  ] as const) {
    for (const value of values) {
      const response = await fetch(
        `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/rest/v1/${table}?select=id&${column}=eq.${encodeURIComponent(value)}`,
        { headers: { apikey: key, authorization: `Bearer ${key}` } },
      );
      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual([]);
    }
  }
  await writeFile(
    testInfo.outputPath("m11-03-regression-cleanup.json"),
    JSON.stringify(
      {
        generatedAccountsRemoved: emails.length,
        generatedOrganizationsRemoved: organizations.length,
        mailCleanup: "Exact message IDs with every recipient in this run only",
        connectorWorkerScopes: registrations.length,
        browser: browser.version(),
      },
      null,
      2,
    ),
  );
  RunScopedAccounts.prototype.createVerified = createVerified;
  RunScopedAccounts.prototype.trackOrganization = trackOrganization;
  RunScopedAccounts.prototype.trackM2V2Organization = tracked;
});

import "./auth-session.spec";
import "./connector-sync.spec";
import "./m10-framework-packs.spec";
