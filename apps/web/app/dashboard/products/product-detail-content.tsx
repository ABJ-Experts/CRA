"use client";

import {
  createReleaseInputSchema,
  updateProductInputSchema,
  type Product,
  type ProductType,
  type Release,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  useArchiveProductMutation,
  useArchiveReleaseMutation,
  useCreateReleaseMutation,
  useProductQuery,
  useProductReleasesQuery,
  useUpdateProductMutation,
  useUpdateReleaseMutation,
} from "../../_features/products/products.queries";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import { PageHeading, SectionCard } from "../_components/dashboard-chrome";

import { ReleaseRegulatoryControls } from "./release-regulatory-controls";
import { ProductRelationshipSection } from "./product-relationship-section";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 404)
    return "This product is unavailable.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This record changed in another session. Refresh it before trying again.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  )
    return "The registry is temporarily unavailable. Try again.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  return fallback;
}

function ProductEditor({ product }: { product: Product }) {
  const update = useUpdateProductMutation(product.id);
  const [name, setName] = useState(product.name);
  const [internalCode, setInternalCode] = useState(product.internalCode);
  const [productType, setProductType] = useState<ProductType>(
    product.productType,
  );
  const [description, setDescription] = useState(product.description ?? "");
  const [responsibleOwnerId, setResponsibleOwnerId] = useState(
    product.responsibleOwnerId,
  );
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = updateProductInputSchema.safeParse({
      name,
      internalCode,
      productType,
      description: description.trim() || null,
      responsibleOwnerId,
      expectedVersion: product.version,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the product details.",
      );
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      setMessage("Product saved.");
    } catch (error) {
      setMessage(errorMessage(error, "The product could not be saved."));
    }
  }

  return (
    <SectionCard title="Product details">
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Product name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Internal code
          <input
            required
            value={internalCode}
            onChange={(event) => setInternalCode(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Product type
          <select
            value={productType}
            onChange={(event) =>
              setProductType(event.target.value as ProductType)
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            <option value="hardware_with_software">
              Hardware with software
            </option>
            <option value="standalone_software">Standalone software</option>
            <option value="component">Component</option>
            <option value="remote_data_processing">
              Remote data processing
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Responsible owner ID
          <input
            required
            value={responsibleOwnerId}
            onChange={(event) => setResponsibleOwnerId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-28 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
          />
        </label>
        {message ? (
          <p
            role="status"
            className="sm:col-span-2 text-subhead-regular text-fg-muted"
          >
            {message}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={update.isPending}
            loadingLabel="Saving product"
          >
            Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ReleaseCreateForm({ productId }: { productId: string }) {
  const create = useCreateReleaseMutation(productId);
  const [draft, setDraft] = useState({
    label: "",
    version: "",
    description: undefined as string | undefined,
  });
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createReleaseInputSchema.safeParse({
      ...draft,
      description: draft.description?.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the release details.",
      );
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setDraft({
        label: "",
        version: "",
        description: undefined,
      });
      setMessage("Release created.");
    } catch (error) {
      setMessage(errorMessage(error, "The release could not be created."));
    }
  }

  return (
    <form
      className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        Release label
        <input
          required
          value={draft.label}
          onChange={(event) =>
            setDraft((current) => ({ ...current, label: event.target.value }))
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        Version
        <input
          required
          value={draft.version}
          onChange={(event) =>
            setDraft((current) => ({ ...current, version: event.target.value }))
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
        Description <span className="text-fg-muted">(optional)</span>
        <input
          value={draft.description ?? ""}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      {message ? (
        <p
          role="status"
          className="sm:col-span-2 text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button
          type="submit"
          loading={create.isPending}
          loadingLabel="Creating release"
        >
          Add release
        </Button>
      </div>
    </form>
  );
}

function ReleaseRow({
  productId,
  release,
  canEdit,
  canArchive,
  canCorrectPlacedDate,
  enabled,
  onReload,
}: {
  productId: string;
  release: Release;
  canEdit: boolean;
  canArchive: boolean;
  canCorrectPlacedDate: boolean;
  enabled: boolean;
  onReload: () => void;
}) {
  const archive = useArchiveReleaseMutation(productId, release.id);
  const update = useUpdateReleaseMutation(productId, release.id);
  const [message, setMessage] = useState<string | null>(null);
  const [label, setLabel] = useState(release.label);
  const [version, setVersion] = useState(release.version);
  const [description, setDescription] = useState(release.description ?? "");

  async function archiveRelease() {
    try {
      await archive.mutateAsync({
        expectedVersion: release.versionNumber,
        reason: "Archived from product registry",
      });
    } catch (error) {
      setMessage(errorMessage(error, "The release could not be archived."));
    }
  }

  async function saveRelease(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await update.mutateAsync({
        label,
        version,
        description: description.trim() || null,
        expectedVersion: release.versionNumber,
      });
      setMessage("Release saved.");
    } catch (error) {
      setMessage(errorMessage(error, "The release could not be saved."));
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-subhead-semibold text-fg">
          {release.label}{" "}
          <span className="font-normal text-fg-muted">{release.version}</span>
        </p>
        <p className="text-caption-1-regular text-fg-muted">
          {release.lifecycle}
          {release.archivedAt ? " · archived" : ""}
        </p>
        {message ? (
          <p role="alert" className="text-caption-1-regular text-danger">
            {message}
          </p>
        ) : null}
      </div>
      {!release.archivedAt ? (
        <div className="flex items-center gap-2">
          {canEdit ? (
            <details>
              <summary className="cursor-pointer text-caption-1-regular text-fg-muted">
                Edit metadata
              </summary>
              <form
                className="mt-3 grid min-w-72 gap-2 rounded-xl border border-border p-3"
                noValidate
                onSubmit={(event) => void saveRelease(event)}
              >
                <label className="text-caption-1-regular text-fg">
                  Label
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                  />
                </label>
                <label className="text-caption-1-regular text-fg">
                  Version
                  <input
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                  />
                </label>
                <label className="text-caption-1-regular text-fg">
                  Description
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
                  />
                </label>
                <Button
                  type="submit"
                  loading={update.isPending}
                  loadingLabel="Saving release"
                >
                  Save release
                </Button>
              </form>
            </details>
          ) : null}
          {canArchive ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={release.lifecycle !== "withdrawn"}
              onClick={() => void archiveRelease()}
              loading={archive.isPending}
              loadingLabel="Archiving release"
            >
              Archive
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="basis-full">
        <ReleaseRegulatoryControls
          productId={productId}
          release={release}
          canEdit={canEdit && !release.archivedAt}
          canCorrectPlacedDate={canCorrectPlacedDate && !release.archivedAt}
          enabled={enabled}
          onReload={onReload}
        />
      </div>
    </li>
  );
}

function ProductArchiveControl({ product }: { product: Product }) {
  const archive = useArchiveProductMutation(product.id);
  const [message, setMessage] = useState<string | null>(null);
  async function archiveProduct() {
    try {
      await archive.mutateAsync({
        expectedVersion: product.version,
        reason: "Archived from product registry",
      });
    } catch (error) {
      setMessage(errorMessage(error, "The product could not be archived."));
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        tone="grey"
        onClick={() => void archiveProduct()}
        loading={archive.isPending}
        loadingLabel="Archiving product"
      >
        Archive product
      </Button>
      {message ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function ProductDetailContent({ productId }: { productId: string }) {
  const router = useRouter();
  const mocksReady = useMocksReady();
  const {
    session,
    permissions,
    role,
    isLoading: sessionLoading,
  } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_products === true;
  const enabled = liveApiEnabled && hasMembership && canView;
  const product = useProductQuery(productId, enabled);
  const releases = useProductReleasesQuery(
    productId,
    { page: 1, pageSize: 50 },
    enabled,
  );
  const canEdit = permissions.can_edit_products === true;
  const canCreate = permissions.can_create_products === true;
  const canArchive = permissions.can_delete_products === true;
  const reloadProductData = () => {
    void product.refetch();
    void releases.refetch();
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title={product.data?.product.name ?? "Product"}
        subtitle="Product identity, release history, and lifecycle state."
        actions={
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => router.push("/dashboard/products")}
          >
            Back to products
          </Button>
        }
      />
      {!liveApiEnabled ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Products are available when the live backend is enabled.
          </p>
        </SectionCard>
      ) : sessionLoading ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading product…
          </p>
        </SectionCard>
      ) : !hasMembership ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Create or join an organization before managing products.
          </p>
        </SectionCard>
      ) : !canView ? (
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            You do not have permission to view products.
          </p>
        </SectionCard>
      ) : product.isPending ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading product…
          </p>
        </SectionCard>
      ) : product.isError ? (
        <SectionCard>
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-subhead-regular text-danger">
              {errorMessage(product.error, "Product could not be loaded.")}
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void product.refetch()}
            >
              Try again
            </Button>
          </div>
        </SectionCard>
      ) : product.data ? (
        <>
          <SectionCard
            title="Registry identity"
            action={
              canArchive && !product.data.product.archivedAt ? (
                <ProductArchiveControl product={product.data.product} />
              ) : undefined
            }
          >
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-caption-1-regular text-fg-muted">
                  Internal code
                </dt>
                <dd className="text-subhead-regular text-fg">
                  {product.data.product.internalCode}
                </dd>
              </div>
              <div>
                <dt className="text-caption-1-regular text-fg-muted">
                  Legal entity
                </dt>
                <dd className="text-subhead-regular text-fg">
                  {product.data.product.legalEntity.legalName}
                </dd>
              </div>
              <div>
                <dt className="text-caption-1-regular text-fg-muted">
                  Responsible owner
                </dt>
                <dd className="text-subhead-regular text-fg">
                  {product.data.product.responsibleOwnerId}
                </dd>
              </div>
              <div>
                <dt className="text-caption-1-regular text-fg-muted">Status</dt>
                <dd className="text-subhead-regular text-fg">
                  {product.data.product.archivedAt ? "Archived" : "Active"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-caption-1-regular text-fg-muted">
              If the responsible owner is inactive, assign an active
              organization member before continuing product work.
            </p>
          </SectionCard>
          {product.data.product.archivedAt ? (
            <SectionCard>
              <p className="text-subhead-regular text-fg-muted">
                This product is archived. Its evidence and release history
                remain available for authorized review.
              </p>
            </SectionCard>
          ) : canEdit ? (
            <ProductEditor product={product.data.product} />
          ) : null}
          <SectionCard title="Releases">
            {releases.isPending ? (
              <p role="status" className="text-subhead-regular text-fg-muted">
                Loading releases…
              </p>
            ) : releases.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="text-subhead-regular text-danger">
                  {errorMessage(
                    releases.error,
                    "Releases could not be loaded.",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void releases.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : releases.data?.releases.rows.length === 0 ? (
              <p className="text-subhead-regular text-fg-muted">
                No releases have been added yet.
              </p>
            ) : (
              <ul aria-label="Product releases">
                {releases.data?.releases.rows.map((release) => (
                  <ReleaseRow
                    key={release.id}
                    productId={productId}
                    release={release}
                    canEdit={canEdit && !product.data.product.archivedAt}
                    canArchive={canArchive && !product.data.product.archivedAt}
                    canCorrectPlacedDate={
                      canEdit &&
                      role === "owner" &&
                      !product.data.product.archivedAt
                    }
                    enabled={enabled}
                    onReload={reloadProductData}
                  />
                ))}
              </ul>
            )}
            {canCreate && !product.data.product.archivedAt ? (
              <ReleaseCreateForm productId={productId} />
            ) : null}
          </SectionCard>
          <SectionCard>
            <ProductRelationshipSection
              productId={productId}
              releases={
                releases.data?.releases.rows.map((release) => ({
                  id: release.id,
                  label: release.label,
                  version: release.version,
                })) ?? []
              }
              canEdit={canEdit && !product.data.product.archivedAt}
              enabled={enabled}
              onReload={reloadProductData}
            />
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
