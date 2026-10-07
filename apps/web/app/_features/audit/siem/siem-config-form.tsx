"use client";
import { useState } from "react";
import type { SiemConfig, SiemCatalogue } from "@repo/contracts/audit/types";
import {
  siemConfigSchema,
  siemEventClassSchema,
} from "@repo/contracts/audit/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { cn } from "@repo/ui/cn";
export const siemControlClass =
  "w-full rounded-lg border border-border bg-canvas p-3 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-active-500";
export function SiemConfigForm({
  initial,
  baseVersion,
  catalogue,
  pending,
  onSave,
}: Readonly<{
  initial?: SiemConfig;
  baseVersion?: number;
  catalogue?: SiemCatalogue;
  pending: boolean;
  onSave: (input: SiemConfig, reason: string, expectedVersion?: number) => void;
}>) {
  const [draft, setDraft] = useState<SiemConfig>(
    initial
      ? {
          name: initial.name,
          transport: initial.transport,
          format: initial.format,
          endpoint: initial.endpoint,
          eventClasses: initial.eventClasses,
          productIds: initial.productIds,
        }
      : {
          name: "",
          endpoint: "",
          transport: "https",
          format: "json",
          eventClasses: ["access_control"],
          productIds: [],
        },
  );
  const [products, setProducts] = useState(draft.productIds.join("\n"));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState<number | undefined>();
  function beginEdit() {
    setEditVersion((version) => version ?? baseVersion);
  }
  function changeDraft(next: SiemConfig) {
    beginEdit();
    setDraft(next);
  }
  const classes =
    catalogue?.eventClasses ??
    siemEventClassSchema.options.map((id) => ({
      id,
      label: id.replaceAll("_", " "),
      productScoped: false,
    }));
  return (
    <form
      className={cn("space-y-4")}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = siemConfigSchema.safeParse({
          ...draft,
          productIds: products.split(/[\s,]+/).filter(Boolean),
        });
        if (!parsed.success || (initial && !reason.trim())) {
          setError(
            "Check the recipient, event selection and product IDs. Changes require a reason.",
          );
          return;
        }
        setError(null);
        const version = editVersion ?? baseVersion;
        if (version === undefined) onSave(parsed.data, reason);
        else onSave(parsed.data, reason, version);
      }}
    >
      <fieldset
        disabled={pending}
        aria-label="Destination configuration"
        className={cn("min-w-0 space-y-4")}
      >
        <Input
          label="Destination name"
          value={draft.name}
          onChange={(event) =>
            changeDraft({ ...draft, name: event.target.value })
          }
        />
        <label className={cn("block space-y-2 text-caption-1-semibold")}>
          Transport
          <select
            aria-label="Transport"
            className={cn(siemControlClass)}
            value={draft.transport}
            onChange={(event) =>
              changeDraft({
                ...draft,
                transport: event.target.value as SiemConfig["transport"],
              })
            }
          >
            <option value="https">HTTPS</option>
            <option value="syslog_tls">TLS syslog</option>
          </select>
        </label>
        <label className={cn("block space-y-2 text-caption-1-semibold")}>
          Format
          <select
            aria-label="Format"
            className={cn(siemControlClass)}
            value={draft.format}
            onChange={(event) =>
              changeDraft({
                ...draft,
                format: event.target.value as SiemConfig["format"],
              })
            }
          >
            <option value="json">JSON</option>
            <option value="cef">CEF</option>
          </select>
        </label>
        <Input
          label="Collector endpoint"
          value={draft.endpoint}
          placeholder={
            draft.transport === "https"
              ? "https://collector.example.com/events"
              : "tls://collector.example.com:6514"
          }
          onChange={(event) =>
            changeDraft({ ...draft, endpoint: event.target.value })
          }
        />
        <p className={cn("max-w-prose text-caption-1-regular text-fg-muted")}>
          Public collectors only. A deployment administrator must approve the
          exact target. TLS syslog writes do not confirm collector receipt.
        </p>
        <fieldset className={cn("grid gap-2 sm:grid-cols-2")}>
          <legend className={cn("mb-2 text-subhead-semibold")}>
            Event classes
          </legend>
          {classes.map((item) => (
            <label
              key={item.id}
              className={cn("flex items-center gap-2 text-caption-1-regular")}
            >
              <input
                type="checkbox"
                checked={draft.eventClasses.includes(item.id)}
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    eventClasses: event.target.checked
                      ? [...draft.eventClasses, item.id]
                      : draft.eventClasses.filter((id) => id !== item.id),
                  })
                }
              />
              {item.label}
              {item.productScoped ? " (product scoped)" : ""}
            </label>
          ))}
        </fieldset>
        <label className={cn("block space-y-2 text-caption-1-semibold")}>
          Authorized product IDs
          <textarea
            rows={3}
            className={cn(siemControlClass)}
            value={products}
            onChange={(event) => {
              beginEdit();
              setProducts(event.target.value);
            }}
          />
        </label>
        <p className={cn("text-caption-1-regular text-fg-muted")}>
          Enter one product UUID per line. Product event classes require an
          explicit selection; access is checked by the server.
        </p>
        {initial ? (
          <>
            <Input
              label="Configuration change reason"
              value={reason}
              onChange={(event) => {
                beginEdit();
                setReason(event.target.value);
              }}
            />
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Saving cancels pending deliveries for the old configuration and
              starts from a new future boundary. Test and enable the updated
              destination explicitly.
            </p>
          </>
        ) : null}
        {error ? (
          <p role="alert" className={cn("text-caption-1-regular text-danger")}>
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          Save destination
        </Button>
      </fieldset>
    </form>
  );
}
