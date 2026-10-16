import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  CircleHelp,
} from "lucide-react";
import type { EvidenceValidityStatus as EvidenceValidityStatusValue } from "@repo/contracts/evidence";

export type { EvidenceValidityStatus as EvidenceValidityStatusValue } from "@repo/contracts/evidence";

type ValidityPresentation = Readonly<{
  label: string;
  detail: string | null;
  className: string;
  icon: typeof CircleCheck;
}>;

function presentation(
  status: EvidenceValidityStatusValue,
): ValidityPresentation {
  switch (status) {
    case "expired":
      return {
        label: "Expired",
        detail: null,
        className: "bg-danger-surface text-danger-fg",
        icon: AlertTriangle,
      };
    case "expiring_soon":
      return {
        label: "Expiring soon",
        detail: null,
        className: "bg-warning-surface text-warning-fg",
        icon: CalendarClock,
      };
    case "not_yet_valid":
      return {
        label: "Not yet valid",
        detail: null,
        className: "bg-surface text-fg",
        icon: CalendarClock,
      };
    case "open_ended":
      return {
        label: "Open-ended validity",
        detail: "Open-ended validity — no expiry alert is scheduled",
        className: "bg-surface text-fg",
        icon: CircleHelp,
      };
    case "missing":
      return {
        label: "Validity not supplied",
        detail: null,
        className: "bg-surface text-fg",
        icon: CircleHelp,
      };
    default:
      return {
        label: "Current",
        detail: null,
        className: "bg-success-surface text-success-fg",
        icon: CircleCheck,
      };
  }
}

export function EvidenceValidityStatus({
  status,
  validFrom,
  validUntil,
}: Readonly<{
  status: EvidenceValidityStatusValue;
  validFrom: string | null;
  validUntil: string | null;
}>) {
  const value = presentation(status);
  const Icon = value.icon;
  const timing =
    status === "missing" || status === "open_ended"
      ? null
      : [validFrom, validUntil]
          .filter((date): date is string => date !== null)
          .map((date) =>
            new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
              new Date(date),
            ),
          )
          .join(" – ");

  return (
    <div className="grid gap-1">
      <span
        aria-label={`${value.label} validity`}
        className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-caption-1-semibold ${value.className}`}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {value.label}
      </span>
      {value.detail ? (
        <span className="max-w-72 text-caption-1-regular text-fg-muted">
          {value.detail}
        </span>
      ) : timing ? (
        <span className="text-caption-1-regular text-fg-muted">{timing}</span>
      ) : null}
    </div>
  );
}
