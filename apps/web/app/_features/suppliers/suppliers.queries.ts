"use client";

import type {
  ArchiveSupplierContactInput,
  ArchiveSupplierInput,
  AssociateSupplierRequestInput,
  CreateSupplierContactInput,
  CreateSupplierInput,
  CreateSupplierResponsibilityInput,
  EndSupplierResponsibilityInput,
  SupplierListQuery,
  UpdateSupplierContactInput,
  UpdateSupplierInput,
} from "@repo/contracts/suppliers";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { suppliersApi } from "./suppliers.api";
import { supplierKeys } from "./suppliers.keys";

function queryKey(query: Partial<SupplierListQuery>): string {
  return JSON.stringify(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

export function useSuppliersQuery(
  query: Partial<SupplierListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: supplierKeys.list(queryKey(query)),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => suppliersApi.list(query, signal),
  });
}

export function useSupplierQuery(supplierId: string | null, enabled: boolean) {
  return useQuery({
    queryKey:
      supplierId === null
        ? supplierKeys.details
        : supplierKeys.detail(supplierId),
    enabled: enabled && supplierId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (supplierId === null)
        throw new Error("A supplier identifier is required.");
      return suppliersApi.detail(supplierId, signal);
    },
  });
}

export function useFindingResponsibleSuppliersQuery(
  findingId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      findingId === null
        ? supplierKeys.findingResponsibilities
        : supplierKeys.findingResponsibility(findingId),
    enabled: enabled && findingId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (findingId === null)
        throw new Error("A finding identifier is required.");
      return suppliersApi.resolveFinding(findingId, signal);
    },
  });
}

function useInvalidateSuppliers() {
  const client = useQueryClient();
  return (supplierId?: string) => {
    void client.invalidateQueries({ queryKey: supplierKeys.lists });
    if (supplierId !== undefined)
      void client.invalidateQueries({
        queryKey: supplierKeys.detail(supplierId),
      });
  };
}

export function useCreateSupplierMutation() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: CreateSupplierInput) => suppliersApi.create(input),
    onSuccess: () => invalidate(),
  });
}
export function useUpdateSupplierMutation(supplierId: string) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: UpdateSupplierInput) =>
      suppliersApi.update(supplierId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useArchiveSupplierMutation(supplierId: string) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: ArchiveSupplierInput) =>
      suppliersApi.archive(supplierId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useCreateSupplierContactMutation(supplierId: string) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: CreateSupplierContactInput) =>
      suppliersApi.createContact(supplierId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useUpdateSupplierContactMutation(
  supplierId: string,
  contactId: string,
) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: UpdateSupplierContactInput) =>
      suppliersApi.updateContact(supplierId, contactId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useArchiveSupplierContactMutation(
  supplierId: string,
  contactId: string,
) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: ArchiveSupplierContactInput) =>
      suppliersApi.archiveContact(supplierId, contactId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useCreateSupplierResponsibilityMutation(supplierId: string) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: CreateSupplierResponsibilityInput) =>
      suppliersApi.createResponsibility(supplierId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useEndSupplierResponsibilityMutation(
  supplierId: string,
  responsibilityId: string,
) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: EndSupplierResponsibilityInput) =>
      suppliersApi.endResponsibility(supplierId, responsibilityId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
export function useAssociateSupplierRequestMutation(
  supplierId: string,
  requestId: string,
) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (input: AssociateSupplierRequestInput) =>
      suppliersApi.associateRequest(supplierId, requestId, input),
    onSuccess: () => invalidate(supplierId),
  });
}
