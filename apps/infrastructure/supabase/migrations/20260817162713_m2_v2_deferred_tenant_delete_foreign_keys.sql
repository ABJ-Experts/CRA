-- M2 evidence remains retained/append-only in normal operation. These are
-- deliberately deferred NO ACTION references so a permitted organization
-- purge can cascade every tenant row in one transaction, regardless of the
-- order PostgreSQL visits product, release, legal-entity, support-period, and
-- revision rows. Direct legal-entity, product, and release deletes still fail
-- when the transaction commits.

alter table public.products
  drop constraint if exists products_organization_id_legal_entity_id_fkey,
  add constraint products_organization_id_legal_entity_id_fkey
    foreign key (organization_id, legal_entity_id)
    references public.organization_legal_entities(organization_id, id)
    on delete no action deferrable initially deferred;

alter table public.product_releases
  drop constraint if exists product_releases_organization_id_product_id_fkey,
  drop constraint if exists product_releases_organization_id_legal_entity_id_fkey,
  add constraint product_releases_organization_id_product_id_fkey
    foreign key (organization_id, product_id)
    references public.products(organization_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_releases_organization_id_legal_entity_id_fkey
    foreign key (organization_id, legal_entity_id)
    references public.organization_legal_entities(organization_id, id)
    on delete no action deferrable initially deferred;

-- Releases are tenant-owned even though their original product composite FK is
-- the normal ownership path. The explicit tenant cascade only runs when the
-- whole tenant is deleted; direct product deletion remains NO ACTION-deferred.
alter table public.product_releases
  add constraint product_releases_organization_id_fkey
    foreign key (organization_id)
    references public.organizations(id) on delete cascade;

alter table public.product_support_periods
  drop constraint if exists product_support_periods_organization_id_product_id_release_fkey,
  drop constraint if exists product_support_periods_organization_id_superseded_by_id_fkey,
  add constraint product_support_periods_organization_id_product_id_release_fkey
    foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_support_periods_organization_id_superseded_by_id_fkey
    foreign key (organization_id, superseded_by_id)
    references public.product_support_periods(organization_id, id)
    on delete no action deferrable initially deferred;

alter table public.product_regulatory_outbox_events
  drop constraint if exists product_regulatory_outbox_support_period_fk,
  add constraint product_regulatory_outbox_support_period_fk
    foreign key (organization_id, support_period_id)
    references public.product_support_periods(organization_id, id)
    on delete no action deferrable initially deferred;

alter table public.product_substantial_modification_assessments
  drop constraint if exists product_substantial_modification_assessment_product_fkey,
  drop constraint if exists product_substantial_modificat_organization_id_product_id_s_fkey,
  drop constraint if exists product_substantial_modifica_organization_id_product_id_s_fkey1,
  add constraint product_substantial_modification_assessment_product_fkey
    foreign key (organization_id, product_id)
    references public.products(organization_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_substantial_modification_assessment_supersedes_fkey
    foreign key (organization_id, product_id, supersedes_id)
    references public.product_substantial_modification_assessments(organization_id, product_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_substantial_modification_assessment_superseded_by_fkey
    foreign key (organization_id, product_id, superseded_by_id)
    references public.product_substantial_modification_assessments(organization_id, product_id, id)
    on delete no action deferrable initially deferred;

alter table public.product_substantial_modification_releases
  drop constraint if exists product_substantial_modification_release_assessment_product_fke,
  drop constraint if exists product_substantial_modification_release_product_release_fkey,
  add constraint product_substantial_modification_release_assessment_product_fkey
    foreign key (organization_id, product_id, assessment_id)
    references public.product_substantial_modification_assessments(organization_id, product_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_substantial_modification_release_product_release_fkey
    foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id)
    on delete no action deferrable initially deferred;

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_product_release_fkey,
  drop constraint if exists product_security_update_artif_organization_id_support_peri_fkey,
  drop constraint if exists product_security_update_artifact_replacement_release_fkey,
  add constraint product_security_update_artifact_product_release_fkey
    foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_security_update_artifact_support_period_fkey
    foreign key (organization_id, support_period_id)
    references public.product_support_periods(organization_id, id)
    on delete no action deferrable initially deferred,
  add constraint product_security_update_artifact_replacement_release_fkey
    foreign key (organization_id, product_id, release_id, replacement_artifact_id)
    references public.product_security_update_artifacts(organization_id, product_id, release_id, id)
    on delete no action deferrable initially deferred;
