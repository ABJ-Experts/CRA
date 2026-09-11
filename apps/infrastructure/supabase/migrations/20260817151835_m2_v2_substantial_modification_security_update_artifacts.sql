-- M2 V2 substantial-modification assessments and CRA Article 13(9) security
-- update artifacts. This migration is additive: durable history remains in the
-- three tables below, audit_logs, lifecycle facts, and the existing outbox.

create or replace function public.m2_v2_valid_assessment_answers(p_answers jsonb)
returns boolean language sql immutable strict set search_path = public, pg_temp as $$
  select jsonb_typeof(p_answers) = 'object'
    and p_answers ?& array[
      'changesIntendedPurpose',
      'changesSecurityArchitectureOrTrustBoundary',
      'changesNetworkInterfaceOrPrivilegedRemoteControl',
      'changesCryptographyOrIdentityAccessControl',
      'changesSafetyOrSecurityRelevantComponent'
    ]
    and (select count(*) from jsonb_object_keys(p_answers)) = 5
    and not exists (
      select 1 from jsonb_each_text(p_answers) answer
      where answer.key not in (
        'changesIntendedPurpose',
        'changesSecurityArchitectureOrTrustBoundary',
        'changesNetworkInterfaceOrPrivilegedRemoteControl',
        'changesCryptographyOrIdentityAccessControl',
        'changesSafetyOrSecurityRelevantComponent'
      ) or (answer.value is not null and answer.value not in ('yes', 'no', 'unknown'))
    )
$$;

create or replace function public.m2_v2_availability_candidate(p_issued_at timestamptz)
returns timestamptz language sql immutable strict set search_path = public, pg_temp as $$
  select public.m2_retention_placement_candidate(p_issued_at)
$$;

create or replace function public.m2_v2_valid_published_external_references(p_references jsonb)
returns boolean language sql immutable strict set search_path = public, pg_temp as $$
  select jsonb_typeof(p_references) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p_references) reference
      where jsonb_typeof(reference) <> 'object'
        or reference->>'id' !~ '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$'
        or char_length(btrim(coalesce(reference->>'title', ''))) not between 1 and 500
        or coalesce(reference->>'uri', '') !~
          '^https://[^/@?#]+(?:/[^?#]*)?(?:\\?[^#]*)?(?:#.*)?$'
        or reference->>'validationState' <> 'validated_by_server'
        or reference->>'validatedAt' !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
    )
$$;

create table public.product_substantial_modification_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  modification_id uuid not null,
  supersedes_id uuid,
  superseded_at timestamptz,
  superseded_by_id uuid,
  revision integer not null check (revision > 0),
  modification_identifier text check (
    modification_identifier is null or char_length(btrim(modification_identifier)) between 1 and 128
  ),
  title text check (title is null or char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(btrim(description)) between 1 and 4000),
  technical_scope text check (technical_scope is null or char_length(btrim(technical_scope)) between 1 and 8000),
  introduced_at timestamptz,
  detected_or_assessed_at timestamptz,
  previous_state text check (previous_state is null or char_length(btrim(previous_state)) between 1 and 8000),
  resulting_state text check (resulting_state is null or char_length(btrim(resulting_state)) between 1 and 8000),
  required_follow_up_actions jsonb check (
    required_follow_up_actions is null or jsonb_typeof(required_follow_up_actions) = 'array'
  ),
  completeness_state text not null default 'draft' check (completeness_state in ('draft', 'in_progress', 'complete')),
  policy_version text not null default 'm2.v2.substantial-modification.v1'
    check (policy_version = 'm2.v2.substantial-modification.v1'),
  answers jsonb not null default jsonb_build_object(
    'changesIntendedPurpose', null,
    'changesSecurityArchitectureOrTrustBoundary', null,
    'changesNetworkInterfaceOrPrivilegedRemoteControl', null,
    'changesCryptographyOrIdentityAccessControl', null,
    'changesSafetyOrSecurityRelevantComponent', null
  ) check (public.m2_v2_valid_assessment_answers(answers)),
  rationale text check (rationale is null or char_length(btrim(rationale)) between 1 and 4000),
  evidence_references jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_references) = 'array'),
  policy_suggestion text check (policy_suggestion is null or policy_suggestion in (
    'undetermined', 'not_substantial', 'potentially_substantial'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'in_progress', 'submitted_for_review', 'reviewed', 'superseded'
  )),
  determination text check (determination is null or determination in (
    'undetermined', 'not_substantial', 'potentially_substantial', 'substantial'
  )),
  review_rationale text,
  override_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete restrict,
  idempotency_key uuid,
  idempotency_request_digest text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, product_id, id),
  unique (organization_id, modification_id, revision),
  constraint product_substantial_modification_assessment_product_fkey
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, product_id, supersedes_id)
    references public.product_substantial_modification_assessments(organization_id, product_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (organization_id, product_id, superseded_by_id)
    references public.product_substantial_modification_assessments(organization_id, product_id, id)
    on delete restrict deferrable initially deferred,
  constraint product_substantial_modification_assessment_supersession_pair_check
    check ((superseded_at is null) = (superseded_by_id is null)),
  constraint product_substantial_modification_assessment_review_pair_check
    check (
      (status in ('draft', 'in_progress', 'submitted_for_review') and determination is null and review_rationale is null
        and override_reason is null
        and reviewed_at is null and reviewed_by is null)
      or (status = 'reviewed' and determination is not null
        and char_length(btrim(review_rationale)) between 1 and 4000
        and (override_reason is null or char_length(btrim(override_reason)) between 1 and 1000)
        and reviewed_at is not null and reviewed_by is not null)
      or (status = 'superseded')
    ),
  constraint product_substantial_modification_assessment_idempotency_check
    check (
      (idempotency_key is null and idempotency_request_digest is null)
      or (idempotency_key is not null and idempotency_request_digest ~ '^[a-f0-9]{64}$')
    )
);

create table public.product_substantial_modification_releases (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null,
  product_id uuid not null,
  release_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  primary key (organization_id, assessment_id, release_id),
  constraint product_substantial_modification_release_assessment_product_fkey
    foreign key (organization_id, product_id, assessment_id)
    references public.product_substantial_modification_assessments(organization_id, product_id, id)
    on delete restrict,
  constraint product_substantial_modification_release_product_release_fkey
    foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id)
    on delete restrict
);

create table public.product_security_update_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  release_id uuid not null,
  support_period_id uuid,
  support_period_revision integer check (support_period_revision is null or support_period_revision > 0),
  update_version text not null check (char_length(btrim(update_version)) between 1 and 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  artifact_type text not null check (artifact_type in (
    'software_update', 'firmware_update', 'security_advisory'
  )),
  supported_platform text not null check (char_length(btrim(supported_platform)) between 1 and 500),
  signature_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(signature_metadata) = 'object'),
  distribution_kind text not null default 'authenticated_download' check (distribution_kind in (
    'authenticated_download', 'external_reference'
  )),
  distribution_reference text,
  published_external_references jsonb not null default '[]'::jsonb
    check (jsonb_typeof(published_external_references) = 'array'),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  content_type text not null check (char_length(btrim(content_type)) between 1 and 255),
  byte_size bigint not null check (byte_size between 1 and 2147483647),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  object_key text check (
    object_key is null or object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-f0-9]{64}$'
  ),
  issued_at timestamptz not null,
  upload_status text not null default 'reserved' check (upload_status in (
    'reserved', 'uploaded', 'finalized', 'missing', 'failed'
  )),
  integrity_status text not null default 'pending' check (integrity_status in (
    'pending', 'verified', 'hash_mismatch', 'type_mismatch', 'corrupt',
    'unavailable', 'provider_unavailable'
  )),
  review_status text not null default 'pending_review' check (review_status in (
    'pending_review', 'cleared', 'rejected'
  )),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete restrict,
  review_reason text,
  publication_status text not null default 'draft' check (publication_status in (
    'draft', 'published', 'replaced', 'withdrawn'
  )),
  published_at timestamptz,
  published_by uuid references public.users(id) on delete restrict,
  availability_status text not null default 'pending' check (availability_status in (
    'pending', 'available', 'blocked', 'expired'
  )),
  availability_rule_version text not null default 'm2.v2.security-update-availability.v1'
    check (availability_rule_version = 'm2.v2.security-update-availability.v1'),
  issued_candidate_at timestamptz,
  support_candidate_at timestamptz,
  availability_winning_rule text check (availability_winning_rule is null or availability_winning_rule in (
    'issued_at_plus_10_calendar_years', 'support_period_end', 'equal'
  )),
  computed_availability_until timestamptz,
  availability_until timestamptz,
  non_reduction_applied boolean not null default false,
  availability_explanation jsonb not null default '{}'::jsonb
    check (jsonb_typeof(availability_explanation) = 'object'),
  replacement_artifact_id uuid,
  replaced_at timestamptz,
  replaced_by uuid references public.users(id) on delete restrict,
  replacement_reason text,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.users(id) on delete restrict,
  withdrawal_reason text,
  cleanup_scheduled_at timestamptz,
  cleanup_scheduled_by uuid references public.users(id) on delete restrict,
  idempotency_key uuid,
  idempotency_request_digest text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, product_id, release_id, id),
  unique (organization_id, object_key),
  unique (organization_id, sha256, object_key),
  constraint product_security_update_artifact_product_release_fkey
  foreign key (organization_id, product_id, release_id)
    references public.product_releases(organization_id, product_id, id)
    on delete restrict,
  foreign key (organization_id, support_period_id)
    references public.product_support_periods(organization_id, id)
    on delete restrict,
  constraint product_security_update_artifact_replacement_release_fkey
    foreign key (organization_id, product_id, release_id, replacement_artifact_id)
    references public.product_security_update_artifacts(organization_id, product_id, release_id, id)
    on delete restrict,
  constraint product_security_update_artifact_support_period_pair_check check (
    (support_period_id is null) = (support_period_revision is null)
  ),
  constraint product_security_update_artifact_distribution_check check (
    (distribution_kind = 'authenticated_download' and object_key is not null
      and distribution_reference is null
      and jsonb_array_length(published_external_references) = 0)
    or (distribution_kind = 'external_reference' and object_key is null
      and distribution_reference is not null
      and distribution_reference ~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$'
      and distribution_reference !~* '(signature|token|x-amz-)'
      and jsonb_array_length(published_external_references) > 0
      and public.m2_v2_valid_published_external_references(published_external_references))
  ),
  constraint product_security_update_artifact_review_pair_check check (
    (review_status = 'pending_review' and reviewed_at is null and reviewed_by is null and review_reason is null)
    or (review_status in ('cleared', 'rejected') and reviewed_at is not null and reviewed_by is not null
      and char_length(btrim(review_reason)) between 1 and 1000)
  ),
  constraint product_security_update_artifact_publication_pair_check check (
    (publication_status = 'draft' and published_at is null and published_by is null)
    or (publication_status in ('published', 'replaced', 'withdrawn') and published_at is not null and published_by is not null)
  ),
  constraint product_security_update_artifact_replacement_pair_check check (
    (replacement_artifact_id is null and replaced_at is null and replaced_by is null and replacement_reason is null)
    or (replacement_artifact_id is not null and replaced_at is not null and replaced_by is not null
      and char_length(btrim(replacement_reason)) between 1 and 1000)
  ),
  constraint product_security_update_artifact_withdrawal_pair_check check (
    (withdrawn_at is null and withdrawn_by is null and withdrawal_reason is null)
    or (withdrawn_at is not null and withdrawn_by is not null
      and char_length(btrim(withdrawal_reason)) between 1 and 1000)
  ),
  constraint product_security_update_artifact_idempotency_check check (
    (idempotency_key is null and idempotency_request_digest is null)
    or (idempotency_key is not null and idempotency_request_digest ~ '^[a-f0-9]{64}$')
  )
);

create unique index product_substantial_modification_assessment_active_modification_key
  on public.product_substantial_modification_assessments(organization_id, product_id, modification_id)
  where superseded_at is null;
