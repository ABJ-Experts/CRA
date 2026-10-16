-- Keep M2 V2 tables aligned with the repository-wide updated_at trigger
-- invariant enforced by infrastructure/tests/rls.test.sql.

drop trigger if exists m2_v2_set_assessment_updated_at
  on public.product_substantial_modification_assessments;
create trigger m2_v2_set_assessment_updated_at
before update on public.product_substantial_modification_assessments
for each row execute function public.set_updated_at();

drop trigger if exists m2_v2_set_security_update_artifact_updated_at
  on public.product_security_update_artifacts;
create trigger m2_v2_set_security_update_artifact_updated_at
before update on public.product_security_update_artifacts
for each row execute function public.set_updated_at();
