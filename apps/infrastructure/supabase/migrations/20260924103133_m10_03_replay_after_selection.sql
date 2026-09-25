-- Replays keep their original result after a later selection change, provided
-- the actor still has the required current permissions. New commands must
-- still target the organization's enabled version.
do $$
declare
  v_definition text;
  v_check text := $anchor$  if not exists(select 1 from public.products p where p.organization_id=p_organization_id
    and p.id=p_product_id and p.archived_at is null)
    or not exists(select 1 from public.framework_requirements r
      where r.pack_key=p_pack_key and r.version_key=p_version_key
        and r.requirement_key=p_requirement_key and r.depth>0)
    or not exists(select 1 from public.organization_framework_selections s
      where s.organization_id=p_organization_id and s.pack_key=p_pack_key
        and s.version_key=p_version_key and s.enabled)
  then return query select 'not_found'::text,null::jsonb; return; end if;
$anchor$;
  v_after_replay text := $anchor$    return query select v_prior.outcome,v_prior.result; return;
  end if;$anchor$;
begin
  select pg_get_functiondef(
    'public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)'::regprocedure)
  into v_definition;
  if position(v_check in v_definition)=0 or position(v_after_replay in v_definition)=0 then
    raise exception 'M10 applicability replay anchor missing';
  end if;
  v_definition:=replace(v_definition,v_check,'');
  v_definition:=replace(v_definition,v_after_replay,
    v_after_replay||chr(10)||
    '  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'':''||p_pack_key,0));'
    ||chr(10)||v_check);
  execute v_definition;
end $$;
