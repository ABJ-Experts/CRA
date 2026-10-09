"use client";

type ProductRelationshipEvidenceInputsProps = Readonly<{
  source: string;
  provenance: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  onSource: (value: string) => void;
  onProvenance: (value: string) => void;
  onReason: (value: string) => void;
  onStartsAt: (value: string) => void;
  onEndsAt: (value: string) => void;
}>;

function DateTimeInput({
  label,
  value,
  onChange,
  required = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}>) {
  return (
    <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
      {label}
      <input
        type="datetime-local"
        aria-label={label}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
      />
    </label>
  );
}

export function ProductRelationshipEvidenceInputs({
  source,
  provenance,
  reason,
  startsAt,
  endsAt,
  onSource,
  onProvenance,
  onReason,
  onStartsAt,
  onEndsAt,
}: ProductRelationshipEvidenceInputsProps) {
  return (
    <>
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        Relationship source
        <input
          aria-label="Relationship source"
          required
          value={source}
          onChange={(event) => onSource(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        Provenance
        <input
          aria-label="Relationship provenance"
          required
          value={provenance}
          onChange={(event) => onProvenance(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <DateTimeInput
        label="Relationship effective start"
        value={startsAt}
        onChange={onStartsAt}
        required
      />
      <DateTimeInput
        label="Relationship effective end"
        value={endsAt}
        onChange={onEndsAt}
      />
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2 xl:col-span-4">
        Reason
        <input
          aria-label="Relationship reason"
          required
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
    </>
  );
}