create unique index product_substantial_modification_assessment_actor_idempotency_key
  on public.product_substantial_modification_assessments(organization_id, created_by, idempotency_key)
  where idempotency_key is not null;
create index product_substantial_modification_assessment_history_idx
  on public.product_substantial_modification_assessments(organization_id, product_id, created_at desc, id desc);
create index product_substantial_modification_release_release_idx
  on public.product_substantial_modification_releases(organization_id, product_id, release_id, assessment_id);
create unique index product_security_update_artifact_actor_idempotency_key
  on public.product_security_update_artifacts(organization_id, created_by, idempotency_key)
  where idempotency_key is not null;
create index product_security_update_artifact_release_idx
  on public.product_security_update_artifacts(organization_id, product_id, release_id, created_at desc, id desc);
create index product_security_update_artifact_availability_idx
  on public.product_security_update_artifacts(organization_id, availability_until, id)
  where publication_status = 'published';
create index product_security_update_artifact_support_idx
  on public.product_security_update_artifacts(organization_id, support_period_id, id);

alter table public.product_substantial_modification_assessments enable row level security;
alter table public.product_substantial_modification_releases enable row level security;
alter table public.product_security_update_artifacts enable row level security;

revoke all on table
  public.product_substantial_modification_assessments,
  public.product_substantial_modification_releases,
  public.product_security_update_artifacts
from public, anon, authenticated;
revoke all on table
  public.product_substantial_modification_assessments,
  public.product_substantial_modification_releases,
  public.product_security_update_artifacts
from service_role;
grant select, insert on table public.product_substantial_modification_assessments to service_role;
grant update (
  status, determination, review_rationale, override_reason, reviewed_at, reviewed_by,
  superseded_at, superseded_by_id, version, updated_at, updated_by
) on table public.product_substantial_modification_assessments to service_role;
grant select, insert on table public.product_substantial_modification_releases to service_role;
grant select, insert on table public.product_security_update_artifacts to service_role;
grant update (
  support_period_id, support_period_revision, upload_status, integrity_status,
  review_status, reviewed_at, reviewed_by,
  review_reason, publication_status, published_at, published_by, availability_status,
  issued_candidate_at, support_candidate_at, availability_winning_rule,
  computed_availability_until, availability_until, non_reduction_applied,
  availability_explanation, replacement_artifact_id, replaced_at, replaced_by,
  replacement_reason, withdrawn_at, withdrawn_by, withdrawal_reason,
  cleanup_scheduled_at, cleanup_scheduled_by, version, updated_at, updated_by
) on table public.product_security_update_artifacts to service_role;

insert into public.retention_evidence_classes(identifier, default_requested_retention_days)
values ('security_update_artifact', 0)
on conflict(identifier) do update set enabled = true;
insert into public.organization_retention_policies(
  organization_id, evidence_class, requested_retention_days, effective_retention_days
)
select organizations.id, classes.identifier,
  classes.default_requested_retention_days, classes.default_requested_retention_days
from public.organizations organizations
join public.retention_evidence_classes classes on classes.identifier = 'security_update_artifact'
on conflict(organization_id, evidence_class) do nothing;
insert into public.evidence_protection_watermarks(organization_id, evidence_class)
select organizations.id, 'security_update_artifact'
from public.organizations organizations
on conflict(organization_id, evidence_class) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('security-update-artifacts', 'security-update-artifacts', false, 2147483647, null)
on conflict(id) do update set public = false, file_size_limit = 2147483647,
  allowed_mime_types = null;

create or replace function public.m2_v2_assessment_json(
  p_assessment public.product_substantial_modification_assessments
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_assessment.id,
    'organizationId', p_assessment.organization_id,
    'productId', p_assessment.product_id,
    'modificationId', p_assessment.modification_id,
    'supersedesId', p_assessment.supersedes_id,
    'modificationIdentifier', p_assessment.modification_identifier,
    'title', p_assessment.title,
    'description', p_assessment.description,
    'technicalScope', p_assessment.technical_scope,
    'introducedAt', case when p_assessment.introduced_at is null then null
      else public.m2_utc_z(p_assessment.introduced_at) end,
    'detectedOrAssessedAt', case when p_assessment.detected_or_assessed_at is null then null
      else public.m2_utc_z(p_assessment.detected_or_assessed_at) end,
    'previousState', p_assessment.previous_state,
    'resultingState', p_assessment.resulting_state,
    'requiredFollowUpActions', p_assessment.required_follow_up_actions,
    'completenessState', p_assessment.completeness_state,
    'releaseIds', coalesce((
      select jsonb_agg(joins.release_id order by joins.release_id)
      from public.product_substantial_modification_releases joins
      where joins.organization_id = p_assessment.organization_id
        and joins.assessment_id = p_assessment.id
    ), '[]'::jsonb),
    'policyVersion', p_assessment.policy_version,
    'answers', p_assessment.answers,
    'rationale', p_assessment.rationale,
    'evidenceReferences', p_assessment.evidence_references,
    'suggestion', p_assessment.policy_suggestion,
    'status', p_assessment.status,
    'determination', p_assessment.determination,
    'determinationRationale', p_assessment.review_rationale,
    'overrideReason', p_assessment.override_reason,
    'reviewedAt', case when p_assessment.reviewed_at is null then null
      else public.m2_utc_z(p_assessment.reviewed_at) end,
    'reviewedBy', p_assessment.reviewed_by,
    'version', p_assessment.version,
    'createdAt', public.m2_utc_z(p_assessment.created_at),
    'createdBy', p_assessment.created_by,
    'updatedAt', public.m2_utc_z(p_assessment.updated_at),
    'updatedBy', p_assessment.updated_by
  )
$$;

create or replace function public.m2_v2_security_update_artifact_json(
  p_artifact public.product_security_update_artifacts,
  p_include_object_key boolean default false
) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_artifact.id,
    'organizationId', p_artifact.organization_id,
    'productId', p_artifact.product_id,
    'releaseId', p_artifact.release_id,
    'supportPeriodId', p_artifact.support_period_id,
    'supportPeriodRevision', p_artifact.support_period_revision,
    'supportEndsAt', (
      select public.m2_utc_z(period.support_ends_at)
      from public.product_support_periods period
      where period.organization_id = p_artifact.organization_id
        and period.id = p_artifact.support_period_id
    ),
    'updateVersion', p_artifact.update_version,
    'title', p_artifact.title,
    'artifactType', p_artifact.artifact_type,
    'supportedPlatform', p_artifact.supported_platform,
    'signatureMetadata', case when p_artifact.signature_metadata = '{}'::jsonb then null
      else p_artifact.signature_metadata end,
    'distributionKind', p_artifact.distribution_kind,
    'distributionReference', case when p_artifact.distribution_reference is null then null else (
      select reference from jsonb_array_elements(p_artifact.published_external_references) reference
      where reference->>'uri' = p_artifact.distribution_reference
      limit 1
    ) end,
    'publishedExternalReferences', p_artifact.published_external_references,
    'fileName', p_artifact.file_name,
    'contentType', p_artifact.content_type,
    'byteSize', p_artifact.byte_size,
    'sha256', p_artifact.sha256,
    'issuedAt', public.m2_utc_z(p_artifact.issued_at),
    'uploadStatus', p_artifact.upload_status,
    'integrityStatus', p_artifact.integrity_status,
    'reviewStatus', p_artifact.review_status,
    'publicationStatus', p_artifact.publication_status,
    'availabilityStatus', p_artifact.availability_status,
    'availabilityRuleVersion', p_artifact.availability_rule_version,
    'issuedCandidate', case when p_artifact.issued_candidate_at is null then null
      else public.m2_utc_z(p_artifact.issued_candidate_at) end,
    'supportCandidate', case when p_artifact.support_candidate_at is null then null
      else public.m2_utc_z(p_artifact.support_candidate_at) end,
    'availabilityWinningRule', p_artifact.availability_winning_rule,
    'computedAvailabilityUntil', case when p_artifact.computed_availability_until is null then null
      else public.m2_utc_z(p_artifact.computed_availability_until) end,
    'availabilityUntil', case when p_artifact.availability_until is null then null
      else public.m2_utc_z(p_artifact.availability_until) end,
    'nonReductionApplied', p_artifact.non_reduction_applied,
    'statusExplanation', case
      when p_artifact.publication_status = 'withdrawn' then
        jsonb_build_object('code', 'withdrawn', 'message', 'This security update has been withdrawn.')
      when p_artifact.integrity_status = 'provider_unavailable' then
        jsonb_build_object('code', 'provider_unavailable', 'message', 'Integrity verification is temporarily unavailable.')
      when p_artifact.upload_status = 'reserved' then
        jsonb_build_object('code', 'awaiting_upload', 'message', 'The artifact upload is awaiting completion.')
      when p_artifact.integrity_status in ('hash_mismatch', 'type_mismatch', 'corrupt', 'unavailable') then
        jsonb_build_object('code', 'integrity_check_failed', 'message', 'The artifact did not pass integrity verification.')
      when p_artifact.integrity_status = 'pending' then
        jsonb_build_object('code', 'awaiting_integrity_check', 'message', 'The artifact is awaiting integrity verification.')
      when p_artifact.review_status = 'rejected' then
        jsonb_build_object('code', 'review_rejected', 'message', 'The artifact was rejected during review.')
      when p_artifact.review_status = 'pending_review' then
        jsonb_build_object('code', 'awaiting_approval', 'message', 'The artifact is awaiting approval.')
      when p_artifact.availability_status = 'blocked' then
        jsonb_build_object('code', 'support_period_missing', 'message', 'A current support period is required before publication.')
      else null
    end,
    'replacementArtifactId', p_artifact.replacement_artifact_id,
    'withdrawnAt', case when p_artifact.withdrawn_at is null then null
      else public.m2_utc_z(p_artifact.withdrawn_at) end,
    'withdrawnReason', p_artifact.withdrawal_reason,
    'version', p_artifact.version,
    'createdAt', public.m2_utc_z(p_artifact.created_at),
    'createdBy', p_artifact.created_by,
    'updatedAt', public.m2_utc_z(p_artifact.updated_at),
    'updatedBy', p_artifact.updated_by
  ) || case when p_include_object_key then jsonb_build_object('objectKey', p_artifact.object_key)
    else '{}'::jsonb end
$$;

create or replace function public.m2_v2_guard_assessment_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.completeness_state = 'complete'
     and not public.m2_v2_assessment_payload_complete(
       new.modification_identifier, new.title, new.description, new.technical_scope,
       new.introduced_at, new.detected_or_assessed_at, new.previous_state,
       new.resulting_state, new.required_follow_up_actions, new.answers, new.rationale
     ) then
    raise exception 'complete assessments require all narrative fields and five answers';
  end if;
  if new.status in ('submitted_for_review', 'reviewed')
     and new.completeness_state <> 'complete' then
    raise exception 'only complete assessments can be submitted or reviewed';
  end if;
  if new.completeness_state = 'complete' and new.policy_suggestion is null then
    raise exception 'complete assessments require a policy suggestion';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if (to_jsonb(new) - array[
    'status', 'determination', 'review_rationale', 'override_reason', 'reviewed_at', 'reviewed_by',
    'superseded_at', 'superseded_by_id', 'version', 'updated_at', 'updated_by'
  ]) is distinct from (to_jsonb(old) - array[
    'status', 'determination', 'review_rationale', 'override_reason', 'reviewed_at', 'reviewed_by',
    'superseded_at', 'superseded_by_id', 'version', 'updated_at', 'updated_by'
  ]) then
    raise exception 'substantial modification assessment content is immutable';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'substantial modification assessment version must advance by one';
  end if;
  if new.status = 'reviewed' and old.status <> 'submitted_for_review' then
    raise exception 'assessment review is final';
  end if;
  if new.status = 'superseded' and old.status = 'superseded' then
    raise exception 'assessment is already superseded';
  end if;
  if new.status not in ('reviewed', 'superseded') then
    raise exception 'invalid assessment state transition';
  end if;
  if new.superseded_by_id = new.id then
    raise exception 'assessment cannot supersede itself';
  end if;
  return new;
end;
$$;

