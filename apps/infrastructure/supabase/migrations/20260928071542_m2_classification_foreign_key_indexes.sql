-- Keep referenced-user and exact predecessor FK checks bounded as history grows.
-- Existing latest/revision and actor-idempotency indexes remain unchanged.
create index product_classification_runs_created_by_idx
  on public.product_classification_runs(created_by);
create index product_classification_runs_supersedes_idx
  on public.product_classification_runs(organization_id,product_id,supersedes_id);
