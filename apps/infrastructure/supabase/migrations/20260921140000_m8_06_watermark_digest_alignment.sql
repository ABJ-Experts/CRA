-- Align watermark idempotency fingerprints with the API. JSON text is not a
-- stable cross-runtime digest format, especially for Unicode recipient data.
create or replace function public.m8_06_digest_parts(variadic p_parts text[])
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(
      coalesce(
        (
          select string_agg(octet_length(part)::text || ':' || part, '|' order by ord)
            from unnest(p_parts) with ordinality as parts(part, ord)
        ),
        ''
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.create_evidence_document_watermark_export_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_product_id uuid,
  p_document_id uuid,
  p_version_id uuid,
  p_recipient text,
  p_purpose text,
  p_idempotency_key uuid,
  p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.evidence_document_watermark_exports%rowtype;
  v public.evidence_document_versions%rowtype;
  d public.evidence_documents%rowtype;
  v_digest text;
begin
  if p_idempotency_key is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_recipient is null
    or p_recipient <> btrim(p_recipient)
    or char_length(p_recipient) not between 1 and 160
    or p_recipient ~ '[[:cntrl:]]'
    or p_purpose is null
    or p_purpose <> btrim(p_purpose)
    or char_length(p_purpose) not between 1 and 160
    or p_purpose ~ '[[:cntrl:]]'
    or not public.m8_05_actor_can_manage_evidence(p_organization_id, p_actor_user_id)
  then
    return query select 'forbidden', null::jsonb;
    return;
  end if;

  v_digest := public.m8_06_digest_parts(
    'm8-06-watermark-export',
    p_product_id::text,
    p_document_id::text,
    p_version_id::text,
    p_recipient,
    p_purpose
  );

  select *
    into e
    from public.evidence_document_watermark_exports
   where organization_id = p_organization_id
     and requested_by_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    return query
      select case when e.request_digest = p_request_digest and e.request_digest = v_digest then 'replayed' else 'idempotency_conflict' end,
             public.m8_06_watermark_export_json(p_organization_id, e.id, true);
    return;
  end if;

  select *
    into d
    from public.evidence_documents
   where organization_id = p_organization_id
     and id = p_document_id
   for update;

  if not found then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  if d.lifecycle_state <> 'active' then
    return query select 'lifecycle_blocked', jsonb_build_object('lifecycleState', d.lifecycle_state);
    return;
  end if;

  select *
    into v
    from public.evidence_document_versions
   where organization_id = p_organization_id
     and id = p_version_id
     and document_id = p_document_id
   for share;

  if not found
    or not exists (
      select 1
        from public.products p
       where p.organization_id = p_organization_id
         and p.id = p_product_id
         and p.archived_at is null
    )
    or not exists (
      select 1
        from public.evidence_document_version_products x
       where x.organization_id = p_organization_id
         and x.version_id = p_version_id
         and x.product_id = p_product_id
    )
  then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  if v.processing_state <> 'clean' or v.original_sha256 is null or v.actual_size_bytes is null then
    return query select 'not_clean', jsonb_build_object('state', v.processing_state);
    return;
  end if;

  if v.validity_ends_on is not null and v.validity_ends_on < current_date then
    return query select 'not_clean', jsonb_build_object('state', 'expired');
    return;
  end if;

  if v.detected_media_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    return query select 'unsupported', jsonb_build_object('mediaType', v.detected_media_type);
    return;
  end if;

  if p_request_digest <> v_digest then
    return query select 'invalid_request', null::jsonb;
    return;
  end if;

  insert into public.evidence_document_watermark_exports(
    organization_id,
    product_id,
    document_id,
    version_id,
    original_sha256,
    original_byte_size,
    original_media_type,
    recipient,
    purpose,
    requested_by_user_id,
    idempotency_key,
    request_digest
  ) values (
    p_organization_id,
    p_product_id,
    p_document_id,
    p_version_id,
    v.original_sha256,
    v.actual_size_bytes,
    v.detected_media_type,
    p_recipient,
    p_purpose,
    p_actor_user_id,
    p_idempotency_key,
    v_digest
  ) returning * into e;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id,
    p_actor_user_id,
    'evidence.watermark_export_queued',
    'evidence_document_watermark_export',
    e.id::text,
    jsonb_build_object('documentId', p_document_id, 'versionId', p_version_id, 'productId', p_product_id, 'requestDigest', v_digest)
  );

  return query select 'queued', public.m8_06_watermark_export_json(p_organization_id, e.id, true);
end
$$;

create or replace function public.preview_evidence_document_watermark_export_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_export_id uuid,
  p_idempotency_key uuid,
  p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.evidence_document_watermark_exports%rowtype;
  g public.evidence_document_watermark_export_access_grants%rowtype;
  v_token text;
  v_digest text;
begin
  if p_idempotency_key is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or not public.m8_05_actor_can_manage_evidence(p_organization_id, p_actor_user_id)
  then
    return query select 'forbidden', null::jsonb;
    return;
  end if;

  v_digest := public.m8_06_digest_parts('m8-06-watermark-access', p_export_id::text, 'preview');

  select *
    into g
    from public.evidence_document_watermark_export_access_grants
   where organization_id = p_organization_id
     and actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    if g.request_digest <> p_request_digest or g.request_digest <> v_digest or g.access_mode <> 'preview' then
      return query select 'idempotency_conflict', null::jsonb;
      return;
    end if;
    v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    update public.evidence_document_watermark_export_access_grants
       set token_sha256 = encode(extensions.digest(v_token, 'sha256'), 'hex'),
           expires_at = clock_timestamp() + interval '5 minutes',
           terminal_outcome = null
     where id = g.id
     returning * into g;
    return query
      select 'replayed',
             jsonb_build_object(
               'token', v_token,
               'expiresAt', g.expires_at,
               'fileName', 'watermarked-' || p_export_id::text,
               'mediaType', (select derivative_media_type from public.evidence_document_watermark_exports where organization_id = p_organization_id and id = p_export_id)
             );
    return;
  end if;

  select *
    into e
    from public.evidence_document_watermark_exports
   where organization_id = p_organization_id
     and id = p_export_id
   for update;

  if not found then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  if e.status <> 'ready' then
    return query select 'not_ready', public.m8_06_watermark_export_json(p_organization_id, e.id, true);
    return;
  end if;

  if p_request_digest <> v_digest then
    return query select 'invalid_request', null::jsonb;
    return;
  end if;

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into public.evidence_document_watermark_export_access_grants(
    organization_id,
    export_id,
    actor_user_id,
    idempotency_key,
    request_digest,
    access_mode,
    token_sha256,
    expires_at
  ) values (
    p_organization_id,
    e.id,
    p_actor_user_id,
    p_idempotency_key,
    v_digest,
    'preview',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    clock_timestamp() + interval '5 minutes'
  ) returning * into g;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'evidence.watermark_export_preview_authorized', 'evidence_document_watermark_export', e.id::text, jsonb_build_object('grantId', g.id, 'exportId', e.id));

  return query
    select 'ready',
           jsonb_build_object(
             'token', v_token,
             'expiresAt', g.expires_at,
             'fileName', 'watermarked-' || e.id::text || case when e.derivative_media_type = 'application/pdf' then '.pdf' when e.derivative_media_type = 'image/jpeg' then '.jpg' when e.derivative_media_type = 'image/png' then '.png' else '.webp' end,
             'mediaType', e.derivative_media_type
           );