create or replace function public.m2_v2_guard_security_update_artifact_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array[
    'support_period_id', 'support_period_revision', 'upload_status', 'integrity_status', 'review_status', 'reviewed_at', 'reviewed_by',
    'review_reason', 'publication_status', 'published_at', 'published_by',
    'availability_status', 'issued_candidate_at', 'support_candidate_at',
    'availability_winning_rule', 'computed_availability_until', 'availability_until',
    'non_reduction_applied', 'availability_explanation', 'replacement_artifact_id',
    'replaced_at', 'replaced_by', 'replacement_reason', 'withdrawn_at', 'withdrawn_by',
    'withdrawal_reason', 'cleanup_scheduled_at', 'cleanup_scheduled_by', 'version',
    'updated_at', 'updated_by'
  ]) is distinct from (to_jsonb(old) - array[
    'support_period_id', 'support_period_revision', 'upload_status', 'integrity_status', 'review_status', 'reviewed_at', 'reviewed_by',
    'review_reason', 'publication_status', 'published_at', 'published_by',
    'availability_status', 'issued_candidate_at', 'support_candidate_at',
    'availability_winning_rule', 'computed_availability_until', 'availability_until',
    'non_reduction_applied', 'availability_explanation', 'replacement_artifact_id',
    'replaced_at', 'replaced_by', 'replacement_reason', 'withdrawn_at', 'withdrawn_by',
    'withdrawal_reason', 'cleanup_scheduled_at', 'cleanup_scheduled_by', 'version',
    'updated_at', 'updated_by'
  ]) then
    raise exception 'security update artifact content identity is immutable';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'security update artifact version must advance by one';
  end if;
  if new.availability_until is not null and old.availability_until is not null
     and new.availability_until < old.availability_until then
    raise exception 'security update availability cannot be reduced';
  end if;
  if new.replacement_artifact_id = new.id then
    raise exception 'security update artifact cannot replace itself';
  end if;
  return new;
end;
$$;

create trigger m2_v2_guard_assessment_update
before insert or update on public.product_substantial_modification_assessments
for each row execute function public.m2_v2_guard_assessment_update();
create trigger m2_v2_set_assessment_updated_at
before update on public.product_substantial_modification_assessments
for each row execute function public.set_updated_at();
create trigger m2_v2_guard_security_update_artifact_update
before update on public.product_security_update_artifacts
for each row execute function public.m2_v2_guard_security_update_artifact_update();
create trigger m2_v2_set_security_update_artifact_updated_at
before update on public.product_security_update_artifacts
for each row execute function public.set_updated_at();

alter table public.product_lifecycle_dependency_facts
  drop constraint if exists product_lifecycle_dependency_facts_authority_kind_check,
  add constraint product_lifecycle_dependency_facts_authority_kind_check check (authority_kind in (
    'sbom', 'finding', 'report', 'evidence', 'retention', 'legal_hold',
    'substantial_modification', 'security_update_artifact'
  ));

alter table public.product_regulatory_outbox_events
  drop constraint if exists product_regulatory_outbox_events_event_type_check,
  add constraint product_regulatory_outbox_events_event_type_check check (event_type in (
    'release.market_availability_changed', 'release.lifecycle_changed',
    'release.placed_on_market_changed', 'support_period.alert',
    'product.retention.recalculated', 'product_relationship.graph_changed',
    'security_update_artifact.inspect',
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup',
    'security_update_artifact.external_reference_monitor'
  ));
create index product_security_update_artifact_outbox_idx
  on public.product_regulatory_outbox_events(organization_id, event_type, occurred_at, id)
  where event_type in (
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup'
  );

