-- Keep the compliance-history metadata consistent with the repository-wide
-- updated_at invariant. The support-period mutation RPCs remain the only
-- service-role write boundary.

drop trigger if exists set_product_support_periods_updated_at on public.product_support_periods;

create trigger set_product_support_periods_updated_at
before update on public.product_support_periods
for each row execute function public.set_updated_at();
