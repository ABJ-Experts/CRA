"use client";

import {
  createProductInputSchema,
  type CreateProductInput,
  type Product,
  type ProductType,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { SearchInput } from "@repo/ui/input";
import { Tag } from "@repo/ui/tag";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  useCreateProductMutation,
  useProductsQuery,
} from "../../_features/products/products.queries";
import { useLegalEntitiesQuery } from "../../_features/organizations/organizations.queries";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import { PageHeading, SectionCard } from "../../dashboard/_components/dashboard-chrome";

const PRODUCT_TYPES: readonly {
  readonly value: ProductType;
  readonly label: string;
}[] = [
  { value: "hardware_with_software", label: "Hardware with software" },
  { value: "standalone_software", label: "Standalone software" },
  { value: "component", label: "Component" },
  { value: "remote_data_processing", label: "Remote data processing" },
];

type CreateDraft = Omit<CreateProductInput, "idempotencyKey">;
type FieldErrors = Readonly<Partial<Record<keyof CreateDraft, string>>>;

function emptyDraft(ownerId: string, legalEntityId: string): CreateDraft {
  return {
    name: "",
    internalCode: "",
    productType: "standalone_software",
    description: undefined,
    responsibleOwnerId: ownerId,
    legalEntityId,
  };
}

function productTypeLabel(type: ProductType): string {
  return PRODUCT_TYPES.find((item) => item.value === type)?.label ?? type;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 409) {
    return "This record changed in another session. Refresh it before trying again.";
  }
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network") {
    return "We could not reach the registry. Your changes have not been discarded.";
  }
  return fallback;
}

function FieldError({ error }: { error?: string }) {
  return error ? (
    <span className="text-caption-1-regular text-danger">{error}</span>
  ) : null;
}