create or replace function public.m2_v2_set_lifecycle_dependency_fact(
  p_organization_id uuid,
  p_product_id uuid,
  p_release_id uuid,
  p_authority_kind text,
  p_record_id uuid,
  p_active boolean,
  p_actor_user_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.product_lifecycle_dependency_facts(
    organization_id, subject_kind, product_id, release_id, authority_kind, record_id,
    active, reconciled_at, reconciled_by
  ) values (
    p_organization_id, 'product', p_product_id, p_release_id, p_authority_kind, p_record_id,
    p_active, now(), p_actor_user_id
  ) on conflict(organization_id, subject_kind, authority_kind, record_id) do update set
    product_id = excluded.product_id,
    release_id = excluded.release_id,
    active = excluded.active,
    reconciled_at = excluded.reconciled_at,
    reconciled_by = excluded.reconciled_by;
end;
$$;

create or replace function public.m2_v2_set_artifact_retention_fact(
  p_artifact public.product_security_update_artifacts
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.retention_authoritative_facts(
    organization_id, evidence_class, reason_kind, source_record_id,
    required_retention_days, protect_through, active, last_observed_at
  ) values (
    p_artifact.organization_id, 'security_update_artifact', 'product', p_artifact.id,
    0, p_artifact.availability_until,
    p_artifact.publication_status = 'published', now()
  ) on conflict(organization_id, evidence_class, reason_kind, source_record_id) do update set
    protect_through = greatest(
      coalesce(public.retention_authoritative_facts.protect_through, '-infinity'::timestamptz),
      coalesce(excluded.protect_through, '-infinity'::timestamptz)
    ),
    active = excluded.active,
    last_observed_at = excluded.last_observed_at;
end;
$$;

create or replace function public.m2_v2_enqueue_security_update_artifact_recalculations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
begin
  if tg_op <> 'UPDATE' or old.superseded_at is not null or new.superseded_at is null then
    return new;
  end if;
  for v_artifact in
    select * from public.product_security_update_artifacts
    where organization_id = old.organization_id
      and support_period_id = old.id
      and publication_status <> 'withdrawn'
  loop
    insert into public.product_regulatory_outbox_events(
      organization_id, product_id, release_id, event_type, event_key, payload,
      correlation_id, occurred_at, delivery_state
    ) values (
      v_artifact.organization_id, v_artifact.product_id, v_artifact.release_id,
      'security_update_artifact.availability_recalculate',
      concat('security-update-artifact:recalculate:', v_artifact.id::text, ':', new.id::text),
      jsonb_build_object(
        'artifactId', v_artifact.id,
        'previousSupportPeriodId', old.id,
        'supportPeriodId', new.id,
        'supportPeriodRevision', new.scope_revision
      ), gen_random_uuid(), now(), 'scheduled'
    ) on conflict(organization_id, event_key) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists m2_v2_enqueue_security_update_artifact_recalculations
  on public.product_support_periods;
create trigger m2_v2_enqueue_security_update_artifact_recalculations
after update of superseded_at, superseded_by_id on public.product_support_periods
for each row execute function public.m2_v2_enqueue_security_update_artifact_recalculations();

create or replace function public.m2_v2_command_digest(p_payload jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex')
$$;

create or replace function public.m2_v2_assessment_payload_complete(
  p_modification_identifier text, p_title text, p_description text, p_technical_scope text,
  p_introduced_at timestamptz, p_detected_or_assessed_at timestamptz,
  p_previous_state text, p_resulting_state text, p_required_follow_up_actions jsonb,
  p_answers jsonb, p_rationale text
) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select
    char_length(btrim(coalesce(p_modification_identifier, ''))) between 1 and 128
    and char_length(btrim(coalesce(p_title, ''))) between 1 and 200
    and char_length(btrim(coalesce(p_description, ''))) between 1 and 4000
    and char_length(btrim(coalesce(p_technical_scope, ''))) between 1 and 8000
    and p_introduced_at is not null and p_detected_or_assessed_at is not null
    and char_length(btrim(coalesce(p_previous_state, ''))) between 1 and 8000
    and char_length(btrim(coalesce(p_resulting_state, ''))) between 1 and 8000
    and jsonb_typeof(p_required_follow_up_actions) = 'array'
    and jsonb_array_length(p_required_follow_up_actions) <= 100
    and not exists (
      select 1 from jsonb_array_elements_text(p_required_follow_up_actions) action
      where char_length(btrim(action)) not between 1 and 1000
    )
    and public.m2_v2_valid_assessment_answers(p_answers)
    and not exists (
      select 1 from jsonb_each_text(p_answers) answer where answer.value is null
    )
    and char_length(btrim(coalesce(p_rationale, ''))) between 1 and 4000
$$;

create or replace function public.get_product_substantial_modification_assessment(
  p_organization_id uuid, p_product_id uuid, p_assessment_id uuid, p_actor_user_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_assessment public.product_substantial_modification_assessments%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_assessment from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and product_id = p_product_id and id = p_assessment_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, public.m2_v2_assessment_json(v_assessment);
end;
$$;

create or replace function public.create_product_substantial_modification_assessment_draft_atomic(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid,
  p_modification_id uuid, p_modification_identifier text, p_title text,
  p_description text, p_technical_scope text, p_introduced_at timestamptz,
  p_detected_or_assessed_at timestamptz, p_previous_state text,
  p_resulting_state text, p_required_follow_up_actions jsonb, p_release_ids uuid[],
  p_answers jsonb, p_rationale text, p_evidence_references jsonb,
  p_completeness_state text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assessment public.product_substantial_modification_assessments%rowtype;
  v_replay public.product_substantial_modification_assessments%rowtype;
  v_answers jsonb := jsonb_build_object(
    'changesIntendedPurpose', null,
    'changesSecurityArchitectureOrTrustBoundary', null,
    'changesNetworkInterfaceOrPrivilegedRemoteControl', null,
    'changesCryptographyOrIdentityAccessControl', null,
    'changesSafetyOrSecurityRelevantComponent', null
  ) || coalesce(p_answers, '{}'::jsonb);
  v_release_ids uuid[] := coalesce(p_release_ids, '{}'::uuid[]);
  v_request_digest text;
begin
  if p_idempotency_key is null or p_modification_id is null
     or p_completeness_state not in ('draft', 'in_progress')
     or (p_answers is not null and jsonb_typeof(p_answers) <> 'object')
     or not public.m2_v2_valid_assessment_answers(v_answers)
     or (p_evidence_references is not null and jsonb_typeof(p_evidence_references) <> 'array')
     or (p_required_follow_up_actions is not null and jsonb_typeof(p_required_follow_up_actions) <> 'array')
     or (p_required_follow_up_actions is not null and (
       jsonb_array_length(p_required_follow_up_actions) > 100 or exists (
         select 1 from jsonb_array_elements_text(p_required_follow_up_actions) action
         where char_length(btrim(action)) not between 1 and 1000
       )
     ))
     or cardinality(v_release_ids) > 100
     or (select count(distinct release_id) from unnest(v_release_ids) release_id) <> cardinality(v_release_ids) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found or exists (
    select 1 from unnest(v_release_ids) release_id where not exists (
      select 1 from public.product_releases
      where organization_id = p_organization_id and product_id = p_product_id and id = release_id
    )
  ) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'create_assessment_draft', 'productId', p_product_id,
    'modificationId', p_modification_id, 'completenessState', p_completeness_state,
    'releaseIds', to_jsonb(v_release_ids), 'answers', v_answers,
    'requestPayload', jsonb_build_object(
      'modificationIdentifier', p_modification_identifier, 'title', p_title,
      'description', p_description, 'technicalScope', p_technical_scope,
      'introducedAt', p_introduced_at, 'detectedOrAssessedAt', p_detected_or_assessed_at,
      'previousState', p_previous_state, 'resultingState', p_resulting_state,
      'requiredFollowUpActions', p_required_follow_up_actions, 'rationale', p_rationale,
      'evidenceReferences', p_evidence_references
    )
  ));
  select * into v_replay from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'created'::text, public.m2_v2_assessment_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;
  if exists (
    select 1 from public.product_substantial_modification_assessments
    where organization_id = p_organization_id and product_id = p_product_id
      and modification_id = p_modification_id and superseded_at is null
  ) then
    return query select 'conflict'::text, null::jsonb; return;
  end if;
  insert into public.product_substantial_modification_assessments(
    organization_id, product_id, modification_id, revision,
    modification_identifier, title, description, technical_scope, introduced_at,
    detected_or_assessed_at, previous_state, resulting_state, required_follow_up_actions,
    completeness_state, status, answers, rationale, evidence_references, policy_suggestion,
    created_by, updated_by, idempotency_key, idempotency_request_digest
  ) values (
    p_organization_id, p_product_id, p_modification_id, 1,
    nullif(btrim(p_modification_identifier), ''), nullif(btrim(p_title), ''),
    nullif(btrim(p_description), ''), nullif(btrim(p_technical_scope), ''),
    p_introduced_at, p_detected_or_assessed_at, nullif(btrim(p_previous_state), ''),
    nullif(btrim(p_resulting_state), ''), p_required_follow_up_actions,
    p_completeness_state, p_completeness_state, v_answers, nullif(btrim(p_rationale), ''),
    coalesce(p_evidence_references, '[]'::jsonb), null, p_actor_user_id, p_actor_user_id,
    p_idempotency_key, v_request_digest
  ) returning * into v_assessment;
  insert into public.product_substantial_modification_releases(
    organization_id, assessment_id, product_id, release_id, created_by
  ) select p_organization_id, v_assessment.id, p_product_id, release_id, p_actor_user_id
    from unnest(v_release_ids) release_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.substantial_modification_assessment_draft_created',
    'product_substantial_modification_assessment', v_assessment.id::text,
    jsonb_build_object('modificationId', v_assessment.modification_id,
      'completenessState', v_assessment.completeness_state,
      'releaseCount', cardinality(v_release_ids), 'correlationId', p_correlation_id,
      'requestDigest', v_request_digest)
  );
  return query select 'created'::text, public.m2_v2_assessment_json(v_assessment);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.create_product_substantial_modification_assessment_atomic(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid,
  p_modification_id uuid, p_modification_identifier text, p_title text,
  p_description text, p_technical_scope text, p_introduced_at timestamptz,
  p_detected_or_assessed_at timestamptz, p_previous_state text,
  p_resulting_state text, p_required_follow_up_actions jsonb, p_answers jsonb,
  p_rationale text, p_evidence_references jsonb, p_suggestion text,
  p_release_ids uuid[], p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assessment public.product_substantial_modification_assessments%rowtype;
  v_replay public.product_substantial_modification_assessments%rowtype;
  v_request_digest text;
begin
  if p_idempotency_key is null or p_modification_id is null
     or not public.m2_v2_assessment_payload_complete(
       p_modification_identifier, p_title, p_description, p_technical_scope,
       p_introduced_at, p_detected_or_assessed_at, p_previous_state, p_resulting_state,
       p_required_follow_up_actions, p_answers, p_rationale
     )
     or jsonb_typeof(p_evidence_references) <> 'array'
     or char_length(btrim(p_rationale)) not between 1 and 4000
     or p_suggestion is null or p_suggestion not in ('undetermined', 'not_substantial', 'potentially_substantial')
     or cardinality(p_release_ids) is null or cardinality(p_release_ids) = 0
     or (select count(distinct release_id) from unnest(p_release_ids) release_id) <> cardinality(p_release_ids) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found or exists (
    select 1 from unnest(p_release_ids) release_id
    where not exists (
      select 1 from public.product_releases
      where organization_id = p_organization_id and product_id = p_product_id and id = release_id
    )
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'create_assessment', 'productId', p_product_id,
    'modificationId', p_modification_id,
    'modificationIdentifier', btrim(p_modification_identifier), 'title', btrim(p_title),
    'description', btrim(p_description), 'technicalScope', btrim(p_technical_scope),
    'introducedAt', public.m2_utc_z(p_introduced_at),
    'detectedOrAssessedAt', public.m2_utc_z(p_detected_or_assessed_at),
    'previousState', btrim(p_previous_state), 'resultingState', btrim(p_resulting_state),
    'requiredFollowUpActions', p_required_follow_up_actions, 'answers', p_answers,
    'rationale', btrim(p_rationale), 'evidenceReferences', p_evidence_references,
    'suggestion', p_suggestion, 'releaseIds', to_jsonb(p_release_ids)
  ));
  select * into v_replay from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'created'::text, public.m2_v2_assessment_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  if exists (
    select 1 from public.product_substantial_modification_assessments
    where organization_id = p_organization_id and product_id = p_product_id
      and modification_id = p_modification_id and superseded_at is null
  ) then
    return query select 'conflict'::text, null::jsonb;
    return;
  end if;
  insert into public.product_substantial_modification_assessments(
    organization_id, product_id, modification_id, revision,
    modification_identifier, title, description, technical_scope, introduced_at,
    detected_or_assessed_at, previous_state, resulting_state, required_follow_up_actions,
    completeness_state, status, answers, rationale, evidence_references, policy_suggestion,
    created_by, updated_by,
    idempotency_key, idempotency_request_digest
  ) values (
    p_organization_id, p_product_id, p_modification_id, 1,
    btrim(p_modification_identifier), btrim(p_title), btrim(p_description), btrim(p_technical_scope),
    p_introduced_at, p_detected_or_assessed_at, btrim(p_previous_state), btrim(p_resulting_state),
    p_required_follow_up_actions, 'complete', 'submitted_for_review', p_answers, btrim(p_rationale),
    p_evidence_references, p_suggestion, p_actor_user_id, p_actor_user_id,
    p_idempotency_key, v_request_digest
  ) returning * into v_assessment;
  insert into public.product_substantial_modification_releases(
    organization_id, assessment_id, product_id, release_id, created_by
  ) select p_organization_id, v_assessment.id, p_product_id, release_id, p_actor_user_id
    from unnest(p_release_ids) release_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.substantial_modification_assessment_created',
    'product_substantial_modification_assessment', v_assessment.id::text,
    jsonb_build_object(
      'modificationId', v_assessment.modification_id, 'revision', v_assessment.revision,
      'suggestion', v_assessment.policy_suggestion, 'releaseIds', to_jsonb(p_release_ids),
      'correlationId', p_correlation_id, 'requestDigest', v_request_digest
    )
  );
  return query select 'created'::text, public.m2_v2_assessment_json(v_assessment);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

create or replace function public.reassess_product_substantial_modification_atomic(
  p_organization_id uuid, p_product_id uuid, p_assessment_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_modification_identifier text, p_title text,
  p_description text, p_technical_scope text, p_introduced_at timestamptz,
  p_detected_or_assessed_at timestamptz, p_previous_state text,
  p_resulting_state text, p_required_follow_up_actions jsonb, p_answers jsonb,
  p_rationale text, p_evidence_references jsonb, p_suggestion text,
  p_release_ids uuid[], p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.product_substantial_modification_assessments%rowtype;
  v_new public.product_substantial_modification_assessments%rowtype;
  v_replay public.product_substantial_modification_assessments%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_request_digest text;
begin
  if p_idempotency_key is null or p_expected_version is null
     or not public.m2_v2_assessment_payload_complete(
       p_modification_identifier, p_title, p_description, p_technical_scope,
       p_introduced_at, p_detected_or_assessed_at, p_previous_state, p_resulting_state,
       p_required_follow_up_actions, p_answers, p_rationale
     )
     or jsonb_typeof(p_evidence_references) <> 'array'
     or char_length(btrim(p_rationale)) not between 1 and 4000
     or p_suggestion is null or p_suggestion not in ('undetermined', 'not_substantial', 'potentially_substantial')
     or cardinality(p_release_ids) is null or cardinality(p_release_ids) = 0
     or (select count(distinct release_id) from unnest(p_release_ids) release_id) <> cardinality(p_release_ids) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_old from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and product_id = p_product_id and id = p_assessment_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if exists (
    select 1 from unnest(p_release_ids) release_id
    where not exists (
      select 1 from public.product_releases
      where organization_id = p_organization_id and product_id = p_product_id and id = release_id
    )
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'reassess', 'assessmentId', p_assessment_id, 'expectedVersion', p_expected_version,
    'modificationIdentifier', btrim(p_modification_identifier), 'title', btrim(p_title),
    'description', btrim(p_description), 'technicalScope', btrim(p_technical_scope),
    'introducedAt', public.m2_utc_z(p_introduced_at),
    'detectedOrAssessedAt', public.m2_utc_z(p_detected_or_assessed_at),
    'previousState', btrim(p_previous_state), 'resultingState', btrim(p_resulting_state),
    'requiredFollowUpActions', p_required_follow_up_actions,
    'answers', p_answers, 'rationale', btrim(p_rationale),
    'evidenceReferences', p_evidence_references, 'suggestion', p_suggestion,
    'releaseIds', to_jsonb(p_release_ids)
  ));
  select * into v_replay from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'reassessed'::text, public.m2_v2_assessment_json(v_replay);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  if v_old.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_assessment_json(v_old);
    return;
  end if;
  if v_old.superseded_at is not null then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  update public.product_substantial_modification_assessments set
    status = 'superseded', superseded_at = now(), superseded_by_id = v_new_id,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = v_old.id;
  insert into public.product_substantial_modification_assessments(
    id, organization_id, product_id, modification_id, supersedes_id, revision,
    modification_identifier, title, description, technical_scope, introduced_at,
    detected_or_assessed_at, previous_state, resulting_state, required_follow_up_actions,
    completeness_state, status, answers, rationale, evidence_references, policy_suggestion,
    created_by, updated_by,
    idempotency_key, idempotency_request_digest
  ) values (
    v_new_id, p_organization_id, p_product_id, v_old.modification_id, v_old.id, v_old.revision + 1,
    btrim(p_modification_identifier), btrim(p_title), btrim(p_description), btrim(p_technical_scope),
    p_introduced_at, p_detected_or_assessed_at, btrim(p_previous_state), btrim(p_resulting_state),
    p_required_follow_up_actions, 'complete', 'submitted_for_review', p_answers, btrim(p_rationale),
    p_evidence_references, p_suggestion,
    p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_new;
  insert into public.product_substantial_modification_releases(
    organization_id, assessment_id, product_id, release_id, created_by
  ) select p_organization_id, v_new.id, p_product_id, release_id, p_actor_user_id
    from unnest(p_release_ids) release_id;
  update public.product_lifecycle_dependency_facts set
    active = false, reconciled_at = now(), reconciled_by = p_actor_user_id
  where organization_id = p_organization_id and authority_kind = 'substantial_modification'
    and record_id = v_old.id and active;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.substantial_modification_reassessed',
    'product_substantial_modification_assessment', v_new.id::text,
    jsonb_build_object(
      'supersedesId', v_old.id, 'modificationId', v_new.modification_id,
      'revision', v_new.revision, 'releaseIds', to_jsonb(p_release_ids),
      'correlationId', p_correlation_id, 'requestDigest', v_request_digest
    )
  );
  return query select 'reassessed'::text, public.m2_v2_assessment_json(v_new);
end;
$$;

create or replace function public.review_product_substantial_modification_assessment_atomic(
  p_organization_id uuid, p_product_id uuid, p_assessment_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_determination text, p_determination_rationale text,
  p_override_reason text, p_correlation_id uuid
) returns table(outcome text, assessment jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assessment public.product_substantial_modification_assessments%rowtype;
  v_release record;
begin
  if p_expected_version is null
     or p_determination not in ('undetermined', 'not_substantial', 'potentially_substantial', 'substantial')
     or char_length(btrim(p_determination_rationale)) not between 1 and 4000
     or (p_override_reason is not null and char_length(btrim(p_override_reason)) not between 1 and 1000) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_assessment from public.product_substantial_modification_assessments
  where organization_id = p_organization_id and product_id = p_product_id and id = p_assessment_id
  for update;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if v_assessment.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_assessment_json(v_assessment);
    return;
  end if;
  if v_assessment.status <> 'submitted_for_review'
     or v_assessment.completeness_state <> 'complete'
     or not public.m2_v2_assessment_payload_complete(
       v_assessment.modification_identifier, v_assessment.title, v_assessment.description,
       v_assessment.technical_scope, v_assessment.introduced_at,
       v_assessment.detected_or_assessed_at, v_assessment.previous_state,
       v_assessment.resulting_state, v_assessment.required_follow_up_actions,
       v_assessment.answers, v_assessment.rationale
     )
     or not exists (
       select 1 from public.product_substantial_modification_releases
       where organization_id = p_organization_id and assessment_id = p_assessment_id
     ) then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  if v_assessment.policy_suggestion <> p_determination
     and char_length(btrim(coalesce(p_override_reason, ''))) = 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  update public.product_substantial_modification_assessments set
    status = 'reviewed', determination = p_determination,
    review_rationale = btrim(p_determination_rationale),
    override_reason = nullif(btrim(p_override_reason), ''), reviewed_at = now(),
    reviewed_by = p_actor_user_id, version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_assessment_id
  returning * into v_assessment;
  if p_determination in ('potentially_substantial', 'substantial') then
    for v_release in
      select release_id from public.product_substantial_modification_releases
      where organization_id = p_organization_id and assessment_id = p_assessment_id
    loop
      perform public.m2_v2_set_lifecycle_dependency_fact(
        p_organization_id, p_product_id, v_release.release_id,
        'substantial_modification', p_assessment_id, true, p_actor_user_id
      );
    end loop;
  end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.substantial_modification_reviewed',
    'product_substantial_modification_assessment', p_assessment_id::text,
    jsonb_build_object(
      'determination', p_determination,
      'overrideApplied', v_assessment.override_reason is not null,
      'correlationId', p_correlation_id
    )
  );
  return query select 'reviewed'::text, public.m2_v2_assessment_json(v_assessment);
end;
$$;

create or replace function public.claim_product_security_update_artifact_work_atomic(
  p_organization_id uuid, p_event_type text, p_lease_owner uuid, p_lease_seconds integer
) returns table(outcome text, delivery_id uuid, lease_owner uuid, checkpoint_version integer, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event public.product_regulatory_outbox_events%rowtype;
  v_artifact public.product_security_update_artifacts%rowtype;
begin
  if p_event_type not in (
    'security_update_artifact.inspect',
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup',
    'security_update_artifact.external_reference_monitor'
  ) or p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  select * into v_event from public.product_regulatory_outbox_events event
  where event.organization_id = p_organization_id and event.event_type = p_event_type
    and ((event.delivery_state in ('scheduled', 'retrying') and event.due_at <= now())
      or (event.delivery_state = 'leased' and event.lease_expires_at <= now()))
  order by event.due_at, event.id for update skip locked limit 1;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  update public.product_regulatory_outbox_events set
    delivery_state = 'leased', lease_owner = p_lease_owner,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    checkpoint_version = v_event.checkpoint_version + 1,
    delivery_attempts = v_event.delivery_attempts + 1,
    last_delivery_error = null, last_error_code = null
  where organization_id = p_organization_id and id = v_event.id
  returning * into v_event;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and id = (v_event.payload->>'artifactId')::uuid;
  if not found then
    update public.product_regulatory_outbox_events set delivery_state = 'dead_letter',
      lease_owner = null, lease_expires_at = null, last_error_code = 'artifact_not_found'
    where organization_id = p_organization_id and id = v_event.id;
    return query select 'none_available'::text, null::uuid, null::uuid, null::integer, null::jsonb;
    return;
  end if;
  return query select 'claimed'::text, v_event.id, v_event.lease_owner,
    v_event.checkpoint_version, public.m2_v2_security_update_artifact_json(v_artifact, true);
end;
$$;

create or replace function public.complete_product_security_update_artifact_work_atomic(
  p_organization_id uuid, p_delivery_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.product_regulatory_outbox_events set
    delivery_state = 'delivered', delivered_at = now(), lease_owner = null,
    lease_expires_at = null, last_delivery_error = null, last_error_code = null
  where organization_id = p_organization_id and id = p_delivery_id
    and event_type in (
      'security_update_artifact.inspect',
      'security_update_artifact.availability_recalculate',
      'security_update_artifact.cleanup',
      'security_update_artifact.external_reference_monitor'
    )
    and delivery_state = 'leased' and lease_owner = p_lease_owner
    and checkpoint_version = p_expected_checkpoint_version;
  return query select case when found then 'completed' else 'conflict' end;
end;
$$;

create or replace function public.fail_product_security_update_artifact_work_atomic(
  p_organization_id uuid, p_delivery_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer, p_code text, p_retryable boolean
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempt integer; v_state text;
begin
  select delivery_attempts into v_attempt from public.product_regulatory_outbox_events
  where organization_id = p_organization_id and id = p_delivery_id
    and event_type in (
      'security_update_artifact.inspect',
      'security_update_artifact.availability_recalculate',
      'security_update_artifact.cleanup',
      'security_update_artifact.external_reference_monitor'
    )
    and delivery_state = 'leased' and lease_owner = p_lease_owner
    and checkpoint_version = p_expected_checkpoint_version
  for update;
  if not found then return query select 'conflict'::text; return; end if;
  v_state := case when not p_retryable or v_attempt >= 12 then 'dead_letter' else 'retrying' end;
  update public.product_regulatory_outbox_events set
    delivery_state = v_state, lease_owner = null, lease_expires_at = null,
    last_error_code = left(coalesce(nullif(btrim(p_code), ''), 'provider_unavailable'), 100),
    last_delivery_error = null,
    due_at = case when v_state = 'dead_letter' then due_at else now() + make_interval(
      secs => least(3600, greatest(30, 30 * power(2, least(v_attempt, 7))::integer))
    ) end
  where organization_id = p_organization_id and id = p_delivery_id;
  return query select 'failed'::text;
end;
$$;

insert into public.organization_export_source_tables(
  source_id, table_name, tenant_key_column, record_order_column, table_sort
) values
  ('product_registry', 'product_substantial_modification_assessments', 'organization_id', 'id', 13),
  ('product_registry', 'product_substantial_modification_releases', 'organization_id', 'assessment_id', 14),
  ('product_registry', 'product_security_update_artifacts', 'organization_id', 'id', 15)
on conflict(source_id, table_name) do update set
  tenant_key_column = excluded.tenant_key_column,
  record_order_column = excluded.record_order_column,
  table_sort = excluded.table_sort;

alter function public.m2_v2_valid_assessment_answers(jsonb) owner to postgres;
alter function public.m2_v2_availability_candidate(timestamptz) owner to postgres;
alter function public.m2_v2_valid_published_external_references(jsonb) owner to postgres;
alter function public.m2_v2_assessment_json(public.product_substantial_modification_assessments) owner to postgres;
alter function public.m2_v2_security_update_artifact_json(public.product_security_update_artifacts, boolean) owner to postgres;
alter function public.m2_v2_guard_assessment_update() owner to postgres;
alter function public.m2_v2_guard_security_update_artifact_update() owner to postgres;
alter function public.m2_v2_set_lifecycle_dependency_fact(uuid, uuid, uuid, text, uuid, boolean, uuid) owner to postgres;
alter function public.m2_v2_set_artifact_retention_fact(public.product_security_update_artifacts) owner to postgres;
alter function public.m2_v2_enqueue_security_update_artifact_recalculations() owner to postgres;
alter function public.m2_v2_command_digest(jsonb) owner to postgres;
alter function public.m2_v2_assessment_payload_complete(text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text) owner to postgres;
alter function public.get_product_substantial_modification_assessment(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.create_product_substantial_modification_assessment_draft_atomic(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, uuid[], jsonb, text, jsonb, text, uuid, uuid) owner to postgres;
alter function public.create_product_substantial_modification_assessment_atomic(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid) owner to postgres;
alter function public.reassess_product_substantial_modification_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid) owner to postgres;
alter function public.review_product_substantial_modification_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid) owner to postgres;
alter function public.claim_product_security_update_artifact_work_atomic(uuid, text, uuid, integer) owner to postgres;
alter function public.complete_product_security_update_artifact_work_atomic(uuid, uuid, uuid, integer) owner to postgres;
alter function public.fail_product_security_update_artifact_work_atomic(uuid, uuid, uuid, integer, text, boolean) owner to postgres;

revoke all on function
  public.m2_v2_valid_assessment_answers(jsonb),
  public.m2_v2_availability_candidate(timestamptz),
  public.m2_v2_valid_published_external_references(jsonb),
  public.m2_v2_assessment_json(public.product_substantial_modification_assessments),
  public.m2_v2_security_update_artifact_json(public.product_security_update_artifacts, boolean),
  public.m2_v2_guard_assessment_update(),
  public.m2_v2_guard_security_update_artifact_update(),
  public.m2_v2_set_lifecycle_dependency_fact(uuid, uuid, uuid, text, uuid, boolean, uuid),
  public.m2_v2_set_artifact_retention_fact(public.product_security_update_artifacts),
  public.m2_v2_enqueue_security_update_artifact_recalculations(),
  public.m2_v2_command_digest(jsonb),
  public.m2_v2_assessment_payload_complete(text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text),
  public.get_product_substantial_modification_assessment(uuid, uuid, uuid, uuid),
  public.create_product_substantial_modification_assessment_draft_atomic(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, uuid[], jsonb, text, jsonb, text, uuid, uuid),
  public.create_product_substantial_modification_assessment_atomic(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid),
  public.reassess_product_substantial_modification_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid),
  public.review_product_substantial_modification_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid),
  public.claim_product_security_update_artifact_work_atomic(uuid, text, uuid, integer),
  public.complete_product_security_update_artifact_work_atomic(uuid, uuid, uuid, integer),
  public.fail_product_security_update_artifact_work_atomic(uuid, uuid, uuid, integer, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.get_product_substantial_modification_assessment(uuid, uuid, uuid, uuid),
  public.create_product_substantial_modification_assessment_draft_atomic(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, uuid[], jsonb, text, jsonb, text, uuid, uuid),
  public.create_product_substantial_modification_assessment_atomic(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid),
  public.reassess_product_substantial_modification_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, text, timestamptz, timestamptz, text, text, jsonb, jsonb, text, jsonb, text, uuid[], uuid, uuid),
  public.review_product_substantial_modification_assessment_atomic(uuid, uuid, uuid, uuid, integer, text, text, text, uuid),
  public.claim_product_security_update_artifact_work_atomic(uuid, text, uuid, integer),
  public.complete_product_security_update_artifact_work_atomic(uuid, uuid, uuid, integer),
  public.fail_product_security_update_artifact_work_atomic(uuid, uuid, uuid, integer, text, boolean)
to service_role;

revoke all on function public.m2_reconcile_product_entity(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.m2_reconcile_product_entity(uuid, uuid, uuid)
to service_role;

-- Keep the export snapshot a true point-in-time allowlist snapshot. The
-- existing materializer is recreated solely to add the three retained M2 V2
-- tables to its share lock; its redaction and product-import branches remain
-- unchanged.
create or replace function public.materialize_organization_export_snapshot_atomic(
  p_organization_id uuid,p_export_job_id uuid,p_lease_owner uuid,p_expected_checkpoint_version integer
) returns table(outcome text,checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.organization_export_jobs%rowtype;
  v_snapshot public.organization_export_snapshots%rowtype;
  v_mapping public.organization_export_source_tables%rowtype;
  v_source_id text;
  v_source_count integer:=0;
begin
  lock table
    public.organizations, public.organization_legal_profiles, public.organization_members,
    public.audit_logs, public.invitations, public.custom_roles,
    public.base_role_permission_overrides, public.menu_permissions,
    public.user_role_assignments, public.user_table_preferences,
    public.organization_onboarding, public.organization_onboarding_stages,
    public.organization_onboarding_evidence, public.organization_settings,
    public.organization_lifecycles, public.organization_retention_policies,
    public.retention_authority_states, public.retention_authoritative_facts,
    public.retention_floor_snapshots, public.retention_floor_reasons,
    public.evidence_protection_watermarks, public.retention_cleanup_runs,
    public.retention_cleanup_items, public.organization_export_jobs,
    public.organization_export_parts, public.organization_export_snapshots,
    public.organization_purge_jobs, public.organization_purge_work_items,
    public.organization_permissions_version, public.organization_legal_entities,
    public.organization_legal_entity_dependency_authorities,
    public.organization_legal_entity_dependency_facts,
    public.organization_branding_drafts, public.organization_branding_assets,
    public.organization_branding_versions, public.products, public.product_releases,
    public.product_legal_entity_assignments, public.product_lifecycle_dependency_facts,
    public.product_release_market_availability, public.product_regulatory_outbox_events,
    public.product_support_periods, public.software_baselines,
    public.software_baseline_release_memberships, public.product_relationships,
    public.finding_propagation_sources, public.finding_impact_associations,
    public.finding_product_impact_overrides, public.finding_propagation_jobs,
    public.product_import_jobs, public.product_import_rows,
    public.product_substantial_modification_assessments,
    public.product_substantial_modification_releases,
    public.product_security_update_artifacts
  in share mode;

  select * into v_job from public.organization_export_jobs jobs
   where jobs.id=p_export_job_id and jobs.organization_id=p_organization_id for update;
  if not found then return query select 'not_found'::text,null::integer; return; end if;
  if v_job.status<>'running' or v_job.lease_owner<>p_lease_owner
     or v_job.lease_expires_at<=now() or v_job.checkpoint_version<>p_expected_checkpoint_version then
    return query select 'conflict'::text,v_job.checkpoint_version; return;
  end if;
  select * into v_snapshot from public.organization_export_snapshots snapshots
   where snapshots.organization_id=p_organization_id and snapshots.export_job_id=p_export_job_id
   order by snapshots.snapshot_version desc limit 1 for update;
  if not found or cardinality(v_snapshot.source_ids)=0 then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return;
  end if;
  if v_snapshot.materialized_at is not null then
    return query select 'replayed'::text,v_job.checkpoint_version; return;
  end if;
  if exists(select 1 from public.organization_export_snapshot_records records
    where records.organization_id=p_organization_id and records.export_job_id=p_export_job_id) then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return;
  end if;
  if exists(select 1 from unnest(v_snapshot.source_ids) requested(source_id)
    where not exists(select 1 from public.organization_export_source_tables mappings
      where mappings.source_id=requested.source_id)) then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return;
  end if;
  foreach v_source_id in array v_snapshot.source_ids loop
    for v_mapping in select * from public.organization_export_source_tables mappings
      where mappings.source_id=v_source_id order by mappings.table_sort
    loop
      if v_mapping.table_name='product_import_jobs' then
        insert into public.organization_export_snapshot_records(
          organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload
        ) select p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,
          v_mapping.table_sort,row_number() over(order by jobs.created_at,jobs.id),
          public.m1_export_redact_jsonb(public.m2_product_import_job_export_json(jobs))
        from public.product_import_jobs jobs where jobs.organization_id=p_organization_id
        order by jobs.created_at,jobs.id;
      elsif v_mapping.table_name='product_import_rows' then
        insert into public.organization_export_snapshot_records(
          organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload
        ) select p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,
          v_mapping.table_sort,row_number() over(order by rows.import_id,rows.source_row_number,rows.id),
          public.m1_export_redact_jsonb(public.m2_product_import_row_export_json(rows))
        from public.product_import_rows rows where rows.organization_id=p_organization_id
        order by rows.import_id,rows.source_row_number,rows.id;
      else
        execute format(
          'insert into public.organization_export_snapshot_records
            (organization_id,export_job_id,source_id,table_name,table_sort,record_index,record_payload)
           select $1,$2,$3,$4,$5,row_number() over(order by source.%I),
                  public.m1_export_redact_jsonb(to_jsonb(source))
             from public.%I source where source.%I=$1 order by source.%I',
          v_mapping.record_order_column,v_mapping.table_name,
          v_mapping.tenant_key_column,v_mapping.record_order_column
        ) using p_organization_id,p_export_job_id,v_source_id,v_mapping.table_name,v_mapping.table_sort;
      end if;
      v_source_count:=v_source_count+1;
    end loop;
  end loop;
  if v_source_count<>(select count(*) from public.organization_export_source_tables mappings
    where mappings.source_id=any(v_snapshot.source_ids)) then
    return query select 'invalid_request'::text,v_job.checkpoint_version; return;
  end if;
  update public.organization_export_snapshots snapshots set
    materialized_at=now(),materialized_by=v_job.actor_user_id,
    materialized_checkpoint_version=v_job.checkpoint_version where snapshots.id=v_snapshot.id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'organization.export_snapshot_materialized','organization_export_job',
    p_export_job_id::text,jsonb_build_object('sourceCount',v_source_count,
      'checkpointVersion',v_job.checkpoint_version));
  return query select 'materialized'::text,v_job.checkpoint_version;
end;
$$;
alter function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer) owner to postgres;
revoke all on function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)
from public,anon,authenticated;
grant execute on function public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)
to service_role;

