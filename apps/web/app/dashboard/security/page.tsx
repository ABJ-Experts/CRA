"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Tag } from "@repo/ui/tag";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";

import { SectionCard } from "../_components/dashboard-chrome";

/**
 * Two-factor authentication.
 *
 * The one place a user can turn MFA on. Without this screen the API is
 * reachable but unusable: `/two-factor` only appears once a factor exists, and
 * nothing else in the app can create one.
 *
 * THE RECOVERY CODES ARE SHOWN EXACTLY ONCE. Only their hashes are stored, so
 * there is no endpoint that can return them again — which is why they are
 * rendered inline after enrolment rather than behind a "view codes" button that
 * could never work.
 */

type Step =
  | { kind: "idle" }
  | { kind: "enrolling"; factorId: string; qrCode: string; secret: string }
  | { kind: "codes"; codes: string[] };

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["mfa", "factors"],
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/v1/auth/mfa/factors", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      return (await res.json()) as { enrolled: boolean };
    },
  });

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/mfa/enroll", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as {
        factorId?: string;
        qrCode?: string;
        secret?: string;
        message?: string;
      };

      if (!res.ok || !body.factorId) {
        setError(body.message ?? "We could not start two-factor setup.");
        return;
      }

      setStep({
        kind: "enrolling",
        factorId: body.factorId,
        qrCode: body.qrCode ?? "",
        secret: body.secret ?? "",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (step.kind !== "enrolling") return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/mfa/enroll/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ factorId: step.factorId, code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        recoveryCodes?: string[];
        message?: string;
      };

      if (!res.ok || !body.recoveryCodes) {
        setError(body.message ?? "That code is not right.");
        return;
      }

      setStep({ kind: "codes", codes: body.recoveryCodes });
      setCode("");
      await queryClient.invalidateQueries({ queryKey: ["mfa"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 px-6 pb-8 lg:px-[30px]">
      <div>
        <h1 className="text-h5 text-fg">Security</h1>
        <p className="text-subhead-regular text-fg-muted">
          Add a second step to sign-in using an authenticator app.
        </p>
      </div>

      <SectionCard>
        <div className="flex flex-col gap-6 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-subhead-semibold text-fg">
                Two-factor authentication
              </p>
              <p className="text-caption-1-regular text-fg-muted">
                {isLoading
                  ? "Checking…"
                  : data?.enrolled
                    ? "Required at every sign-in."
                    : "Not set up."}
              </p>
            </div>
            <Tag variant="dot" tone={data?.enrolled ? "green" : "orange"}>
              {data?.enrolled ? "On" : "Off"}
            </Tag>
          </div>

          {step.kind === "idle" && !data?.enrolled ? (
            <div>
              <Button loading={busy} onClick={() => void startEnrollment()}>
                Set up two-factor
              </Button>
            </div>
          ) : null}

          {step.kind === "enrolling" ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => void confirm(e)}
            >
              <p className="text-subhead-regular text-fg-muted">
                Scan this with your authenticator app, then enter the six-digit
                code it shows.
              </p>

              {step.qrCode ? (
                /* The API returns a data: URI, so no external request is made. */
                <Image
                  src={step.qrCode}
                  alt="Two-factor setup QR code"
                  width={180}
                  height={180}
                  unoptimized
                  className="rounded-r12 border border-border bg-white p-2"
                />
              ) : null}

              <p className="text-caption-1-regular text-fg-subtle">
                Cannot scan? Enter this key manually:{" "}
                <code className="text-caption-1-semibold text-fg">
                  {step.secret}
                </code>
              </p>

              <Input
                label="Six-digit code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                error={error ?? undefined}
                data-testid="mfa-confirm-code"
              />

              <div className="flex gap-3">
                <Button type="submit" loading={busy}>
                  Turn on
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep({ kind: "idle" })}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {step.kind === "codes" ? (
            <div className="flex flex-col gap-3">
              <p className="text-subhead-semibold text-fg">
                Save your recovery codes
              </p>
              <p className="text-caption-1-regular text-fg-muted">
                Each one works once, and this is the only time they are shown —
                only their hashes are stored. Using one signs you in and turns
                two-factor off, so you can set it up again on a new device.
              </p>
              <ul className="grid grid-cols-2 gap-2 rounded-r12 bg-surface-muted p-4">
                {step.codes.map((c) => (
                  <li key={c} className="text-subhead-semibold text-fg">
                    {c}
                  </li>
                ))}
              </ul>
              <div>
                <Button onClick={() => setStep({ kind: "idle" })}>
                  I have saved them
                </Button>
              </div>
            </div>
          ) : null}

          {error && step.kind !== "enrolling" ? (
            <p role="alert" className="text-caption-1-regular text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