function ProductCreateForm({
  ownerId,
  legalEntities,
  onCreated,
}: {
  ownerId: string;
  legalEntities: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly status: string;
    readonly completionStatus: string;
  }[];
  onCreated: (product: Product) => void;
}) {
  const defaultEntityId =
    legalEntities.find(
      (entity) =>
        entity.status === "active" && entity.completionStatus === "complete",
    )?.id ?? "";
  const [draft, setDraft] = useState<CreateDraft>(() =>
    emptyDraft(ownerId, defaultEntityId),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const create = useCreateProductMutation();

  useEffect(() => {
    if (draft.legalEntityId === "" && defaultEntityId !== "") {
      setDraft((current) => ({ ...current, legalEntityId: defaultEntityId }));
    }
  }, [defaultEntityId, draft.legalEntityId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const input = {
      ...draft,
      description: draft.description?.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    };
    const parsed = createProductInputSchema.safeParse(input);
    if (!parsed.success) {
      const next = parsed.error.flatten().fieldErrors;
      setErrors({
        name: next.name?.[0],
        internalCode: next.internalCode?.[0],
        productType: next.productType?.[0],
        description: next.description?.[0],
        responsibleOwnerId: next.responsibleOwnerId?.[0],
        legalEntityId: next.legalEntityId?.[0],
      });
      return;
    }

    setErrors({});
    try {
      const response = await create.mutateAsync(parsed.data);
      onCreated(response.product);
    } catch (error) {
      const serverErrors =
        error instanceof ApiClientError ? error.fieldErrors : undefined;
      setErrors({
        name: serverErrors?.name,
        internalCode: serverErrors?.internalCode,
        responsibleOwnerId: serverErrors?.responsibleOwnerId,
        legalEntityId: serverErrors?.legalEntityId,
      });
      setMessage(errorMessage(error, "The product could not be created."));
    }
  }

  return (
    <SectionCard title="Create product">
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Product name
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
          <FieldError error={errors.name} />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Internal code
          <input
            required
            value={draft.internalCode}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                internalCode: event.target.value,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
          <FieldError error={errors.internalCode} />
        </label>
        <label
          className="flex flex-col gap-2 text-caption-1-regular text-fg"
          htmlFor="product-type"
        >
          Product type
          <select
            id="product-type"
            aria-label="Product type"
            value={draft.productType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                productType: event.target.value as ProductType,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            {PRODUCT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex flex-col gap-2 text-caption-1-regular text-fg"
          htmlFor="product-legal-entity"
        >
          Legal entity
          <select
            id="product-legal-entity"
            aria-label="Legal entity"
            required
            value={draft.legalEntityId}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                legalEntityId: event.target.value,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            <option value="">Select a legal entity</option>
            {legalEntities
              .filter(
                (entity) =>
                  entity.status === "active" &&
                  entity.completionStatus === "complete",
              )
              .map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.displayName}
                </option>
              ))}
          </select>
          <FieldError error={errors.legalEntityId} />
        </label>
        <label
          className="flex flex-col gap-2 text-caption-1-regular text-fg"
          htmlFor="product-responsible-owner"
        >
          Responsible owner ID
          <input
            id="product-responsible-owner"
            aria-label="Responsible owner ID"
            required
            value={draft.responsibleOwnerId}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                responsibleOwnerId: event.target.value,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            aria-describedby="product-owner-help"
          />
          <FieldError error={errors.responsibleOwnerId} />
        </label>
        <span
          id="product-owner-help"
          className="text-caption-1-regular text-fg-muted"
        >
          The owner must be an active organization member. Your ID is selected
          by default.
        </span>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
          Description <span className="text-fg-muted">(optional)</span>
          <textarea
            value={draft.description ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            className="min-h-28 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
          />
          <FieldError error={errors.description} />
        </label>
        {message ? (
          <p
            role="alert"
            className="sm:col-span-2 text-subhead-regular text-danger"
          >
            {message}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={create.isPending}
            loadingLabel="Creating product"
          >
            Create product
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ProductRow({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: (id: string) => void;
}) {
  return (
    <li className="flex flex-col gap-4 border-b border-border py-5 first:pt-1 last:border-b-0 last:pb-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-headline-semibold text-fg">
            {product.name}
          </p>
          <Tag variant="fill" tone="indigo" size="sm">
            {productTypeLabel(product.productType)}
          </Tag>
          {product.archivedAt ? (
            <Tag variant="fill" tone="red" size="sm">
              Archived
            </Tag>
          ) : null}
        </div>
        <p className="text-caption-1-regular text-fg-muted">
          {product.internalCode} · {product.legalEntity.legalName}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="text-caption-1-semibold tabular-nums text-fg">
          {product.releaseCount}{" "}
          {product.releaseCount === 1 ? "release" : "releases"}
        </span>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          endIcon={<ArrowUpRight aria-hidden="true" />}
          aria-label={`Open product ${product.name}`}
          onClick={() => onOpen(product.id)}
        >
          Open
        </Button>
      </div>
    </li>
  );
}

/** Production M2 list, intentionally independent of `/api/products` mocks. */
export function ProductsRegistryContent() {
  const router = useRouter();
  const mocksReady = useMocksReady();
  const { session, permissions, isLoading: sessionLoading } = useSession();
  const liveApiEnabled =
    mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const hasMembership = (session?.organizations.length ?? 0) > 0;
  const canView = permissions.can_view_products === true;
  const canCreate = permissions.can_create_products === true;
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const products = useProductsQuery(
    { page: 1, pageSize: 25, q: search.trim() || undefined, archived },
    liveApiEnabled && hasMembership && canView,
  );
  const entities = useLegalEntitiesQuery(
    liveApiEnabled && hasMembership && canCreate,
  );
  const activeEntities = useMemo(
    () => entities.data?.legalEntities ?? [],
    [entities.data?.legalEntities],
  );
  const productCount = products.data?.products.total ?? 0;
  const countLabel = `${productCount} ${productCount === 1 ? "product" : "products"} in this registry`;
  const registrySummary = products.isPending ? (
    <p className="text-caption-1-semibold text-fg">Loading registry…</p>
  ) : products.data ? (
    <p
      aria-live="polite"
      className="text-caption-1-semibold tabular-nums text-fg"
    >
      {countLabel}
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title="Products"
        subtitle="Authoritative products and releases for the active organization."
        actions={
          canCreate ? (
            <Button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
            >
              {showCreate ? "Close form" : "Create product"}
            </Button>
          ) : undefined
        }
      />
      {!liveApiEnabled ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Products are available when the live backend is enabled.
          </p>
        </SectionCard>
      ) : !hasMembership ? (
        <SectionCard>
          <p className="text-subhead-regular text-fg-muted">
            Create or join an organization before managing products.
          </p>
        </SectionCard>
      ) : sessionLoading ? (
        <SectionCard>
          <p role="status" className="text-subhead-regular text-fg-muted">
            Loading products…
          </p>
        </SectionCard>
      ) : !canView ? (
        <SectionCard>
          <p role="alert" className="text-subhead-regular text-danger">
            You do not have permission to view products.
          </p>
        </SectionCard>
      ) : (
        <>
          {showCreate ? (
            <ProductCreateForm
              ownerId={session?.user.id ?? ""}
              legalEntities={activeEntities}
              onCreated={(product) =>
                router.push(`/products/${product.id}`)
              }
            />
          ) : null}
          <SectionCard title="Product registry" action={registrySummary}>
            <div className="mb-6 flex flex-col gap-3 border-b border-border pb-5 lg:flex-row lg:items-center lg:justify-between">
              <SearchInput
                aria-label="Search products"
                value={search}
                onValueChange={setSearch}
                placeholder="Search name or internal code"
                clearable
                wrapperClassName="max-w-xl"
              />
              <Checkbox
                checked={archived}
                onCheckedChange={(value) => setArchived(value === true)}
                label="Include archived products"
                wrapperClassName="shrink-0"
              />
            </div>
            {products.isPending ? (
              <p role="status" className="text-subhead-regular text-fg-muted">
                Loading products…
              </p>
            ) : products.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="text-subhead-regular text-danger">
                  {errorMessage(
                    products.error,
                    "Products could not be loaded.",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void products.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : products.data?.products.rows.length === 0 ? (
              <p className="text-subhead-regular text-fg-muted">
                {search || archived
                  ? "No products match these filters."
                  : "No products have been created yet."}
              </p>
            ) : (
              <ul aria-label="Products">
                {products.data?.products.rows.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    onOpen={(id) => router.push(`/products/${id}`)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
