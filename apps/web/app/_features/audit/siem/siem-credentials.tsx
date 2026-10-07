"use client";
import { useState } from "react";
import { siemCredentialSchema } from "@repo/contracts/audit/schemas";
import type { SiemCredential } from "@repo/contracts/audit/types";
import { Input } from "@repo/ui/input";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { siemControlClass } from "./siem-config-form";
export function SiemCredentials({
  syslog,
  pending,
  onSave,
}: Readonly<{
  syslog: boolean;
  pending: boolean;
  onSave: (credential: SiemCredential) => Promise<unknown>;
}>) {
  const [mode, setMode] = useState<"bearer" | "mtls">(
      syslog ? "mtls" : "bearer",
    ),
    [token, setToken] = useState(""),
    [certificate, setCertificate] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [ca, setCa] = useState(""),
    [error, setError] = useState<string | null>(null);
  return (
    <form
      className={cn("space-y-4")}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = siemCredentialSchema.safeParse(
          mode === "bearer"
            ? { mode, token }
            : { mode, certificate, privateKey, ...(ca ? { ca } : {}) },
        );
        setToken("");
        setCertificate("");
        setPrivateKey("");
        setCa("");
        if (!parsed.success) {
          setError("Enter valid credentials. Secret inputs have been cleared.");
          return;
        }
        setError(null);
        void onSave(parsed.data).catch(() =>
          setError(
            "Credential update failed. Check current status before submitting fresh credentials.",
          ),
        );
      }}
    >
      <p className={cn("max-w-prose text-caption-1-regular text-fg-muted")}>
        Credentials are encrypted by the server. Inputs clear on submission and
        are never returned. Rotation keeps the backlog and fences prior
        attempts.
      </p>
      {!syslog ? (
        <label className={cn("block space-y-2 text-caption-1-semibold")}>
          Authentication
          <select
            aria-label="Authentication"
            className={cn(siemControlClass)}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as typeof mode);
              setToken("");
              setCertificate("");
              setPrivateKey("");
              setCa("");
            }}
          >
            <option value="bearer">Bearer token</option>
            <option value="mtls">Mutual TLS</option>
          </select>
        </label>
      ) : null}
      {mode === "bearer" ? (
        <Input
          label="Bearer token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      ) : (
        <>
          {(
            [
              ["Client certificate", certificate, setCertificate],
              ["Client private key", privateKey, setPrivateKey],
              ["Custom CA (optional)", ca, setCa],
            ] as const
          ).map(([label, value, change]) => (
            <label
              key={label}
              className={cn("block space-y-2 text-caption-1-semibold")}
            >
              {label}
              <textarea
                autoComplete="off"
                spellCheck={false}
                rows={3}
                className={cn(siemControlClass)}
                value={value}
                onChange={(event) => change(event.target.value)}
              />
            </label>
          ))}
        </>
      )}
      {error ? (
        <p role="alert" className={cn("text-caption-1-regular text-danger")}>
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Rotate credentials
      </Button>
    </form>
  );
}
