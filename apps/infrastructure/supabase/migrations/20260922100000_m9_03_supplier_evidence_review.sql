-- M9-03: attributable internal review for immutable supplier evidence.
--
-- Review decisions are intentionally append-only.  A re-request creates a
-- distinct request revision and invitation; it never changes a prior
-- submission, decision, evidence version, or technical-file snapshot.

alter table public.supplier_evidence_requests
  add column review_state text not null default 'pending_response'
    check (review_state in ('pending_response','partial_response','pending_processing','awaiting_review','accepted','rejected','re_requested'));

alter table public.supplier_evidence_request_items
  add column source_request_item_id uuid,
  add column re_request_reason text
    check (re_request_reason is null or (
      re_request_reason = btrim(re_request_reason)
      and char_length(re_request_reason) between 1 and 500
      and re_request_reason !~ '[[:cntrl:]]'
    ));

alter table public.supplier_evidence_request_items
  add constraint supplier_evidence_request_items_source_fk
    foreign key (organization_id, source_request_item_id)
    references public.supplier_evidence_request_items(organization_id, id)
    on delete restrict;

alter table public.supplier_evidence_invitations
  add column delivery_state text not null default 'pending'
    check (delivery_state in ('pending','delivered','failed')),
  add column delivery_attempt_count integer not null default 0 check (delivery_attempt_count >= 0),
  add column delivery_error text
    check (delivery_error is null or (
      delivery_error = btrim(delivery_error)
      and char_length(delivery_error) between 1 and 1000
      and delivery_error !~ '[[:cntrl:]]'
    )),
  add column delivered_at timestamptz;

alter table public.supplier_evidence_invitations
  add constraint supplier_evidence_invitations_delivery_consistency_check
  check (
    (delivery_state = 'delivered' and delivered_at is not null and delivery_error is null)
    or (delivery_state = 'failed' and delivered_at is null and delivery_error is not null)
    or (delivery_state = 'pending' and delivered_at is null and delivery_error is null)
  );

alter table public.supplier_evidence_submissions
  drop constraint supplier_evidence_submissions_state_check;
alter table public.supplier_evidence_submissions
  add constraint supplier_evidence_submissions_state_check
    check (state in ('uploading','scan_pending','submitted_pending_review','accepted','rejected','failed','cancelled'));

create table public.supplier_evidence_submission_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  submission_id uuid not null,
  request_item_id uuid not null,
  evidence_document_id uuid not null,
  evidence_version_id uuid not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  reviewer_user_id uuid not null references public.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected')),
  supplier_visible_reason text check (supplier_visible_reason is null or (
    supplier_visible_reason = btrim(supplier_visible_reason)
    and char_length(supplier_visible_reason) between 1 and 500
    and supplier_visible_reason !~ '[[:cntrl:]]'
  )),
  internal_note text check (internal_note is null or (
    internal_note = btrim(internal_note)
    and char_length(internal_note) between 1 and 2000
    and internal_note !~ '[[:cntrl:]]'
  )),
  request_version integer not null check (request_version >= 0),
  submission_updated_at timestamptz not null,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, submission_id),
  unique (organization_id, reviewer_user_id, idempotency_key),
  foreign key (organization_id, request_id)
    references public.supplier_evidence_requests(organization_id, id) on delete restrict,
  foreign key (organization_id, submission_id)
    references public.supplier_evidence_submissions(organization_id, id) on delete restrict,
  foreign key (organization_id, request_item_id)
    references public.supplier_evidence_request_items(organization_id, id) on delete restrict,
  foreign key (organization_id, evidence_document_id)
    references public.evidence_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, evidence_version_id)
    references public.evidence_document_versions(organization_id, id) on delete restrict,
  check (
    (decision = 'accepted' and supplier_visible_reason is null)
    or (decision = 'rejected' and supplier_visible_reason is not null)
  )
);

alter table public.supplier_evidence_request_commands
  drop constraint supplier_evidence_request_commands_operation_check;
alter table public.supplier_evidence_request_commands
  add constraint supplier_evidence_request_commands_operation_check
    check (operation in ('create','revise','issue','reissue','revoke','close','re_request','delivery'));

create index supplier_evidence_reviews_request_idx
  on public.supplier_evidence_submission_reviews(organization_id, request_id, created_at desc, id);
create index supplier_evidence_reviews_submission_idx
  on public.supplier_evidence_submission_reviews(organization_id, submission_id);
create index supplier_evidence_submissions_review_queue_idx
  on public.supplier_evidence_submissions(organization_id, state, updated_at desc, id)
  where state in ('submitted_pending_review','scan_pending');
create index supplier_evidence_invitations_delivery_idx
  on public.supplier_evidence_invitations(organization_id, delivery_state, created_at desc, id)
  where delivery_state in ('pending','failed');

-- The shared permission resolver is the only place a base-role review grant is
-- added. Custom-role and organization override semantics remain unchanged.
create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_view_findings' then true
      when 'can_edit_findings' then role in ('owner', 'admin')
      when 'can_edit_organization' then role = 'owner'
      when 'can_submit_reporting' then role in ('owner', 'admin')
      when 'can_export_findings' then role in ('owner', 'admin')
      when 'can_manage_finding_publication' then role in ('owner', 'admin')
      when 'can_view_evidence' then true
      when 'can_upload_evidence' then role in ('owner', 'admin', 'member')
      when 'can_review_evidence' then role in ('owner', 'admin')
      else false end as granted
    from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments assignment
      on assignment.organization_id = p_organization_id and assignment.user_id = p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id = p_organization_id and custom_role.id = assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key) = 'boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key) = 'boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id = p_organization_id
      and permission_override.base_role = base_permission.role
  ) select coalesce((select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted, false) or coalesce(custom_permissions.granted, false)
      from base_permissions cross join custom_permissions), false)
$$;