create or replace function public.list_due_product_security_update_artifact_organizations()
returns table(organization_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select distinct event.organization_id
  from public.product_regulatory_outbox_events event
  where event.event_type in (
    'security_update_artifact.inspect',
    'security_update_artifact.availability_recalculate',
    'security_update_artifact.cleanup',
    'security_update_artifact.external_reference_monitor'
  ) and (
    (event.delivery_state in ('scheduled', 'retrying') and event.due_at <= now())
    or (event.delivery_state = 'leased' and event.lease_expires_at <= now())
  )
  order by event.organization_id
$$;
alter function public.list_due_product_security_update_artifact_organizations() owner to postgres;
revoke all on function public.list_due_product_security_update_artifact_organizations()
from public, anon, authenticated;
grant execute on function public.list_due_product_security_update_artifact_organizations()
to service_role;

create or replace function public.get_product_security_update_artifact(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.reserve_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_update_version text, p_title text, p_artifact_type text, p_supported_platform text,
  p_signature_metadata jsonb, p_distribution_kind text,
  p_validated_external_references jsonb, p_file_name text,
  p_content_type text, p_byte_size bigint, p_sha256 text, p_issued_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_replay public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_artifact_id uuid := gen_random_uuid();
  v_object_key text;
  v_distribution_reference text;
  v_request_digest text;
  v_support_eligible boolean := false;
begin
  if p_idempotency_key is null
     or char_length(btrim(p_update_version)) not between 1 and 200
     or char_length(btrim(p_title)) not between 1 and 200
     or p_artifact_type not in ('software_update', 'firmware_update', 'security_advisory')
     or char_length(btrim(p_supported_platform)) not between 1 and 500
     or jsonb_typeof(p_signature_metadata) <> 'object'
     or p_distribution_kind not in ('authenticated_download', 'external_reference')
     or jsonb_typeof(p_validated_external_references) <> 'array'
     or char_length(btrim(p_file_name)) not between 1 and 255
     or char_length(btrim(p_content_type)) not between 1 and 255
     or p_byte_size not between 1 and 2147483647
     or p_sha256 !~ '^[a-f0-9]{64}$' or p_issued_at is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found or not exists (
    select 1 from public.product_releases
    where organization_id = p_organization_id and product_id = p_product_id and id = p_release_id
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, p_release_id
  );
  v_support_eligible := found and p_issued_at >= v_support.support_starts_at
    and p_issued_at <= v_support.support_ends_at;
  if p_distribution_kind = 'authenticated_download'
     and jsonb_array_length(p_validated_external_references) <> 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if p_distribution_kind = 'external_reference' then
    if jsonb_array_length(p_validated_external_references) = 0
       or not public.m2_v2_valid_published_external_references(p_validated_external_references) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
    select reference->>'uri' into v_distribution_reference
    from jsonb_array_elements(p_validated_external_references) reference
    limit 1;
    if v_distribution_reference is null then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'reserve_artifact', 'productId', p_product_id, 'releaseId', p_release_id,
    'updateVersion', btrim(p_update_version), 'title', btrim(p_title),
    'artifactType', p_artifact_type, 'supportedPlatform', btrim(p_supported_platform),
    'signatureMetadata', p_signature_metadata, 'distributionKind', p_distribution_kind,
    'validatedExternalReferences', p_validated_external_references,
    'fileName', btrim(p_file_name), 'contentType', btrim(p_content_type),
    'byteSize', p_byte_size, 'sha256', p_sha256, 'issuedAt', public.m2_utc_z(p_issued_at)
  ));
  select * into v_replay from public.product_security_update_artifacts
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_replay, true);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  v_object_key := case when p_distribution_kind = 'authenticated_download'
    then concat(p_organization_id::text, '/', v_artifact_id::text, '/', p_sha256)
    else null end;
  insert into public.product_security_update_artifacts(
    id, organization_id, product_id, release_id, support_period_id, support_period_revision,
    update_version, title, artifact_type, supported_platform, signature_metadata,
    distribution_kind, distribution_reference, published_external_references,
    file_name, content_type, byte_size, sha256, object_key, issued_at,
    upload_status, integrity_status,
    availability_status, availability_explanation,
    created_by, updated_by, idempotency_key, idempotency_request_digest
  ) values (
    v_artifact_id, p_organization_id, p_product_id, p_release_id,
    case when v_support_eligible then v_support.id else null end,
    case when v_support_eligible then v_support.scope_revision else null end,
    btrim(p_update_version), btrim(p_title), p_artifact_type,
    btrim(p_supported_platform), p_signature_metadata, p_distribution_kind,
    v_distribution_reference, p_validated_external_references,
    btrim(p_file_name), btrim(p_content_type), p_byte_size, p_sha256, v_object_key,
    p_issued_at, 'reserved', 'pending',
    case when v_support_eligible then 'pending' else 'blocked' end,
    jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1',
      'status', case when v_support_eligible then 'pending' else 'blocked' end,
      'code', case when v_support_eligible then 'awaiting_publication'
        when v_support.id is null then 'missing_support_period'
        else 'issued_at_outside_current_support_period' end
    ), p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_artifact;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state
  ) values (
    p_organization_id, p_product_id, p_release_id, 'security_update_artifact.inspect',
    concat('security-update-artifact:inspect:', v_artifact.id::text),
    jsonb_build_object('artifactId', v_artifact.id, 'distributionKind', p_distribution_kind),
    p_correlation_id, now(), 'scheduled'
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_reserved',
    'product_security_update_artifact', v_artifact.id::text,
    jsonb_build_object(
      'releaseId', p_release_id, 'distributionKind', p_distribution_kind,
      'externalReferenceCount', jsonb_array_length(p_validated_external_references),
      'correlationId', p_correlation_id, 'requestDigest', v_request_digest
    )
  );
  return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_artifact, true);
