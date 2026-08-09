"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Avatar } from "@repo/ui/avatar";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SectionCard } from "../_components/dashboard-chrome";
import { accountApi } from "../../_features/account/account.api";
import { sessionKeys } from "../../_features/session/session.keys";
import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";

/**
 * Your profile.
 *
 * Writes through `PATCH /api/v1/users/me`, which is `@SelfScoped` — it touches
 * only the caller's own row and therefore carries no permission requirement.
 * Asking for a permission to edit your own name would mean a member with none
 * could never fill in their profile.
 */
export default function AccountPage() {
  const { session, isLoading } = useSession();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  /*
   * Seeded from the session once it arrives rather than held as defaultValue:
   * the session resolves after first paint, and an uncontrolled input would
   * keep showing empty fields over real data.
   */
  useEffect(() => {
    if (!session) return;
    setFirstName(session.user.firstName ?? "");
    setLastName(session.user.lastName ?? "");
  }, [session]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);

    try {
      await accountApi.updateProfile({
        firstName,
        lastName,
        jobTitle,
      });

      await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      setStatus("saved");
      setMessage("Saved.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof ApiClientError && error.kind === "api"
          ? error.message
          : error instanceof ApiClientError && error.kind === "network"
            ? "We could not reach the server."
            : "We could not save those changes.",
      );
    }
  }

  const name = [firstName, lastName].filter(Boolean).join(" ").trim();

  return (
    <div className="flex flex-col gap-6 px-6 pb-8 lg:px-[30px]">
      <div>
        <h1 className="text-h5 text-fg">Account</h1>
        <p className="text-subhead-regular text-fg-muted">
          Your name and details, visible to others in your organization.
        </p>
      </div>

      <SectionCard>
        <form
          className="flex flex-col gap-6 p-6"
          onSubmit={(e) => void save(e)}
        >
          <div className="flex items-center gap-4">
            <Avatar size="md" name={name || session?.user.email || "?"} />
            <div>
              <p className="text-subhead-semibold text-fg">
                {name || session?.user.email || "—"}
              </p>
              <p className="text-caption-1-regular text-fg-muted">
                {session?.user.email ??
                  (isLoading ? "Loading…" : "Not signed in")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              data-testid="account-first-name"
            />
            <Input
              label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              data-testid="account-last-name"
            />
          </div>

          <Input
            label="Job title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            helperText="Shown next to your name in the member list."
            data-testid="account-job-title"
          />

          <div className="flex items-center gap-3">
            <Button type="submit" loading={status === "saving"}>
              Save changes
            </Button>
            {message ? (
              <p
                role="status"
                className={
                  status === "error"
                    ? "text-caption-1-regular text-danger"
                    : "text-caption-1-regular text-fg-muted"
                }
              >
                {message}
              </p>
            ) : null}
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
