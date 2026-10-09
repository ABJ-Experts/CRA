-- Recheck an archived custom target inside the reviewed upgrade transaction.
create or replace function public.m10_commit_upgrade(p_organization_id uuid,p_actor_user_id uuid,
  p_review_id uuid,p_expected_review_revision integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.framework_upgrade_reviews%rowtype;
  v_selection public.organization_framework_selections%rowtype;
  v_digest text; v_result jsonb; v_control record; v_mapping record; v_target text;
  v_new_revision integer; v_new_mapping uuid; v_now timestamptz:=clock_timestamp();
  v_migrated_count integer; v_gap_count integer; v_custom_status text;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_review_id is null or p_expected_review_revision is null
    or p_expected_review_revision<1 or p_idempotency_key is null then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('review',p_review_id,
    'expected',p_expected_review_revision)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':framework-upgrade',0));
  select * into v_review from public.framework_upgrade_reviews r
    where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_review.status='committed' then
    if v_review.commit_idempotency_key=p_idempotency_key and v_review.commit_digest=v_digest then
      return query select 'upgraded'::text,v_review.result; return;
    end if;
    return query select 'conflict'::text,jsonb_build_object('reviewRevision',v_review.revision,'status',v_review.status); return;
  end if;
  if v_review.revision<>p_expected_review_revision then
    return query select 'conflict'::text,jsonb_build_object('reviewRevision',v_review.revision); return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_review.pack_key,0));
  select * into v_selection from public.organization_framework_selections s
    where s.organization_id=p_organization_id and s.pack_key=v_review.pack_key for update;
  if not found or v_selection.revision<>v_review.selection_revision
    or v_selection.version_key<>v_review.source_version_key
    or (select content_hash from public.framework_pack_versions p where p.pack_key=v_review.pack_key
      and p.version_key=v_review.source_version_key)<>v_review.source_hash
    or (select content_hash from public.framework_pack_versions p where p.pack_key=v_review.pack_key
      and p.version_key=v_review.target_version_key)<>v_review.target_hash
    or public.m10_upgrade_fingerprint(p_organization_id,v_review.pack_key,v_review.source_version_key)<>v_review.fingerprint then
    return query select 'conflict'::text,jsonb_build_object('reason','source_changed'); return;
  end if;
  select d.status into v_custom_status from public.framework_custom_pack_drafts d
    where d.organization_id=p_organization_id and d.pack_key=v_review.pack_key for share;
  if v_custom_status='archived' then
    return query select 'blocked'::text,jsonb_build_object('reason','pack_archived'); return;
  end if;
  if (select count(*) from public.framework_control_requirement_mappings m where m.organization_id=p_organization_id
    and m.pack_key=v_review.pack_key and m.version_key=v_review.source_version_key and m.ended_at is null)
    <>(select count(*) from public.framework_upgrade_decisions d
      join public.framework_control_requirement_mappings m on m.organization_id=d.organization_id and m.id=d.mapping_id
      where d.organization_id=p_organization_id and d.review_id=p_review_id
        and m.pack_key=v_review.pack_key and m.version_key=v_review.source_version_key and m.ended_at is null) then
    return query select 'blocked'::text,jsonb_build_object('reason','missing_decisions'); return;
  end if;
  if exists(select 1 from public.framework_upgrade_decisions d
      join public.framework_control_requirement_mappings m on m.organization_id=d.organization_id and m.id=d.mapping_id
      cross join lateral unnest(d.target_requirement_keys) target(requirement_key)
      join public.framework_control_requirement_mappings existing on existing.organization_id=p_organization_id
        and existing.control_id=m.control_id and existing.pack_key=v_review.pack_key
        and existing.version_key=v_review.target_version_key and existing.requirement_key=target.requirement_key
        and existing.ended_at is null
      where d.organization_id=p_organization_id and d.review_id=p_review_id)
  then return query select 'conflict'::text,jsonb_build_object('reason','duplicate_target_mapping'); return; end if;
  select count(distinct (m.control_id,target.requirement_key)) into v_migrated_count
    from public.framework_upgrade_decisions d
    join public.framework_control_requirement_mappings m on m.organization_id=d.organization_id and m.id=d.mapping_id
    cross join lateral unnest(d.target_requirement_keys) target(requirement_key)
    where d.organization_id=p_organization_id and d.review_id=p_review_id;
  select count(*) into v_gap_count from public.framework_upgrade_decisions d
    where d.organization_id=p_organization_id and d.review_id=p_review_id
      and cardinality(d.target_requirement_keys)=0;
  -- Switch selection first so the mapping insert guard accepts only target
  -- versions. The transaction rolls this back with every later write on error.
  perform set_config('cra.framework_upgrade','on',true);
  update public.organization_framework_selections set version_key=v_review.target_version_key,
    revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
  where organization_id=p_organization_id and pack_key=v_review.pack_key;
  for v_control in select distinct c.id from public.framework_controls c
    join public.framework_control_requirement_mappings m on m.organization_id=c.organization_id and m.control_id=c.id
    where c.organization_id=p_organization_id and m.pack_key=v_review.pack_key
      and m.version_key=v_review.source_version_key and m.ended_at is null order by c.id
  loop
    update public.framework_controls c set revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
      where c.organization_id=p_organization_id and c.id=v_control.id returning c.revision into v_new_revision;
    insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,
      owner_user_id,implementation_status,archived_at,transition_reason,actor_user_id)
    select p_organization_id,c.id,c.revision,c.title,c.description,c.owner_user_id,
      c.implementation_status,c.archived_at,'Reviewed framework upgrade',p_actor_user_id
    from public.framework_controls c where c.organization_id=p_organization_id and c.id=v_control.id;
  end loop;
  for v_mapping in select m.*,c.revision current_control_revision,d.target_requirement_keys
    from public.framework_control_requirement_mappings m
    join public.framework_upgrade_decisions d on d.organization_id=m.organization_id
      and d.mapping_id=m.id and d.review_id=p_review_id
    join public.framework_controls c on c.organization_id=m.organization_id and c.id=m.control_id
    where m.organization_id=p_organization_id and m.pack_key=v_review.pack_key
      and m.version_key=v_review.source_version_key and m.ended_at is null order by m.id
  loop
    update public.framework_control_requirement_mappings set ended_at=v_now,ended_by=p_actor_user_id
      where organization_id=p_organization_id and id=v_mapping.id;
    foreach v_target in array v_mapping.target_requirement_keys loop
      select m.id into v_new_mapping from public.framework_control_requirement_mappings m
        where m.organization_id=p_organization_id and m.control_id=v_mapping.control_id
          and m.pack_key=v_review.pack_key and m.version_key=v_review.target_version_key
          and m.requirement_key=v_target and m.ended_at is null;
      if not found then
        insert into public.framework_control_requirement_mappings(organization_id,control_id,pack_key,
          version_key,requirement_key,rationale,source_control_revision,created_by)
        values(p_organization_id,v_mapping.control_id,v_review.pack_key,v_review.target_version_key,
          v_target,v_mapping.rationale,v_mapping.current_control_revision,p_actor_user_id)
        returning id into v_new_mapping;
      end if;
      insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
      select p_organization_id,v_new_mapping,mp.product_id from public.framework_control_mapping_products mp
        where mp.organization_id=p_organization_id and mp.mapping_id=v_mapping.id
      on conflict (organization_id,mapping_id,product_id) do nothing;
    end loop;
  end loop;
  -- Existing selection and mapping triggers invalidate every affected scope.
  v_result:=jsonb_build_object('reviewId',v_review.id,
    'selection',jsonb_build_object('packKey',v_review.pack_key,
      'versionKey',v_review.target_version_key,'enabled',v_selection.enabled,
      'revision',v_selection.revision+1),
    'migratedCount',v_migrated_count,'gapCount',v_gap_count);
  update public.framework_upgrade_reviews r set status='committed',revision=revision+1,
    committed_by=p_actor_user_id,committed_at=v_now,commit_idempotency_key=p_idempotency_key,
    commit_digest=v_digest,result=v_result,updated_at=v_now
  where r.organization_id=p_organization_id and r.id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'framework.upgrade_committed',
    'framework_upgrade_review',p_review_id::text,
    jsonb_build_object('packKey',v_review.pack_key,'sourceVersionKey',v_review.source_version_key,
      'targetVersionKey',v_review.target_version_key,'sourceHash',v_review.source_hash,
      'targetHash',v_review.target_hash,'selectionRevision',v_selection.revision+1,
      'fingerprint',v_review.fingerprint,'idempotencyKey',p_idempotency_key));
  return query select 'upgraded'::text,v_result;
end $$;