end;
$$;

create or replace function public.finalize_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_verified_sha256 text, p_verified_byte_size bigint,
  p_verified_content_type text, p_integrity_status text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if p_expected_version is null or p_integrity_status not in (
    'verified', 'hash_mismatch', 'type_mismatch', 'corrupt', 'unavailable', 'provider_unavailable'
  ) or (p_integrity_status = 'verified' and (
    p_verified_sha256 !~ '^[a-f0-9]{64}$'
    or p_verified_byte_size is null or char_length(btrim(p_verified_content_type)) = 0
  )) or (p_integrity_status <> 'verified' and (
    p_verified_sha256 is not null or p_verified_byte_size is not null or p_verified_content_type is not null
  )) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    if v_artifact.upload_status = 'finalized'
       and v_artifact.integrity_status = p_integrity_status then
      return query select 'finalized'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    end if;
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  if (v_artifact.distribution_kind = 'authenticated_download'
      and v_artifact.upload_status not in ('reserved', 'uploaded'))
     or (v_artifact.distribution_kind = 'external_reference'
      and v_artifact.upload_status <> 'reserved') then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  if v_artifact.distribution_kind = 'authenticated_download' and not exists (
    select 1 from storage.objects
    where bucket_id = 'security-update-artifacts' and name = v_artifact.object_key
  ) then
    p_integrity_status := 'unavailable';
  end if;
  if p_integrity_status = 'verified' and (
    p_verified_sha256 <> v_artifact.sha256 or p_verified_byte_size <> v_artifact.byte_size
    or btrim(p_verified_content_type) <> v_artifact.content_type
  ) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  update public.product_security_update_artifacts set
    upload_status = case when p_integrity_status = 'verified' then 'finalized' else 'failed' end,
    integrity_status = p_integrity_status, version = version + 1,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  update public.product_regulatory_outbox_events set
    delivery_state = 'delivered', delivered_at = now(), lease_owner = null,
    lease_expires_at = null
  where organization_id = p_organization_id and event_type = 'security_update_artifact.inspect'
    and payload->>'artifactId' = p_artifact_id::text
    and delivery_state in ('scheduled', 'leased', 'retrying');
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_finalized',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('integrityStatus', p_integrity_status, 'correlationId', p_correlation_id)
  );
  return query select 'finalized'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.review_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_review_decision text, p_review_reason text,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if p_expected_version is null or p_review_decision not in ('cleared', 'rejected')
     or char_length(btrim(p_review_reason)) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.review_status <> 'pending_review'
     or (p_review_decision = 'cleared' and (
       v_artifact.distribution_kind = 'authenticated_download'
       and (v_artifact.upload_status <> 'finalized' or v_artifact.integrity_status <> 'verified')
     )) then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  update public.product_security_update_artifacts set
    review_status = p_review_decision, reviewed_at = now(), reviewed_by = p_actor_user_id,
    review_reason = btrim(p_review_reason), version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_reviewed',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('reviewDecision', p_review_decision, 'correlationId', p_correlation_id)
  );
  return query select 'reviewed'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.recalc_product_security_update_artifact_availability_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_issued_candidate timestamptz;
  v_computed timestamptz;
  v_until timestamptz;
  v_winner text;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, v_artifact.release_id
  );
  if not found or v_artifact.issued_at < v_support.support_starts_at
     or v_artifact.issued_at > v_support.support_ends_at then
    update public.product_security_update_artifacts set
      availability_status = 'blocked',
      availability_explanation = jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'blocked', 'code', case when not found then 'missing_support_period'
          else 'issued_at_outside_current_support_period' end
      ), version = version + 1, updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_availability_recalculated',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('status', 'blocked', 'correlationId', p_correlation_id));
    return query select 'blocked'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  v_issued_candidate := public.m2_v2_availability_candidate(v_artifact.issued_at);
  v_computed := greatest(v_issued_candidate, v_support.support_ends_at);
  v_until := greatest(coalesce(v_artifact.availability_until, '-infinity'::timestamptz), v_computed);
  v_winner := case when v_issued_candidate = v_support.support_ends_at then 'equal'
    when v_issued_candidate > v_support.support_ends_at then 'issued_at_plus_10_calendar_years'
    else 'support_period_end' end;
  update public.product_security_update_artifacts set
    support_period_id = v_support.id, support_period_revision = v_support.scope_revision,
    availability_status = case when publication_status in ('published', 'replaced')
      then 'available' else 'pending' end,
    issued_candidate_at = v_issued_candidate, support_candidate_at = v_support.support_ends_at,
    availability_winning_rule = v_winner, computed_availability_until = v_computed,
    availability_until = v_until, non_reduction_applied = v_until > v_computed,
    availability_explanation = jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1', 'status', 'current',
      'supportPeriodId', v_support.id, 'supportPeriodRevision', v_support.scope_revision,
      'issuedCandidate', public.m2_utc_z(v_issued_candidate),
      'supportCandidate', public.m2_utc_z(v_support.support_ends_at),
      'winningRule', v_winner, 'nonReductionApplied', v_until > v_computed
    ), version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  if v_artifact.publication_status in ('published', 'replaced') then
    perform public.m2_v2_set_artifact_retention_fact(v_artifact);
  end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_availability_recalculated',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('availabilityUntil', public.m2_utc_z(v_until),
      'nonReductionApplied', v_until > v_computed, 'correlationId', p_correlation_id));
  return query select 'recalculated'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.publish_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_published_external_references jsonb,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_issued_candidate timestamptz;
  v_computed timestamptz;
  v_winner text;
  v_distribution_reference text;
