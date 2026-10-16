-- Correct M9-03 boundary alignment without rewriting prior immutable history.

create or replace function public.m9_03_validate_follow_up_payload(
  p_organization_id uuid, p_request_id uuid, p_payload jsonb
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
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
      ) then return null;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'items') value
    group by value ->> 'sourceRequestItemId' having count(*) > 1
  ) then return null; end if;
  select jsonb_agg(jsonb_build_object(
    'sourceRequestItemId', value ->> 'sourceRequestItemId',
    'title', value ->> 'title', 'instructions', coalesce(value ->> 'instructions', ''),
    'documentClass', value ->> 'documentClass'
  ) order by ordinality) into normalized_items
  from jsonb_array_elements(p_payload -> 'items') with ordinality as payload_items(value, ordinality);
  return jsonb_build_object(
    'dueAt', to_char(due_at_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items', normalized_items
  );
end $$;

create or replace function public.re_request_supplier_evidence_request_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_request_id uuid,
  p_expected_version integer, p_follow_up_payload jsonb, p_token_hash text,
  p_expires_at timestamptz, p_idempotency_key uuid
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
  -- A retry receives a fresh ephemeral invitation token, so only durable intent
  -- participates in the replay digest. The raw original token is never replayed.
  digest := encode(extensions.digest(jsonb_build_object(
    'requestId', p_request_id, 'expectedVersion', p_expected_version,
    'followUpPayload', normalized_payload
  )::text, 'sha256'), 'hex');
  select * into prior_command from public.supplier_evidence_request_commands
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
      on submission_row.organization_id = review_row.organization_id and submission_row.id = review_row.submission_id
    where review_row.organization_id = p_organization_id
      and submission_row.request_id = request_row.id
      and submission_row.request_item_id = (item_value ->> 'sourceRequestItemId')::uuid
      and review_row.decision = 'rejected'
    order by review_row.created_at desc limit 1;
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
    organization_id, request_id, revision_id, token_prefix, token_hash, expires_at, created_by_user_id
  ) values (
    p_organization_id, request_row.id, next_revision_id,
    'cra_sev_' || substr(p_token_hash, 1, 8), p_token_hash, p_expires_at, p_actor_user_id
  ) returning id into invitation_id;
  update public.supplier_evidence_requests
  set current_revision_id = next_revision_id, review_state = 're_requested',
      version = version + 1, updated_at = clock_timestamp()
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

revoke all on function public.m9_03_validate_follow_up_payload(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.re_request_supplier_evidence_request_atomic(uuid, uuid, uuid, integer, jsonb, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.m9_02_portal_json(uuid, uuid) from public, anon, authenticated;
grant execute on function public.re_request_supplier_evidence_request_atomic(uuid, uuid, uuid, integer, jsonb, text, timestamptz, uuid) to service_role;
