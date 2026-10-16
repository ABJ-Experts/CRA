import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  productOwnerOptionsResponseSchema,
  type ProductOwnerOptionsQuery,
  type ProductOwnerOption,
} from "@repo/contracts/products";
import { SupabaseService } from "../../supabase/supabase.service";
import type { ProductOwnerDirectory } from "../application/product-owner-options";
const projection = "users!inner(id,first_name,last_name,username)";
@Injectable()
export class SupabaseProductOwnerDirectory implements ProductOwnerDirectory {
  constructor(private readonly supabase: SupabaseService) {}
  async list(orgId: string, query: ProductOwnerOptionsQuery) {
    const base = () =>
      this.supabase
        .admin()
        .from("organization_members")
        .select(projection, { count: "exact" })
        .eq("organization_id", orgId)
        .eq("users.is_active", true);
    const { data, error, count } = await base()
      .order("user_id", { ascending: true })
      .range(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize - 1,
      );
    if (error)
      throw new ServiceUnavailableException(
        "Responsible owners are temporarily unavailable.",
      );
    const rows = (data ?? []).map((row) => this.option(row.users));
    let selectedOwner: ProductOwnerOption | null =
      rows.find((row) => row.id === query.selectedOwnerId) ?? null;
    if (query.selectedOwnerId && !selectedOwner) {
      const selected = await base()
        .eq("user_id", query.selectedOwnerId)
        .maybeSingle();
      if (selected.error)
        throw new ServiceUnavailableException(
          "Responsible owners are temporarily unavailable.",
        );
      selectedOwner = selected.data ? this.option(selected.data.users) : null;
    }
    return productOwnerOptionsResponseSchema.parse({
      owners: {
        rows,
        total: count ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        pageCount: Math.max(1, Math.ceil((count ?? 0) / query.pageSize)),
      },
      selectedOwner,
    });
  }
  async ownerForProduct(
    orgId: string,
    productId: string,
  ): Promise<ProductOwnerOption | null> {
    const product = await this.supabase
      .admin()
      .from("products")
      .select("responsible_owner_id")
      .eq("organization_id", orgId)
      .eq("id", productId)
      .maybeSingle();
    if (product.error)
      throw new ServiceUnavailableException(
        "Responsible owners are temporarily unavailable.",
      );
    if (!product.data) return null;
    const owner = await this.supabase
      .admin()
      .from("organization_members")
      .select(projection)
      .eq("organization_id", orgId)
      .eq("user_id", product.data.responsible_owner_id)
      .eq("users.is_active", true)
      .maybeSingle();
    if (owner.error)
      throw new ServiceUnavailableException(
        "Responsible owners are temporarily unavailable.",
      );
    return owner.data ? this.option(owner.data.users) : null;
  }
  private option(user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
  }): ProductOwnerOption {
    return {
      id: user.id,
      displayName: (
        [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
        user.username ||
        `Member ${user.id.slice(0, 8)}`
      ).slice(0, 300),
    };
  }
}