begin
  if p_expected_version is null or jsonb_typeof(p_published_external_references) <> 'array' then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.publication_status <> 'draft' or v_artifact.review_status <> 'cleared'
     or (v_artifact.distribution_kind = 'authenticated_download' and (
       v_artifact.upload_status <> 'finalized' or v_artifact.integrity_status <> 'verified'
     )) then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, v_artifact.release_id
  );
  if not found or v_support.id <> v_artifact.support_period_id
     or v_artifact.issued_at < v_support.support_starts_at
     or v_artifact.issued_at > v_support.support_ends_at then
    update public.product_security_update_artifacts set
      availability_status = 'blocked', availability_explanation = jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1', 'status', 'blocked',
        'code', 'support_period_missing_or_changed'
      ), version = version + 1, updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_publish_blocked',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('code', 'support_period_missing_or_changed', 'correlationId', p_correlation_id));
    return query select 'blocked'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  if v_artifact.distribution_kind = 'authenticated_download'
     and jsonb_array_length(p_published_external_references) <> 0 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if v_artifact.distribution_kind = 'external_reference' then
    if jsonb_array_length(p_published_external_references) = 0
       or not public.m2_v2_valid_published_external_references(p_published_external_references)
       or p_published_external_references <> v_artifact.published_external_references then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
    select coalesce(reference->>'url', reference->>'href', reference->>'uri')
      into v_distribution_reference
    from jsonb_array_elements(v_artifact.published_external_references) reference
    limit 1;
    if v_distribution_reference is null then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
  end if;
  v_issued_candidate := public.m2_v2_availability_candidate(v_artifact.issued_at);
  v_computed := greatest(v_issued_candidate, v_support.support_ends_at);
  v_winner := case when v_issued_candidate = v_support.support_ends_at then 'equal'
    when v_issued_candidate > v_support.support_ends_at then 'issued_at_plus_10_calendar_years'
    else 'support_period_end' end;
  update public.product_security_update_artifacts set
    publication_status = 'published', published_at = now(), published_by = p_actor_user_id,
    availability_status = 'available', issued_candidate_at = v_issued_candidate,
    support_candidate_at = v_support.support_ends_at, availability_winning_rule = v_winner,
    computed_availability_until = v_computed,
    availability_until = greatest(coalesce(availability_until, '-infinity'::timestamptz), v_computed),
    non_reduction_applied = coalesce(availability_until, '-infinity'::timestamptz) > v_computed,
    availability_explanation = jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1', 'status', 'current',
      'issuedCandidate', public.m2_utc_z(v_issued_candidate),
      'supportCandidate', public.m2_utc_z(v_support.support_ends_at), 'winningRule', v_winner
    ), distribution_reference = v_distribution_reference,
    published_external_references = case when v_artifact.distribution_kind = 'external_reference'
      then v_artifact.published_external_references else p_published_external_references end,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  perform public.m2_v2_set_lifecycle_dependency_fact(
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact', v_artifact.id, true, p_actor_user_id
  );
  perform public.m2_v2_set_artifact_retention_fact(v_artifact);
  if v_artifact.distribution_kind = 'external_reference' then
    insert into public.product_regulatory_outbox_events(
      organization_id, product_id, release_id, event_type, event_key, payload,
      correlation_id, occurred_at, delivery_state
    ) values (
      p_organization_id, p_product_id, v_artifact.release_id,
      'security_update_artifact.external_reference_monitor',
      concat('security-update-artifact:external-reference-monitor:', v_artifact.id::text),
      jsonb_build_object('artifactId', v_artifact.id), p_correlation_id, now(), 'scheduled'
    ) on conflict(organization_id, event_key) do nothing;
  end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_published',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('availabilityUntil', public.m2_utc_z(v_artifact.availability_until),
      'distributionKind', v_artifact.distribution_kind,
      'externalReferenceCount', jsonb_array_length(v_artifact.published_external_references),
      'correlationId', p_correlation_id));
  return query select 'published'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.replace_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_replacement_artifact_id uuid, p_actor_user_id uuid, p_expected_version integer,
  p_reason text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_replacement public.product_security_update_artifacts%rowtype;
begin
  if p_expected_version is null or p_artifact_id = p_replacement_artifact_id
     or char_length(btrim(p_reason)) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  perform 1 from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id
    and id in (p_artifact_id, p_replacement_artifact_id)
  order by id for update;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id;
  select * into v_replacement from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_replacement_artifact_id;
  if v_artifact.id is null or v_replacement.id is null then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.release_id <> v_replacement.release_id
     or v_artifact.publication_status not in ('published', 'replaced')
     or v_replacement.publication_status <> 'published'
     or v_replacement.review_status <> 'cleared'
     or v_replacement.availability_status <> 'available'
     or v_replacement.availability_until < v_artifact.availability_until then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  update public.product_security_update_artifacts set
    publication_status = 'replaced', replacement_artifact_id = v_replacement.id,
    replaced_at = now(), replaced_by = p_actor_user_id, replacement_reason = btrim(p_reason),
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_replaced',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('replacementArtifactId', v_replacement.id,
      'correlationId', p_correlation_id));
  return query select 'replaced'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.withdraw_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_reason text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_replacement public.product_security_update_artifacts%rowtype;
begin
  if p_expected_version is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.publication_status not in ('published', 'replaced') then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  if v_artifact.availability_until > now() then
    if v_artifact.replacement_artifact_id is null then
      return query select 'invalid_state'::text, null::jsonb; return;
    end if;
    select * into v_replacement from public.product_security_update_artifacts
    where organization_id = p_organization_id and product_id = p_product_id
      and id = v_artifact.replacement_artifact_id
    for update;
    if not found or v_replacement.release_id <> v_artifact.release_id
       or v_replacement.publication_status <> 'published'
       or v_replacement.review_status <> 'cleared'
       or v_replacement.availability_status <> 'available'
       or v_replacement.availability_until < v_artifact.availability_until then
      return query select 'invalid_state'::text, null::jsonb; return;
    end if;
  end if;
  update public.product_security_update_artifacts set
    publication_status = 'withdrawn', availability_status = 'expired', withdrawn_at = now(),
    withdrawn_by = p_actor_user_id, withdrawal_reason = btrim(p_reason),
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  perform public.m2_v2_set_lifecycle_dependency_fact(
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact', v_artifact.id, false, p_actor_user_id
  );
  perform public.m2_v2_set_artifact_retention_fact(v_artifact);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_withdrawn',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('earlyWithdrawal', v_artifact.availability_until > now(),
      'replacementArtifactId', v_artifact.replacement_artifact_id,
      'correlationId', p_correlation_id));
  return query select 'withdrawn'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.download_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.distribution_kind <> 'authenticated_download'
     or v_artifact.publication_status not in ('published', 'replaced')
     or v_artifact.availability_status <> 'available'
     or v_artifact.availability_until is null or v_artifact.availability_until < now() then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_download_authorized',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('authorizedAt', public.m2_utc_z(now())));
  return query select 'found'::text, public.m2_v2_security_update_artifact_json(v_artifact, true);
end;
$$;

create or replace function public.schedule_product_security_update_artifact_cleanup_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.availability_status <> 'expired'
     and v_artifact.availability_until is not null
     and v_artifact.availability_until < now() then
    update public.product_security_update_artifacts set
      availability_status = 'expired', version = version + 1,
      availability_explanation = jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'expired', 'code', 'availability_expired'
      ), updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    perform public.m2_v2_set_lifecycle_dependency_fact(
      p_organization_id, p_product_id, v_artifact.release_id,
      'security_update_artifact', v_artifact.id, false, p_actor_user_id
    );
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_availability_expired',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('correlationId', p_correlation_id));
  end if;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state
  ) values (
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact.cleanup', concat('security-update-artifact:cleanup:', v_artifact.id::text),
    jsonb_build_object('artifactId', v_artifact.id), p_correlation_id, now(),
    greatest(now(), coalesce(v_artifact.availability_until, now())), 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;
  if v_artifact.cleanup_scheduled_at is null then
    update public.product_security_update_artifacts set cleanup_scheduled_at = now(),
      cleanup_scheduled_by = p_actor_user_id, version = version + 1, updated_by = p_actor_user_id
    where organization_id = p_organization_id and id = p_artifact_id
    returning * into v_artifact;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'product.security_update_artifact_cleanup_scheduled',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('dueAt', public.m2_utc_z(greatest(now(), coalesce(v_artifact.availability_until, now()))),
        'correlationId', p_correlation_id));
  end if;
  return query select 'scheduled'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

