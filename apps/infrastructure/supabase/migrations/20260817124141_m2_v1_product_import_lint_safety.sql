-- pg_column_size is STABLE, so the row-issue validator must not overstate its
-- volatility. The check remains deterministic for the value being inserted.
alter function public.product_import_issues_are_safe(jsonb) stable;