end
$$;

create or replace function public.create_evidence_document_watermark_export_delivery_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_export_id uuid,
  p_idempotency_key uuid,
  p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.evidence_document_watermark_exports%rowtype;
  g public.evidence_document_watermark_export_access_grants%rowtype;
  v_token text;
  v_digest text;
begin
  if p_idempotency_key is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or not public.m8_05_actor_can_manage_evidence(p_organization_id, p_actor_user_id)
  then
    return query select 'forbidden', null::jsonb;
    return;
  end if;

  v_digest := public.m8_06_digest_parts('m8-06-watermark-access', p_export_id::text, 'delivery');

  select *
    into g
    from public.evidence_document_watermark_export_access_grants
   where organization_id = p_organization_id
     and actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    if g.request_digest <> p_request_digest or g.request_digest <> v_digest or g.access_mode <> 'delivery' then
      return query select 'idempotency_conflict', null::jsonb;
      return;
    end if;
    v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    update public.evidence_document_watermark_export_access_grants
       set token_sha256 = encode(extensions.digest(v_token, 'sha256'), 'hex'),
           expires_at = clock_timestamp() + interval '5 minutes',
           terminal_outcome = null
     where id = g.id
     returning * into g;
    return query
      select 'replayed',
             jsonb_build_object(
               'token', v_token,
               'expiresAt', g.expires_at,
               'fileName', 'watermarked-' || p_export_id::text,
               'mediaType', (select derivative_media_type from public.evidence_document_watermark_exports where organization_id = p_organization_id and id = p_export_id)
             );
    return;
  end if;

  select *
    into e
    from public.evidence_document_watermark_exports
   where organization_id = p_organization_id
     and id = p_export_id
   for update;

  if not found then
    return query select 'not_found', null::jsonb;
    return;
  end if;

  if e.status <> 'ready' then
    return query select 'not_ready', public.m8_06_watermark_export_json(p_organization_id, e.id, true);
    return;
  end if;

  if p_request_digest <> v_digest
    or not exists (
      select 1
        from public.evidence_document_watermark_export_access_grants p
       where p.organization_id = p_organization_id
         and p.export_id = e.id
         and p.actor_user_id = p_actor_user_id
         and p.access_mode = 'preview'
         and p.previewed_at is not null
         and p.terminal_outcome <> 'revoked'
    )
  then
    return query select 'forbidden', null::jsonb;
    return;
  end if;

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into public.evidence_document_watermark_export_access_grants(
    organization_id,
    export_id,
    actor_user_id,
    idempotency_key,
    request_digest,
    access_mode,
    token_sha256,
    expires_at
  ) values (
    p_organization_id,
    e.id,
    p_actor_user_id,
    p_idempotency_key,
    v_digest,
    'delivery',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    clock_timestamp() + interval '5 minutes'
  ) returning * into g;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'evidence.watermark_export_delivery_authorized', 'evidence_document_watermark_export', e.id::text, jsonb_build_object('grantId', g.id, 'exportId', e.id));

  return query
    select 'ready',
           jsonb_build_object(
             'token', v_token,
             'expiresAt', g.expires_at,
             'fileName', 'watermarked-' || e.id::text || case when e.derivative_media_type = 'application/pdf' then '.pdf' when e.derivative_media_type = 'image/jpeg' then '.jpg' when e.derivative_media_type = 'image/png' then '.png' else '.webp' end,
             'mediaType', e.derivative_media_type
           );
end
$$;

revoke all on function public.m8_06_digest_parts(variadic text[]) from public, anon, authenticated;
grant execute on function public.m8_06_digest_parts(variadic text[]) to service_role;

revoke all on function public.create_evidence_document_watermark_export_atomic(uuid, uuid, uuid, uuid, uuid, text, text, uuid, text),
  public.preview_evidence_document_watermark_export_atomic(uuid, uuid, uuid, uuid, text),
  public.create_evidence_document_watermark_export_delivery_atomic(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_evidence_document_watermark_export_atomic(uuid, uuid, uuid, uuid, uuid, text, text, uuid, text),
  public.preview_evidence_document_watermark_export_atomic(uuid, uuid, uuid, uuid, text),
  public.create_evidence_document_watermark_export_delivery_atomic(uuid, uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
