-- A manual bibliography has no internal source snapshot. Keep its reviewer-
-- supplied current metadata explicit instead of dereferencing an unassigned
-- PL/pgSQL record during a retain decision.
create or replace function public.m7_review_technical_file_section_source_impl(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_product_id uuid,
  p_section_key text,
  p_source_id uuid,
  p_expected_version integer,
  p_decision text,
  p_rationale text,
  p_idempotency_key uuid
)
returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  s public.technical_file_sections%rowtype;
  x public.technical_file_section_sources%rowtype;
  v_reviewed_revision text;
  v_reviewed_fingerprint text;
  v_snapshot_revision text;
  v_snapshot_fingerprint text;
  v_snapshot_is_current boolean;
  review_id uuid;
  v_digest text;
  prior record;
begin
  v_digest:=encode(extensions.digest(jsonb_build_object('operation','review_source','productId',p_product_id,'sectionKey',p_section_key,'sourceId',p_source_id,'expectedVersion',p_expected_version,'decision',p_decision,'rationale',p_rationale)::text,'sha256'),'hex');
  if p_decision not in ('retain','update') or char_length(btrim(coalesce(p_rationale,''))) not between 1 and 4000 or p_idempotency_key is null or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then
    return query select 'invalid_request',null::jsonb;
    return;
  end if;
  select a.* into prior from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc,a.id desc limit 1;
  if found then
    if prior.action='technical_file.source_reviewed' and prior.changes->>'payloadDigest'=v_digest then
      return query select 'replayed',jsonb_build_object('source',public.m7_evidence_link_json(p_organization_id,p_product_id,p_source_id),'review',public.m7_evidence_review_json(p_organization_id,(prior.changes->>'reviewId')::uuid));
    else
      return query select 'idempotency_conflict',null::jsonb;
    end if;
    return;
  end if;
  select q.* into s from public.technical_file_sections q join public.technical_files f on f.organization_id=q.organization_id and f.id=q.technical_file_id where q.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and q.section_key=p_section_key for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if s.version<>p_expected_version then return query select 'conflict',jsonb_build_object('currentVersion',s.version); return; end if;
  select * into x from public.technical_file_section_sources where organization_id=p_organization_id and section_id=s.id and id=p_source_id for update;
  if not found or x.stale_at is null then return query select 'invalid_request',null::jsonb; return; end if;
  if x.source_kind<>'manual_reference' then
    select revision,fingerprint,is_current into v_snapshot_revision,v_snapshot_fingerprint,v_snapshot_is_current from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,x.source_kind,x.record_id);
    if p_decision='update' and (not found or not v_snapshot_is_current) then return query select 'invalid_request',null::jsonb; return; end if;
  end if;
  v_reviewed_revision:=coalesce(v_snapshot_revision,x.stale_current_revision);
  v_reviewed_fingerprint:=coalesce(v_snapshot_fingerprint,x.stale_current_fingerprint);
  insert into public.technical_file_section_source_reviews(organization_id,source_id,decision,rationale,linked_revision,linked_fingerprint,reviewed_against_revision,reviewed_against_fingerprint,created_by) values(p_organization_id,p_source_id,p_decision,btrim(p_rationale),x.observed_revision,x.source_fingerprint,v_reviewed_revision,v_reviewed_fingerprint,p_actor_user_id) returning id into review_id;
  update public.technical_file_section_sources set observed_revision=case when p_decision='update' then v_snapshot_revision else observed_revision end,source_fingerprint=case when p_decision='update' then v_snapshot_fingerprint else source_fingerprint end,stale_at=null,stale_reason=null,stale_current_revision=null,stale_current_fingerprint=null,reviewed_at=clock_timestamp(),reviewed_by=p_actor_user_id,reviewed_revision=v_reviewed_revision,reviewed_fingerprint=v_reviewed_fingerprint,link_version=link_version+1 where organization_id=p_organization_id and id=p_source_id;
  update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=s.id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_reviewed','technical_file_section_source',p_source_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'reviewId',review_id));
  return query select 'reviewed',jsonb_build_object('source',public.m7_evidence_link_json(p_organization_id,p_product_id,p_source_id),'review',public.m7_evidence_review_json(p_organization_id,review_id));
end $$;

revoke all on function public.m7_review_technical_file_section_source_impl(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) from public,anon,authenticated;
alter function public.m7_review_technical_file_section_source_impl(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) owner to postgres;
notify pgrst, 'reload schema';