create or replace function public.m9_03_internal_can_review(
  p_organization_id uuid, p_actor_user_id uuid
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.m8_evidence_actor_active(p_organization_id, p_actor_user_id)
    and public.m9_supplier_actor_can(p_organization_id, p_actor_user_id, 'can_view_suppliers')
    and public.m9_supplier_actor_can(p_organization_id, p_actor_user_id, 'can_view_products')
    and public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_view_evidence')
    and public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_review_evidence')
$$;

create or replace function public.m9_03_review_json(
  p_organization_id uuid, p_review_id uuid, p_include_internal boolean default true
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', review_row.id,
    'submissionId', review_row.submission_id,
    'checklistItemId', review_row.request_item_id,
    'evidenceDocumentId', review_row.evidence_document_id,
    'evidenceVersionId', review_row.evidence_version_id,
    'sha256', review_row.evidence_sha256,
    'evidenceSha256', review_row.evidence_sha256,
    'decision', review_row.decision,
    'supplierVisibleReason', review_row.supplier_visible_reason,
    'internalNote', case when p_include_internal then review_row.internal_note else null end,
    'reviewerUserId', case when p_include_internal then review_row.reviewer_user_id else null end,
    'reviewedByUserId', case when p_include_internal then review_row.reviewer_user_id else null end,
    'requestVersion', review_row.request_version,
    'submissionUpdatedAt', to_char(review_row.submission_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'createdAt', to_char(review_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'reviewedAt', to_char(review_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  from public.supplier_evidence_submission_reviews review_row
  where review_row.organization_id = p_organization_id and review_row.id = p_review_id
$$;

create or replace function public.m9_03_submission_json(
  p_organization_id uuid, p_submission_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', submission_row.id,
    'checklistItemId', submission_row.request_item_id,
    'revisionId', submission_row.revision_id,
    'state', submission_row.state,
    'fileName', submission_row.original_filename,
    'mediaType', submission_row.declared_media_type,
    'byteSize', submission_row.declared_size_bytes,
    'sha256', submission_row.declared_sha256,
    'evidenceDocumentId', submission_row.evidence_document_id,
    'evidenceVersionId', submission_row.evidence_version_id,
    'processingState', version_row.processing_state,
    'evidenceProcessingState', version_row.processing_state,
    'reviewState', coalesce((
      select review_row.decision
      from public.supplier_evidence_submission_reviews review_row
      where review_row.organization_id = p_organization_id and review_row.submission_id = submission_row.id
    ), case
      when submission_row.state = 'submitted_pending_review' then 'pending'
      when submission_row.state = 're_requested' then 're_requested'
      else null
    end),
    'rejectionReason', submission_row.supplier_visible_reason,
    'reviews', coalesce((
      select jsonb_agg(public.m9_03_review_json(p_organization_id, review_row.id, true) order by review_row.created_at, review_row.id)
      from public.supplier_evidence_submission_reviews review_row
      where review_row.organization_id = p_organization_id and review_row.submission_id = submission_row.id
    ), '[]'::jsonb),
    'createdAt', to_char(submission_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    -- This exact optimistic-concurrency token is returned to the reviewer and
    -- then compared by review_supplier_evidence_submission_atomic. Do not
    -- round it: Postgres timestamps retain microseconds.
    'updatedAt', to_char(submission_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  from public.supplier_evidence_submissions submission_row
  join public.evidence_document_versions version_row
    on version_row.organization_id = submission_row.organization_id
   and version_row.id = submission_row.evidence_version_id
  where submission_row.organization_id = p_organization_id and submission_row.id = p_submission_id
$$;

create or replace function public.m9_03_review_item_json(
  p_organization_id uuid, p_request_item_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', item_row.id,
    'title', item_row.title,
    'instructions', item_row.instructions,
    'documentClass', item_row.document_class,
    'position', item_row.ordinal - 1,
    'sourceRequestItemId', item_row.source_request_item_id,
    'reRequestReason', item_row.re_request_reason,
    'state', case
      when exists (
        select 1 from public.supplier_evidence_submissions submission_row
        join public.supplier_evidence_submission_reviews review_row
          on review_row.organization_id = submission_row.organization_id
         and review_row.submission_id = submission_row.id
         and review_row.decision = 'accepted'
        where submission_row.organization_id = item_row.organization_id
          and submission_row.request_item_id = item_row.id
      ) then 'accepted'
      when exists (
        select 1 from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = item_row.organization_id
          and submission_row.request_item_id = item_row.id
          and submission_row.state = 'uploading'
      ) then 'uploading'
      when exists (
        select 1 from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = item_row.organization_id
          and submission_row.request_item_id = item_row.id
          and submission_row.state = 'scan_pending'
      ) then 'pending_processing'
      when exists (
        select 1 from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = item_row.organization_id
          and submission_row.request_item_id = item_row.id
          and submission_row.state = 'submitted_pending_review'
      ) then 'awaiting_review'
      when exists (
        select 1 from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = item_row.organization_id
          and submission_row.request_item_id = item_row.id
          and submission_row.state = 'rejected'
      ) then 'rejected'
      when exists (
        select 1 from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = item_row.organization_id
          and submission_row.request_item_id = item_row.id
          and submission_row.state in ('failed', 'cancelled')
      ) then 'failed'
      when item_row.source_request_item_id is not null then 're_requested'
      else 'missing'
    end,
    'submissions', coalesce((
      select jsonb_agg(public.m9_03_submission_json(p_organization_id, submission_row.id) order by submission_row.created_at, submission_row.id)
      from public.supplier_evidence_submissions submission_row
      where submission_row.organization_id = item_row.organization_id and submission_row.request_item_id = item_row.id
    ), '[]'::jsonb)
  )
  from public.supplier_evidence_request_items item_row
  where item_row.organization_id = p_organization_id and item_row.id = p_request_item_id
$$;

create or replace function public.m9_03_refresh_request_review_state(
  p_organization_id uuid, p_request_id uuid, p_preserve_rerequest boolean default false
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  request_row public.supplier_evidence_requests%rowtype;
  next_state text;
  required_count integer;
  accepted_count integer;
begin
  select * into request_row
  from public.supplier_evidence_requests
  where organization_id = p_organization_id and id = p_request_id
  for update;
  if not found then return null; end if;

  if p_preserve_rerequest and request_row.review_state = 're_requested' then
    return request_row.review_state;
  end if;

  select count(*) into required_count
  from public.supplier_evidence_request_items item_row
  where item_row.organization_id = p_organization_id
    and item_row.revision_id = request_row.current_revision_id
    and item_row.required;

  select count(distinct submission_row.request_item_id) into accepted_count
  from public.supplier_evidence_submissions submission_row
  join public.supplier_evidence_submission_reviews review_row
    on review_row.organization_id = submission_row.organization_id
   and review_row.submission_id = submission_row.id
   and review_row.decision = 'accepted'
  where submission_row.organization_id = p_organization_id
    and submission_row.request_id = request_row.id
    and submission_row.revision_id = request_row.current_revision_id;

  if required_count > 0 and accepted_count = required_count then
    next_state := 'accepted';
  elsif exists (
    select 1 from public.supplier_evidence_submissions submission_row
    where submission_row.organization_id = p_organization_id
      and submission_row.request_id = request_row.id
      and submission_row.revision_id = request_row.current_revision_id
      and submission_row.state in ('uploading', 'scan_pending')
  ) then
    next_state := 'pending_processing';
  elsif exists (
    select 1 from public.supplier_evidence_submissions submission_row
    where submission_row.organization_id = p_organization_id
      and submission_row.request_id = request_row.id
      and submission_row.revision_id = request_row.current_revision_id
      and submission_row.state = 'submitted_pending_review'
  ) then
    next_state := 'awaiting_review';
  elsif exists (
    select 1 from public.supplier_evidence_submissions submission_row
    where submission_row.organization_id = p_organization_id
      and submission_row.request_id = request_row.id
      and submission_row.revision_id = request_row.current_revision_id
      and submission_row.state in ('rejected', 'failed', 'cancelled')
  ) then
    next_state := 'rejected';
  elsif exists (
    select 1 from public.supplier_evidence_submissions submission_row
    where submission_row.organization_id = p_organization_id
      and submission_row.request_id = request_row.id
      and submission_row.revision_id = request_row.current_revision_id
  ) then
    next_state := 'partial_response';
  else
    next_state := 'pending_response';
  end if;

  update public.supplier_evidence_requests
  set review_state = next_state, updated_at = clock_timestamp()
  where organization_id = p_organization_id and id = request_row.id;
  return next_state;
end $$;

create or replace function public.m9_03_sync_request_review_state()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.m9_03_refresh_request_review_state(
    new.organization_id,
    new.request_id,
    false
  );
  return new;
end $$;

do $$
declare request_row record;
begin
  for request_row in
    select organization_id, id from public.supplier_evidence_requests
  loop
    perform public.m9_03_refresh_request_review_state(request_row.organization_id, request_row.id, false);
  end loop;
end $$;

create trigger m9_03_sync_supplier_submission_review_state
after insert or update of state, request_item_id, revision_id on public.supplier_evidence_submissions
for each row execute function public.m9_03_sync_request_review_state();

create trigger m9_03_sync_supplier_review_state
after insert on public.supplier_evidence_submission_reviews
for each row execute function public.m9_03_sync_request_review_state();

create or replace function public.m9_02_invitation_json(
  p_organization_id uuid, p_invitation_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', invitation_row.id,
    'state', case when invitation_row.state = 'used' then 'active' else invitation_row.state end,
    'deliveryState', invitation_row.delivery_state,
    'deliveryAttemptCount', invitation_row.delivery_attempt_count,
    'deliveryError', invitation_row.delivery_error,
    'deliveryFailureMessage', invitation_row.delivery_error,
    'deliveredAt', case when invitation_row.delivered_at is null then null else to_char(invitation_row.delivered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'expiresAt', to_char(invitation_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'issuedAt', to_char(invitation_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'revokedAt', case when invitation_row.revoked_at is null then null else to_char(invitation_row.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'revisionId', invitation_row.revision_id
  )
  from public.supplier_evidence_invitations invitation_row
  where invitation_row.organization_id = p_organization_id and invitation_row.id = p_invitation_id
$$;

create or replace function public.m9_02_request_summary_json(
  p_organization_id uuid, p_request_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', request_row.id,
    'supplierId', request_row.supplier_id,
    'recipientContactId', request_row.recipient_contact_id,
    'productId', request_row.product_id,
    'ownerUserId', request_row.internal_owner_user_id,
    'state', request_row.state,
    'reviewState', request_row.review_state,
    'aggregateReviewState', request_row.review_state,
    'version', request_row.version,
    'currentRevision', public.m9_02_revision_json(request_row.organization_id, request_row.current_revision_id, false),
    'activeInvitation', (
      select public.m9_02_invitation_json(request_row.organization_id, invitation_row.id)
      from public.supplier_evidence_invitations invitation_row
      where invitation_row.organization_id = request_row.organization_id
        and invitation_row.request_id = request_row.id
        and invitation_row.state in ('active', 'used')
      order by invitation_row.created_at desc
      limit 1
    ),
    'createdAt', to_char(request_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updatedAt', to_char(request_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  from public.supplier_evidence_requests request_row
  where request_row.organization_id = p_organization_id and request_row.id = p_request_id
$$;

create or replace function public.m9_02_request_json(
  p_organization_id uuid, p_request_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.m9_02_request_summary_json(request_row.organization_id, request_row.id)
    || jsonb_build_object(
      'revisions', coalesce((
        select jsonb_agg(public.m9_02_revision_json(request_row.organization_id, revision_row.id) order by revision_row.revision_number)
        from public.supplier_evidence_request_revisions revision_row
        where revision_row.organization_id = request_row.organization_id and revision_row.request_id = request_row.id
      ), '[]'::jsonb),
      'invitations', coalesce((
        select jsonb_agg(public.m9_02_invitation_json(request_row.organization_id, invitation_row.id) order by invitation_row.created_at desc)
        from public.supplier_evidence_invitations invitation_row
        where invitation_row.organization_id = request_row.organization_id and invitation_row.request_id = request_row.id
      ), '[]'::jsonb)
    )
  from public.supplier_evidence_requests request_row
  where request_row.organization_id = p_organization_id and request_row.id = p_request_id
$$;

create or replace function public.m9_03_request_review_json(
  p_organization_id uuid, p_request_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.m9_02_request_json(request_row.organization_id, request_row.id)
    || jsonb_build_object(
      'submissions', coalesce((
        select jsonb_agg(public.m9_03_submission_json(request_row.organization_id, submission_row.id) order by submission_row.created_at, submission_row.id)
        from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = request_row.organization_id and submission_row.request_id = request_row.id
      ), '[]'::jsonb),
      'reviewItems', coalesce((
        select jsonb_agg(public.m9_03_review_item_json(request_row.organization_id, item_row.id) order by item_row.ordinal)
        from public.supplier_evidence_request_items item_row
        where item_row.organization_id = request_row.organization_id
          and item_row.revision_id = request_row.current_revision_id
      ), '[]'::jsonb),
      'reviews', coalesce((
        select jsonb_agg(public.m9_03_review_json(request_row.organization_id, review_row.id, true) order by review_row.created_at, review_row.id)
        from public.supplier_evidence_submission_reviews review_row
        where review_row.organization_id = request_row.organization_id and review_row.request_id = request_row.id
      ), '[]'::jsonb)
    )
  from public.supplier_evidence_requests request_row
  where request_row.organization_id = p_organization_id and request_row.id = p_request_id
$$;

create or replace function public.review_supplier_evidence_submission_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_submission_id uuid,
  p_expected_request_version integer,
  p_expected_submission_updated_at timestamptz,
  p_expected_evidence_version_id uuid,
  p_expected_sha256 text,
  p_decision text,
  p_supplier_visible_reason text,
  p_internal_note text,
  p_idempotency_key uuid
) returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  request_row public.supplier_evidence_requests%rowtype;
  submission_row public.supplier_evidence_submissions%rowtype;
  version_row public.evidence_document_versions%rowtype;
  prior_review public.supplier_evidence_submission_reviews%rowtype;
  review_id uuid;
  digest text;
  response jsonb;
begin
  if not public.m9_03_internal_can_review(p_organization_id, p_actor_user_id) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  if p_idempotency_key is null or p_expected_request_version is null
    or p_expected_submission_updated_at is null
    or p_expected_evidence_version_id is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_decision not in ('accepted', 'rejected')
    or (p_decision = 'accepted' and p_supplier_visible_reason is not null)
    or (p_decision = 'rejected' and (
      p_supplier_visible_reason is null or p_supplier_visible_reason <> btrim(p_supplier_visible_reason)
      or char_length(p_supplier_visible_reason) not between 1 and 500
      or p_supplier_visible_reason ~ '[[:cntrl:]]'
    ))
    or (p_internal_note is not null and (
      p_internal_note <> btrim(p_internal_note) or char_length(p_internal_note) not between 1 and 2000
      or p_internal_note ~ '[[:cntrl:]]'
    )) then
    return query select 'invalid_request', null::jsonb; return;
  end if;

  digest := encode(extensions.digest(jsonb_build_object(
    'requestId', p_request_id,
    'submissionId', p_submission_id,
    'expectedRequestVersion', p_expected_request_version,
    'expectedSubmissionUpdatedAt', to_char(p_expected_submission_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'evidenceVersionId', p_expected_evidence_version_id,
    'sha256', p_expected_sha256,
    'decision', p_decision,
    'supplierVisibleReason', p_supplier_visible_reason,
    'internalNote', p_internal_note
  )::text, 'sha256'), 'hex');

  select * into prior_review
  from public.supplier_evidence_submission_reviews
  where organization_id = p_organization_id
    and reviewer_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key;
  if found then
    return query select case when prior_review.request_digest = digest then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('request', public.m9_03_request_review_json(p_organization_id, prior_review.request_id),
                         'review', public.m9_03_review_json(p_organization_id, prior_review.id, true));
    return;
  end if;

  select * into request_row
  from public.supplier_evidence_requests
  where organization_id = p_organization_id and id = p_request_id
  for update;
  if not found then return query select 'not_found', null::jsonb; return; end if;
  if request_row.state <> 'open' or request_row.version <> p_expected_request_version then
    return query select 'conflict', public.m9_03_request_review_json(p_organization_id, request_row.id); return;
  end if;

  select * into submission_row
  from public.supplier_evidence_submissions
  where organization_id = p_organization_id and id = p_submission_id and request_id = request_row.id
  for update;
  if not found then return query select 'not_found', null::jsonb; return; end if;
  if submission_row.revision_id <> request_row.current_revision_id
    or submission_row.state <> 'submitted_pending_review'
    or submission_row.updated_at <> p_expected_submission_updated_at
    or submission_row.evidence_version_id <> p_expected_evidence_version_id
    or submission_row.declared_sha256 <> p_expected_sha256 then
    return query select 'conflict', public.m9_03_submission_json(p_organization_id, submission_row.id); return;
  end if;

  -- A reviewer can lose membership or the review grant while the detail view
  -- is open. Re-check after taking the decision locks before the durable write.
  if not public.m9_03_internal_can_review(p_organization_id, p_actor_user_id) then
    return query select 'forbidden', null::jsonb; return;
  end if;

  select * into version_row
  from public.evidence_document_versions
  where organization_id = p_organization_id and id = submission_row.evidence_version_id
  for update;
  if not found or version_row.processing_state <> 'clean'
    or version_row.original_sha256 <> submission_row.declared_sha256
    or version_row.original_sha256 <> p_expected_sha256 then
    return query select 'conflict', jsonb_build_object(
      'submission', public.m9_03_submission_json(p_organization_id, submission_row.id),
      'evidenceProcessingState', coalesce(version_row.processing_state, 'missing')
    ); return;
  end if;

  select * into prior_review
  from public.supplier_evidence_submission_reviews
  where organization_id = p_organization_id and submission_id = submission_row.id;
  if found then
    return query select 'conflict', jsonb_build_object(
      'request', public.m9_03_request_review_json(p_organization_id, request_row.id),
      'review', public.m9_03_review_json(p_organization_id, prior_review.id, true)
    ); return;
  end if;

  insert into public.supplier_evidence_submission_reviews(
    organization_id, request_id, submission_id, request_item_id,
    evidence_document_id, evidence_version_id, evidence_sha256, reviewer_user_id,
    decision, supplier_visible_reason, internal_note, request_version,
    submission_updated_at, idempotency_key, request_digest
  ) values (
    p_organization_id, request_row.id, submission_row.id, submission_row.request_item_id,
    submission_row.evidence_document_id, submission_row.evidence_version_id,
    submission_row.declared_sha256, p_actor_user_id,
    p_decision, nullif(p_supplier_visible_reason, ''), nullif(p_internal_note, ''),
    request_row.version, submission_row.updated_at, p_idempotency_key, digest
  ) returning id into review_id;

  update public.supplier_evidence_submissions
  set state = p_decision,
      supplier_visible_reason = case when p_decision = 'rejected' then p_supplier_visible_reason else null end,
      updated_at = clock_timestamp()
  where organization_id = p_organization_id and id = submission_row.id;

  perform public.m9_03_refresh_request_review_state(p_organization_id, request_row.id, false);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'supplier.evidence_submission_reviewed',
    'supplier_evidence_submission_review', review_id::text,
    jsonb_build_object('requestId', request_row.id, 'submissionId', submission_row.id,
      'evidenceVersionId', submission_row.evidence_version_id, 'sha256', submission_row.declared_sha256,
      'decision', p_decision)
  );

  response := jsonb_build_object(
    'request', public.m9_03_request_review_json(p_organization_id, request_row.id),
    'review', public.m9_03_review_json(p_organization_id, review_id, true)
  );
  return query select case when p_decision = 'accepted' then 'accepted' else 'rejected' end, response;
end $$;

create or replace function public.m9_03_validate_follow_up_payload(
  p_organization_id uuid, p_request_id uuid, p_payload jsonb
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  request_row public.supplier_evidence_requests%rowtype;
  current_revision public.supplier_evidence_request_revisions%rowtype;
  item_value jsonb;
  source_item_id uuid;
  due_at_value timestamptz;
  normalized_items jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object' then return null; end if;
  begin due_at_value := (p_payload ->> 'dueAt')::timestamptz; exception when others then return null; end;
  if due_at_value <= clock_timestamp() or jsonb_typeof(p_payload -> 'items') <> 'array'
    or jsonb_array_length(p_payload -> 'items') not between 1 and 25 then return null; end if;
  select * into request_row from public.supplier_evidence_requests
  where organization_id = p_organization_id and id = p_request_id;
  if not found then return null; end if;
  select * into current_revision from public.supplier_evidence_request_revisions
  where organization_id = p_organization_id and id = request_row.current_revision_id;

  for item_value in select value from jsonb_array_elements(p_payload -> 'items') loop
    begin source_item_id := (item_value ->> 'sourceRequestItemId')::uuid; exception when others then return null; end;
    if item_value ->> 'title' is null
      or item_value ->> 'title' <> btrim(item_value ->> 'title')
      or char_length(item_value ->> 'title') not between 1 and 160
      or item_value ->> 'title' ~ '[[:cntrl:]]'
      or coalesce(item_value ->> 'documentClass', '') not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')
      or (item_value ? 'instructions' and ((item_value ->> 'instructions') <> btrim(item_value ->> 'instructions') or char_length(item_value ->> 'instructions') > 2000 or (item_value ->> 'instructions') ~ '[[:cntrl:]]'))
      or not exists (
        select 1 from public.supplier_evidence_request_items source_item
        where source_item.organization_id = p_organization_id
          and source_item.id = source_item_id
          and source_item.revision_id = current_revision.id
          and source_item.required
      )
      or exists (
        select 1 from public.supplier_evidence_submissions submission_row
        where submission_row.organization_id = p_organization_id
          and submission_row.request_id = request_row.id
          and submission_row.revision_id = current_revision.id
          and submission_row.request_item_id = source_item_id
          and submission_row.state not in ('rejected', 'failed', 'cancelled')
      ) then
      return null;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'items') value
    group by value ->> 'sourceRequestItemId' having count(*) > 1
  ) then return null; end if;

  select jsonb_agg(jsonb_build_object(
    'sourceRequestItemId', value ->> 'sourceRequestItemId',
    'title', value ->> 'title',
    'instructions', coalesce(value ->> 'instructions', ''),
    'documentClass', value ->> 'documentClass'
  ) order by ordinality) into normalized_items
  from jsonb_array_elements(p_payload -> 'items') with ordinality as payload_items(value, ordinality);
  return jsonb_build_object(
    'dueAt', to_char(due_at_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items', normalized_items
  );
end $$;

create or replace function public.re_request_supplier_evidence_request_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_follow_up_payload jsonb,
  p_token_hash text,
  p_expires_at timestamptz,
  p_idempotency_key uuid
) returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  request_row public.supplier_evidence_requests%rowtype;
  prior_revision public.supplier_evidence_request_revisions%rowtype;
  prior_command public.supplier_evidence_request_commands%rowtype;
  next_revision_id uuid;
  invitation_id uuid;
  normalized_payload jsonb;
  digest text;
  item_value jsonb;
  source_reason text;
  ordinal_value integer := 0;
  response jsonb;
begin
  if not public.m9_03_internal_can_review(p_organization_id, p_actor_user_id) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  if p_idempotency_key is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at not between clock_timestamp() + interval '1 minute' and clock_timestamp() + interval '7 days 1 minute' then
    return query select 'invalid_request', null::jsonb; return;
  end if;
  normalized_payload := public.m9_03_validate_follow_up_payload(p_organization_id, p_request_id, p_follow_up_payload);
  if normalized_payload is null then return query select 'invalid_request', null::jsonb; return; end if;
  -- The token and expiry are deliberately excluded: the use case generates
  -- fresh ephemeral values for a network retry, while the command row retains
  -- the original invitation outcome and never returns its raw token.
  digest := encode(extensions.digest(jsonb_build_object(
    'requestId', p_request_id, 'expectedVersion', p_expected_version,
    'followUpPayload', normalized_payload
  )::text, 'sha256'), 'hex');
  select * into prior_command
  from public.supplier_evidence_request_commands
  where organization_id = p_organization_id and actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    return query select case when prior_command.operation = 're_request' and prior_command.request_digest = digest then 'replayed' else 'idempotency_conflict' end, prior_command.result;
    return;
  end if;
  select * into request_row from public.supplier_evidence_requests
  where organization_id = p_organization_id and id = p_request_id for update;
  if not found then return query select 'not_found', null::jsonb; return; end if;
  if request_row.state <> 'open' or request_row.version <> p_expected_version then
    return query select 'conflict', public.m9_02_request_json(p_organization_id, request_row.id); return;
  end if;
  if not public.m9_03_internal_can_review(p_organization_id, p_actor_user_id) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  select * into prior_revision from public.supplier_evidence_request_revisions
  where organization_id = p_organization_id and id = request_row.current_revision_id;

  insert into public.supplier_evidence_request_revisions(
    organization_id, request_id, revision_number, portal_title, instructions, due_at,
    disclosure_payload, disclosure_digest, created_by_user_id
  ) values (
    p_organization_id, request_row.id, prior_revision.revision_number + 1,
    prior_revision.portal_title, prior_revision.instructions, (normalized_payload ->> 'dueAt')::timestamptz,
    prior_revision.disclosure_payload, prior_revision.disclosure_digest, p_actor_user_id
  ) returning id into next_revision_id;

  for item_value in select value from jsonb_array_elements(normalized_payload -> 'items') loop
    ordinal_value := ordinal_value + 1;
    select review_row.supplier_visible_reason into source_reason
    from public.supplier_evidence_submission_reviews review_row
    join public.supplier_evidence_submissions submission_row
      on submission_row.organization_id = review_row.organization_id
     and submission_row.id = review_row.submission_id
    where review_row.organization_id = p_organization_id
      and submission_row.request_id = request_row.id
      and submission_row.request_item_id = (item_value ->> 'sourceRequestItemId')::uuid
      and review_row.decision = 'rejected'
    order by review_row.created_at desc
    limit 1;

    insert into public.supplier_evidence_request_items(
      organization_id, revision_id, ordinal, title, instructions, document_class,
      required, source_request_item_id, re_request_reason
    ) values (
      p_organization_id, next_revision_id, ordinal_value, item_value ->> 'title',
      nullif(item_value ->> 'instructions', ''), item_value ->> 'documentClass',
      true, (item_value ->> 'sourceRequestItemId')::uuid, source_reason
    );
  end loop;

  update public.supplier_evidence_invitations
  set state = 'revoked', revoked_at = clock_timestamp(), revoked_by_user_id = p_actor_user_id
  where organization_id = p_organization_id and request_id = request_row.id and state in ('active', 'used');

  insert into public.supplier_evidence_invitations(
    organization_id, request_id, revision_id, token_prefix, token_hash,
    expires_at, created_by_user_id
  ) values (
    p_organization_id, request_row.id, next_revision_id,
    'cra_sev_' || substr(p_token_hash, 1, 8), p_token_hash, p_expires_at, p_actor_user_id
  ) returning id into invitation_id;

  update public.supplier_evidence_requests
  set current_revision_id = next_revision_id,
      review_state = 're_requested',
      version = version + 1,
      updated_at = clock_timestamp()
  where organization_id = p_organization_id and id = request_row.id;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'supplier.evidence_request_re_requested',
    'supplier_evidence_request', request_row.id::text,
    jsonb_build_object('previousRevisionId', prior_revision.id, 'revisionId', next_revision_id,
      'invitationId', invitation_id, 'itemCount', ordinal_value)
  );
  response := jsonb_build_object(
    'request', public.m9_02_request_json(p_organization_id, request_row.id),
    'invitation', public.m9_02_invitation_json(p_organization_id, invitation_id),
    'recipientEmail', request_row.recipient_email
  );
  insert into public.supplier_evidence_request_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 're_request', digest, response);
  return query select 're_requested', response;
end $$;

create or replace function public.mark_supplier_evidence_invitation_delivery_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_invitation_id uuid,
  p_expected_request_version integer,
  p_delivery_state text,
  p_delivery_error text,
  p_idempotency_key uuid
) returns table(outcome text, result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  request_row public.supplier_evidence_requests%rowtype;
  invitation_row public.supplier_evidence_invitations%rowtype;
  prior_command public.supplier_evidence_request_commands%rowtype;
  digest text;
  response jsonb;
begin
  if not public.m9_02_internal_can(p_organization_id, p_actor_user_id, true) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  if p_idempotency_key is null or p_delivery_state not in ('delivered', 'failed')
    or (p_delivery_state = 'delivered' and p_delivery_error is not null)
    or (p_delivery_state = 'failed' and (
      p_delivery_error is null or p_delivery_error <> btrim(p_delivery_error)
      or char_length(p_delivery_error) not between 1 and 1000 or p_delivery_error ~ '[[:cntrl:]]'
    )) then
    return query select 'invalid_request', null::jsonb; return;
  end if;
  digest := encode(extensions.digest(jsonb_build_object(
    'requestId', p_request_id, 'invitationId', p_invitation_id,
    'expectedRequestVersion', p_expected_request_version,
    'deliveryState', p_delivery_state, 'deliveryError', p_delivery_error
  )::text, 'sha256'), 'hex');
  select * into prior_command from public.supplier_evidence_request_commands
  where organization_id = p_organization_id and actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key;
  if found then
    return query select case when prior_command.operation = 'delivery' and prior_command.request_digest = digest then 'replayed' else 'idempotency_conflict' end, prior_command.result;
    return;
  end if;
  select * into request_row from public.supplier_evidence_requests
  where organization_id = p_organization_id and id = p_request_id for update;
  if not found then return query select 'not_found', null::jsonb; return; end if;
  if request_row.version <> p_expected_request_version then
    return query select 'conflict', public.m9_02_request_json(p_organization_id, request_row.id); return;
  end if;
  select * into invitation_row from public.supplier_evidence_invitations
  where organization_id = p_organization_id and id = p_invitation_id and request_id = request_row.id for update;
  if not found then return query select 'not_found', null::jsonb; return; end if;
  if invitation_row.delivery_state <> 'pending' then
    return query select 'conflict', public.m9_02_invitation_json(p_organization_id, invitation_row.id); return;
  end if;
  update public.supplier_evidence_invitations
  set delivery_state = p_delivery_state,
      delivery_attempt_count = delivery_attempt_count + 1,
      delivery_error = case when p_delivery_state = 'failed' then p_delivery_error else null end,
      delivered_at = case when p_delivery_state = 'delivered' then clock_timestamp() else null end
  where organization_id = p_organization_id and id = invitation_row.id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'supplier.evidence_invitation_delivery_' || p_delivery_state,
    'supplier_evidence_invitation', invitation_row.id::text,
    jsonb_build_object('requestId', request_row.id, 'attempt', invitation_row.delivery_attempt_count + 1)
  );
  response := public.m9_02_request_json(p_organization_id, request_row.id);
  insert into public.supplier_evidence_request_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'delivery', digest, response);
  return query select p_delivery_state, response;
end $$;

create or replace function public.get_supplier_evidence_request_review_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid
) returns table(outcome text, result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m9_03_internal_can_review(p_organization_id, p_actor_user_id) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  if not exists(select 1 from public.supplier_evidence_requests request_row where request_row.organization_id = p_organization_id and request_row.id = p_request_id) then
    return query select 'not_found', null::jsonb; return;
  end if;
  return query select 'found', public.m9_03_request_review_json(p_organization_id, p_request_id);
end $$;

create or replace function public.list_supplier_evidence_requests_filtered_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_supplier_id uuid default null,
  p_product_id uuid default null,
  p_state text default null,
  p_limit integer default 50,
  p_cursor uuid default null
) returns table(outcome text, result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare rows jsonb;
begin
  if not public.m9_02_internal_can(p_organization_id, p_actor_user_id, false) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  if p_limit not between 1 and 100
    or (p_supplier_id is not null and not exists(select 1 from public.supplier_organizations supplier_row where supplier_row.organization_id = p_organization_id and supplier_row.id = p_supplier_id and supplier_row.archived_at is null))
    or (p_product_id is not null and not exists(select 1 from public.products product_row where product_row.organization_id = p_organization_id and product_row.id = p_product_id and product_row.archived_at is null))
    or (p_state is not null and p_state not in ('draft','open','closed','revoked')) then
    return query select 'invalid_request', null::jsonb; return;
  end if;
  select coalesce(jsonb_agg(public.m9_02_request_summary_json(p_organization_id, scoped.id) order by scoped.id), '[]'::jsonb)
  into rows
  from (
    select request_row.id
    from public.supplier_evidence_requests request_row
    where request_row.organization_id = p_organization_id
      and (p_supplier_id is null or request_row.supplier_id = p_supplier_id)
      and (p_product_id is null or request_row.product_id = p_product_id)
      and (p_state is null or request_row.state = p_state)
      and (p_cursor is null or request_row.id > p_cursor)
    order by request_row.id
    limit p_limit
  ) scoped;
  return query select 'found', jsonb_build_object(
    'requests', rows,
    'nextCursor', case when jsonb_array_length(rows) = p_limit then rows -> (p_limit - 1) ->> 'id' else null end
  );
end $$;

create or replace function public.list_supplier_evidence_request_reviews_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_supplier_id uuid default null,
  p_product_id uuid default null,
  p_state text default null,
  p_limit integer default 50,
  p_cursor uuid default null
) returns table(outcome text, result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare rows jsonb;
begin
  if not public.m9_03_internal_can_review(p_organization_id, p_actor_user_id) then
    return query select 'forbidden', null::jsonb; return;
  end if;
  if p_limit not between 1 and 100
    or (p_supplier_id is not null and not exists(select 1 from public.supplier_organizations supplier_row where supplier_row.organization_id = p_organization_id and supplier_row.id = p_supplier_id and supplier_row.archived_at is null))
    or (p_product_id is not null and not exists(select 1 from public.products product_row where product_row.organization_id = p_organization_id and product_row.id = p_product_id and product_row.archived_at is null))
    or (p_state is not null and p_state not in ('draft','open','closed','revoked')) then
    return query select 'invalid_request', null::jsonb; return;
  end if;
  select coalesce(jsonb_agg(public.m9_02_request_summary_json(p_organization_id, scoped.id) order by scoped.id), '[]'::jsonb)
  into rows
  from (
    select request_row.id
    from public.supplier_evidence_requests request_row
    where request_row.organization_id = p_organization_id
      and (p_supplier_id is null or request_row.supplier_id = p_supplier_id)
      and (p_product_id is null or request_row.product_id = p_product_id)
      and (p_state is null or request_row.state = p_state)
      and (p_cursor is null or request_row.id > p_cursor)
    order by request_row.id
    limit p_limit
  ) scoped;
  return query select 'found', jsonb_build_object(
    'requests', rows,
    'nextCursor', case when jsonb_array_length(rows) = p_limit then rows -> (p_limit - 1) ->> 'id' else null end
  );
end $$;

-- M9-02's public projection deliberately remains scoped to a redeemed
-- invitation. Re-request lineage and supplier-safe reasons are exposed, while
-- reviewers, internal notes, document ids, and organization data stay absent.
create or replace function public.m9_02_portal_json(
  p_organization_id uuid, p_invitation_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'requestReference', 'request-' || left(replace(invitation_row.request_id::text, '-', ''), 12),
    'title', revision_row.portal_title,
    'instructions', nullif(revision_row.instructions, ''),
    'disclosureContent', revision_row.disclosure_payload ->> 'content',
    'dueAt', to_char(revision_row.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item_row.id, 'title', item_row.title, 'instructions', item_row.instructions,
        'documentClass', item_row.document_class, 'position', item_row.ordinal - 1,
        'reRequestReason', item_row.re_request_reason
      ) order by item_row.ordinal)
      from public.supplier_evidence_request_items item_row
      where item_row.organization_id = invitation_row.organization_id and item_row.revision_id = invitation_row.revision_id
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', submission_row.id, 'checklistItemId', submission_row.request_item_id,
        'state', submission_row.state, 'fileName', submission_row.original_filename,
        'mediaType', submission_row.declared_media_type, 'byteSize', submission_row.declared_size_bytes,
        'sha256', submission_row.declared_sha256, 'rejectionReason', submission_row.supplier_visible_reason,
        'createdAt', to_char(submission_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'updatedAt', to_char(submission_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ) order by submission_row.created_at, submission_row.id)
      from public.supplier_evidence_submissions submission_row
      where submission_row.organization_id = invitation_row.organization_id and submission_row.invitation_id = invitation_row.id
    ), '[]'::jsonb)
  )
  from public.supplier_evidence_invitations invitation_row
  join public.supplier_evidence_request_revisions revision_row
    on revision_row.organization_id = invitation_row.organization_id and revision_row.id = invitation_row.revision_id
  where invitation_row.organization_id = p_organization_id and invitation_row.id = p_invitation_id
$$;

-- M9-02 helpers are callable only through their security-definer entrypoints.
-- They are not an alternate service-role API surface.
alter function public.m9_02_internal_can(uuid, uuid, boolean) owner to postgres;
alter function public.m9_02_revision_json(uuid, uuid, boolean) owner to postgres;
alter function public.m9_02_validate_draft(uuid, uuid, jsonb) owner to postgres;
alter function public.m9_02_current_draft(uuid, uuid) owner to postgres;
alter function public.m9_02_insert_revision(uuid, uuid, uuid, jsonb) owner to postgres;
alter function public.m9_02_issue_invitation(uuid, uuid, uuid, integer, text, text, timestamptz, uuid, text) owner to postgres;
alter function public.m9_02_sync_submission_scan() owner to postgres;

alter table public.supplier_evidence_submission_reviews enable row level security;
revoke all on table public.supplier_evidence_submission_reviews from public, anon, authenticated;
grant select, insert on table public.supplier_evidence_submission_reviews to service_role;

alter function public.m5_triage_actor_has_permission(uuid, uuid, text) owner to postgres;
alter function public.m9_03_internal_can_review(uuid, uuid) owner to postgres;
alter function public.m9_03_review_json(uuid, uuid, boolean) owner to postgres;
alter function public.m9_03_submission_json(uuid, uuid) owner to postgres;
alter function public.m9_03_review_item_json(uuid, uuid) owner to postgres;
alter function public.m9_03_request_review_json(uuid, uuid) owner to postgres;
alter function public.m9_03_refresh_request_review_state(uuid, uuid, boolean) owner to postgres;
alter function public.m9_03_sync_request_review_state() owner to postgres;
alter function public.m9_03_validate_follow_up_payload(uuid, uuid, jsonb) owner to postgres;
alter function public.review_supplier_evidence_submission_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, uuid, text, text, text, text, uuid) owner to postgres;
alter function public.re_request_supplier_evidence_request_atomic(uuid, uuid, uuid, integer, jsonb, text, timestamptz, uuid) owner to postgres;
alter function public.mark_supplier_evidence_invitation_delivery_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;
alter function public.get_supplier_evidence_request_review_atomic(uuid, uuid, uuid) owner to postgres;
alter function public.list_supplier_evidence_requests_filtered_atomic(uuid, uuid, uuid, uuid, text, integer, uuid) owner to postgres;
alter function public.list_supplier_evidence_request_reviews_atomic(uuid, uuid, uuid, uuid, text, integer, uuid) owner to postgres;
alter function public.m9_02_invitation_json(uuid, uuid) owner to postgres;
alter function public.m9_02_request_summary_json(uuid, uuid) owner to postgres;
alter function public.m9_02_request_json(uuid, uuid) owner to postgres;
alter function public.m9_02_portal_json(uuid, uuid) owner to postgres;

-- Every helper is private. Only API-facing wrappers are executable by the
-- service role; this preserves the service-role boundary without PUBLIC leaks.
revoke all on function
  public.m5_triage_actor_has_permission(uuid, uuid, text),
  public.m9_02_internal_can(uuid, uuid, boolean),
  public.m9_02_revision_json(uuid, uuid, boolean),
  public.m9_02_validate_draft(uuid, uuid, jsonb),
  public.m9_02_current_draft(uuid, uuid),
  public.m9_02_insert_revision(uuid, uuid, uuid, jsonb),
  public.m9_02_issue_invitation(uuid, uuid, uuid, integer, text, text, timestamptz, uuid, text),
  public.m9_02_sync_submission_scan(),
  public.m9_03_internal_can_review(uuid, uuid),
  public.m9_03_review_json(uuid, uuid, boolean),
  public.m9_03_submission_json(uuid, uuid),
  public.m9_03_review_item_json(uuid, uuid),
  public.m9_03_request_review_json(uuid, uuid),
  public.m9_03_refresh_request_review_state(uuid, uuid, boolean),
  public.m9_03_sync_request_review_state(),
  public.m9_03_validate_follow_up_payload(uuid, uuid, jsonb),
  public.m9_02_invitation_json(uuid, uuid),
  public.m9_02_request_summary_json(uuid, uuid),
  public.m9_02_request_json(uuid, uuid),
  public.m9_02_portal_json(uuid, uuid),
  public.review_supplier_evidence_submission_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, uuid, text, text, text, text, uuid),
  public.re_request_supplier_evidence_request_atomic(uuid, uuid, uuid, integer, jsonb, text, timestamptz, uuid),
  public.mark_supplier_evidence_invitation_delivery_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.get_supplier_evidence_request_review_atomic(uuid, uuid, uuid),
  public.list_supplier_evidence_requests_filtered_atomic(uuid, uuid, uuid, uuid, text, integer, uuid),
  public.list_supplier_evidence_request_reviews_atomic(uuid, uuid, uuid, uuid, text, integer, uuid)
from public, anon, authenticated;

grant execute on function
  public.review_supplier_evidence_submission_atomic(uuid, uuid, uuid, uuid, integer, timestamptz, uuid, text, text, text, text, uuid),
  public.re_request_supplier_evidence_request_atomic(uuid, uuid, uuid, integer, jsonb, text, timestamptz, uuid),
  public.mark_supplier_evidence_invitation_delivery_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.get_supplier_evidence_request_review_atomic(uuid, uuid, uuid),
  public.list_supplier_evidence_requests_filtered_atomic(uuid, uuid, uuid, uuid, text, integer, uuid),
  public.list_supplier_evidence_request_reviews_atomic(uuid, uuid, uuid, uuid, text, integer, uuid)
to service_role;

notify pgrst, 'reload schema';
