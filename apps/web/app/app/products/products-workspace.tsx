"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi, jsonRequest } from "../_lib/browser-api";
import { hasPermission } from "../_lib/permissions";
import type { PrincipalData, ProductRow } from "../_lib/api";

const PRODUCT_TYPES = [
  "standalone_software",
  "hardware_with_software",
  "component",
  "remote_data_processing",
] as const;

export function ProductsWorkspace({
  products,
  principal,
}: {
  products: ProductRow[];
  principal: PrincipalData | null;
}) {
  const router = useRouter();
  const canCreate = hasPermission(principal, "product:create");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProduct(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await browserApi<ProductRow>(
      "/products",
      jsonRequest({
        name: String(formData.get("name") ?? ""),
        internalCode: String(formData.get("internalCode") ?? ""),
        productType: String(formData.get("productType") ?? "standalone_software"),
      }),
    );
    if (!result.data) {
      setError(result.error ?? "Could not create the product.");
      setBusy(false);
      return;
    }
    router.push(`/app/products/${result.data.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {canCreate ? (
        <div>
          <Button onClick={() => setShowForm((visible) => !visible)}>
            {showForm ? "Cancel" : "Add product"}
          </Button>
        </div>
      ) : null}
      {showForm ? (
        <form
          action={createProduct}
          className="grid gap-4 rounded-xl border border-border p-5 md:grid-cols-3"
        >
          <label className="text-sm font-medium">
            Name
            <input
              required
              name="name"
              maxLength={200}
              className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Internal code
            <input
              required
              name="internalCode"
              maxLength={100}
              className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            Type
            <select
              name="productType"
              className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2"
            >
              {PRODUCT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger-fg md:col-span-3">
              {error}
            </p>
          ) : null}
          <div className="md:col-span-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create product"}
            </Button>
          </div>
        </form>
      ) : null}

      {products.length === 0 ? (
        <p className="text-caption-1-regular text-fg-muted">
          No products yet. Register the products you ship, then upload an SBOM for each release.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-caption-2-semibold uppercase tracking-wide text-fg-muted">
                <th className="p-3">Name</th>
                <th className="p-3">Internal code</th>
                <th className="p-3">Type</th>
                <th className="p-3">Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-caption-1-semibold">
                    <Link className="underline" href={`/app/products/${product.id}`}>
                      {product.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-caption-1-regular text-fg-muted">
                    {product.internalCode}
                  </td>
                  <td className="p-3 text-caption-1-regular text-fg-muted">
                    {product.productType.replaceAll("_", " ")}
                  </td>
                  <td className="p-3">
                    <Tag>{product.lifecycleState.replaceAll("_", " ")}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
