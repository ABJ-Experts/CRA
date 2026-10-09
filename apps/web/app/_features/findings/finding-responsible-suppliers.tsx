"use client";

import { Button } from "@repo/ui/button";
import Link from "next/link";

import { useHasPermission } from "../../_providers/session-provider";
import { useFindingResponsibleSuppliersQuery } from "../suppliers/suppliers.queries";

/** Internal-only supplier projection for the finding detail; the API filters it by tenant and finding scope. */
export function FindingResponsibleSuppliers({
  findingId,
}: Readonly<{ findingId: string }>) {
  const canViewSuppliers = useHasPermission("can_view_suppliers");
  const resolution = useFindingResponsibleSuppliersQuery(
    findingId,
    canViewSuppliers,
  );
  return (
    <section className="mt-6" aria-labelledby="responsible-suppliers-heading">
      <h3
        id="responsible-suppliers-heading"
        className="text-subhead-semibold text-fg"
      >
        Responsible suppliers
      </h3>
      {!canViewSuppliers ? (
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          Supplier responsibility records require separate internal access.
        </p>
      ) : null}
      {canViewSuppliers && resolution.isLoading ? (
        <p role="status" className="mt-2 text-caption-1-regular text-fg-muted">
          Checking component responsibility links…
        </p>
      ) : null}
      {canViewSuppliers && resolution.isError ? (
        <div className="mt-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            Supplier responsibility is temporarily unavailable. No supplier
            responsibility has been inferred.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() => void resolution.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {resolution.data?.resolution.responsibility === "unknown" ? (
        <p className="mt-2 text-caption-1-regular text-fg-muted">
          Unknown — no active supplier responsibility is linked to this
          finding’s exact component occurrence.
        </p>
      ) : null}
      {resolution.data?.resolution.responsibility === "known" ? (
        <ul className="mt-2 grid gap-2" aria-label="Responsible suppliers">
          {resolution.data.resolution.suppliers.map(({ supplier }) => (
            <li
              key={supplier.id}
              className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
            >
              <Link
                href={`/suppliers/${supplier.id}`}
                className="font-medium text-link underline"
              >
                {supplier.name}
              </Link>
              <span className="text-fg-muted">
                {" "}
                · {supplier.criticality} criticality
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