create or replace function public.monitor_product_security_update_external_reference_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_monitor_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_integrity_status text;
  v_available boolean;
begin
  if p_expected_version is null or p_monitor_outcome not in (
    'verified', 'external_content_changed', 'unavailable', 'provider_unavailable'
  ) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false); return;
  end if;
  if v_artifact.distribution_kind <> 'external_reference'
     or v_artifact.publication_status not in ('published', 'replaced') then
    return query select 'invalid_state'::text, null::jsonb; return;
  end if;

  v_available := p_monitor_outcome = 'verified'
    and v_artifact.availability_status = 'available'
    and v_artifact.availability_until is not null
    and v_artifact.availability_until >= now();
  v_integrity_status := case p_monitor_outcome
    when 'verified' then 'verified'
    when 'external_content_changed' then 'corrupt'
    else p_monitor_outcome
  end;
  update public.product_security_update_artifacts set
    integrity_status = v_integrity_status,
    availability_status = case
      when v_artifact.availability_status = 'expired'
        or (v_artifact.availability_until is not null and v_artifact.availability_until < now())
        then 'expired'
      when v_available then availability_status
      else 'blocked'
    end,
    availability_explanation = case
      when v_artifact.availability_status = 'expired'
        or (v_artifact.availability_until is not null and v_artifact.availability_until < now())
        then jsonb_build_object(
          'ruleVersion', 'm2.v2.security-update-availability.v1',
          'status', 'expired', 'code', 'availability_expired'
        )
      when v_available then availability_explanation else
      jsonb_build_object(
        'ruleVersion', 'm2.v2.security-update-availability.v1',
        'status', 'blocked', 'code', p_monitor_outcome
      )
    end,
    version = version + 1, updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;

  perform public.m2_v2_set_lifecycle_dependency_fact(
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact', v_artifact.id, v_available, p_actor_user_id
  );
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, due_at, delivery_state
  ) values (
    p_organization_id, p_product_id, v_artifact.release_id,
    'security_update_artifact.external_reference_monitor',
    concat(
      'security-update-artifact:external-reference-monitor:', v_artifact.id::text,
      ':', to_char((now() + interval '1 day')::date, 'YYYYMMDD')
    ),
    jsonb_build_object('artifactId', v_artifact.id), p_correlation_id,
    now(), now() + interval '1 day', 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id,
    'product.security_update_artifact_external_reference_monitored',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('monitorOutcome', p_monitor_outcome, 'correlationId', p_correlation_id)
  );
  return query select 'monitored'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

-- Work is authorized at execution time, not by an event's historical
-- updated_by value. A deactivated member must never turn a durable event into
-- an accidentally completed no-op. The deterministic owner/admin is recorded
-- alongside the source actor in a separate audit fact after a successful
-- effect.
create or replace function public.m2_v2_resolve_security_update_artifact_worker_actor(
  p_organization_id uuid
) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  select member.user_id
  from public.organization_members member
  join public.users user_record
    on user_record.id = member.user_id and user_record.is_active
  where member.organization_id = p_organization_id
    and member.role in ('owner', 'admin')
  order by case member.role when 'owner' then 0 else 1 end, member.user_id
  limit 1
$$;

create or replace function public.finalize_product_security_update_artifact_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_verified_sha256 text, p_verified_byte_size bigint,
  p_verified_content_type text, p_integrity_status text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.finalize_product_security_update_artifact_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_verified_sha256, p_verified_byte_size, p_verified_content_type, p_integrity_status,
    p_correlation_id
  );
  if v_effect.outcome = 'finalized' then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'inspect', 'workerActorId', v_worker_actor,
        'sourceUpdatedBy', v_source_updated_by, 'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.recalc_security_update_artifact_availability_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.recalc_product_security_update_artifact_availability_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_correlation_id
  );
  if v_effect.outcome in ('recalculated', 'blocked') then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'availability_recalculate', 'workerActorId', v_worker_actor,
        'sourceUpdatedBy', v_source_updated_by, 'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.schedule_security_update_artifact_cleanup_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.schedule_product_security_update_artifact_cleanup_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_correlation_id
  );
  if v_effect.outcome = 'scheduled' then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'cleanup', 'workerActorId', v_worker_actor,
        'sourceUpdatedBy', v_source_updated_by, 'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.monitor_security_update_external_reference_worker_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid,
  p_expected_version integer, p_monitor_outcome text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker_actor uuid;
  v_source_updated_by uuid;
  v_effect record;
begin
  select public.m2_v2_resolve_security_update_artifact_worker_actor(p_organization_id)
    into v_worker_actor;
  if v_worker_actor is null then
    return query select 'retryable_unavailable'::text, null::jsonb;
    return;
  end if;
  select updated_by into v_source_updated_by
  from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for share;
  select * into v_effect from public.monitor_product_security_update_external_reference_atomic(
    p_organization_id, p_product_id, p_artifact_id, v_worker_actor, p_expected_version,
    p_monitor_outcome, p_correlation_id
  );
  if v_effect.outcome = 'monitored' then
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (
      p_organization_id, v_worker_actor,
      'product.security_update_artifact_worker_effect_authorized',
      'product_security_update_artifact', p_artifact_id::text,
      jsonb_build_object('operation', 'external_reference_monitor',
        'workerActorId', v_worker_actor, 'sourceUpdatedBy', v_source_updated_by,
        'correlationId', p_correlation_id)
    );
  end if;
  return query select v_effect.outcome, v_effect.artifact;
end;
$$;

create or replace function public.list_product_substantial_modification_assessments(
  p_organization_id uuid, p_product_id uuid, p_actor_user_id uuid,
  p_release_id uuid, p_status text, p_page integer, p_page_size integer
) returns table(outcome text, assessments jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer;
begin
  if p_page not between 1 and 1000000 or p_page_size not between 1 and 100 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists (select 1 from public.products where organization_id = p_organization_id and id = p_product_id)
     or (p_release_id is not null and not exists (
       select 1 from public.product_releases
       where organization_id = p_organization_id and product_id = p_product_id and id = p_release_id
     )) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_status is not null and p_status not in ('draft', 'in_progress', 'submitted_for_review', 'reviewed', 'superseded') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select count(*) into v_total
  from public.product_substantial_modification_assessments assessment
  where assessment.organization_id = p_organization_id and assessment.product_id = p_product_id
    and (p_status is null or assessment.status = p_status)
    and (p_release_id is null or exists (
      select 1 from public.product_substantial_modification_releases joins
      where joins.organization_id = assessment.organization_id and joins.assessment_id = assessment.id
        and joins.release_id = p_release_id
    ));
  return query select 'found'::text, jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(public.m2_v2_assessment_json(page_row)
        order by page_row.created_at desc, page_row.id desc)
      from (
        select assessment.* from public.product_substantial_modification_assessments assessment
        where assessment.organization_id = p_organization_id and assessment.product_id = p_product_id
          and (p_status is null or assessment.status = p_status)
          and (p_release_id is null or exists (
            select 1 from public.product_substantial_modification_releases joins
            where joins.organization_id = assessment.organization_id and joins.assessment_id = assessment.id
              and joins.release_id = p_release_id
          ))
        order by assessment.created_at desc, assessment.id desc
        offset (p_page - 1) * p_page_size limit p_page_size
      ) page_row
    ), '[]'::jsonb),
    'total', v_total, 'page', p_page, 'pageSize', p_page_size,
    'pageCount', greatest(1, ceil(v_total::numeric / p_page_size)::integer)
  );
end;
$$;

create or replace function public.list_product_security_update_artifacts(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_publication_status text, p_page integer, p_page_size integer
) returns table(outcome text, artifacts jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer;
begin
  if p_page not between 1 and 1000000 or p_page_size not between 1 and 100 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id)
     or not exists (select 1 from public.products where organization_id = p_organization_id and id = p_product_id)
     or (p_release_id is not null and not exists (
       select 1 from public.product_releases
       where organization_id = p_organization_id and product_id = p_product_id and id = p_release_id
     )) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if p_publication_status is not null and p_publication_status not in ('draft', 'published', 'replaced', 'withdrawn') then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select count(*) into v_total from public.product_security_update_artifacts artifact
  where artifact.organization_id = p_organization_id and artifact.product_id = p_product_id
    and (p_release_id is null or artifact.release_id = p_release_id)
    and (p_publication_status is null or artifact.publication_status = p_publication_status);
  return query select 'found'::text, jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(public.m2_v2_security_update_artifact_json(page_row, false)
        order by page_row.created_at desc, page_row.id desc)
      from (
        select artifact.* from public.product_security_update_artifacts artifact
        where artifact.organization_id = p_organization_id and artifact.product_id = p_product_id
          and (p_release_id is null or artifact.release_id = p_release_id)
          and (p_publication_status is null or artifact.publication_status = p_publication_status)
        order by artifact.created_at desc, artifact.id desc
        offset (p_page - 1) * p_page_size limit p_page_size
      ) page_row
    ), '[]'::jsonb),
    'total', v_total, 'page', p_page, 'pageSize', p_page_size,
    'pageCount', greatest(1, ceil(v_total::numeric / p_page_size)::integer)
  );
end;
$$;

alter function public.get_product_security_update_artifact(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid) owner to postgres;
alter function public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid) owner to postgres;
alter function public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;
alter function public.recalc_product_security_update_artifact_availability_atomic(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid) owner to postgres;
alter function public.replace_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, uuid, integer, text, uuid) owner to postgres;
alter function public.withdraw_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, uuid) owner to postgres;
alter function public.download_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.schedule_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid) owner to postgres;
alter function public.m2_v2_resolve_security_update_artifact_worker_actor(uuid) owner to postgres;
alter function public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid) owner to postgres;
alter function public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid) owner to postgres;
alter function public.list_product_substantial_modification_assessments(uuid, uuid, uuid, uuid, text, integer, integer) owner to postgres;
alter function public.list_product_security_update_artifacts(uuid, uuid, uuid, uuid, text, integer, integer) owner to postgres;

revoke all on function
  public.get_product_security_update_artifact(uuid, uuid, uuid, uuid),
  public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid),
  public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.recalc_product_security_update_artifact_availability_atomic(uuid, uuid, uuid, uuid, uuid),
  public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid),
  public.replace_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, uuid, integer, text, uuid),
  public.withdraw_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.download_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid),
  public.schedule_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, uuid),
  public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid),
  public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid),
  public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid),
  public.list_product_substantial_modification_assessments(uuid, uuid, uuid, uuid, text, integer, integer),
  public.list_product_security_update_artifacts(uuid, uuid, uuid, uuid, text, integer, integer)
from public, anon, authenticated;
grant execute on function
  public.get_product_security_update_artifact(uuid, uuid, uuid, uuid),
  public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid),
  public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.recalc_product_security_update_artifact_availability_atomic(uuid, uuid, uuid, uuid, uuid),
  public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid),
  public.replace_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, uuid, integer, text, uuid),
  public.withdraw_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.download_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid),
  public.schedule_product_security_update_artifact_cleanup_atomic(uuid, uuid, uuid, uuid, uuid),
  public.monitor_product_security_update_external_reference_atomic(uuid, uuid, uuid, uuid, integer, text, uuid),
  public.finalize_product_security_update_artifact_worker_atomic(uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.recalc_security_update_artifact_availability_worker_atomic(uuid, uuid, uuid, uuid),
  public.schedule_security_update_artifact_cleanup_worker_atomic(uuid, uuid, uuid, uuid),
  public.monitor_security_update_external_reference_worker_atomic(uuid, uuid, uuid, integer, text, uuid),
  public.list_product_substantial_modification_assessments(uuid, uuid, uuid, uuid, text, integer, integer),
  public.list_product_security_update_artifacts(uuid, uuid, uuid, uuid, text, integer, integer)
to service_role;

revoke all on function public.m2_v2_resolve_security_update_artifact_worker_actor(uuid)
from public, anon, authenticated;
