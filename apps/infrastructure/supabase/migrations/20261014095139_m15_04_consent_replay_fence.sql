-- A consumed disclosure may replay its exact command but may not authorize a
-- second collection. Failed/cancelled/deleted jobs require fresh preview consent.
create index m15_04_preview_receipt_lookup on public.support_diagnostic_jobs(organization_id,creator_user_id,preview_digest);
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m15_04_create(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure);
 anchor:=' if exists(select 1 from public.support_diagnostic_jobs where organization_id=p_organization_id and state in (''queued'',''running''))';
 if position(anchor in d)=0 then raise exception 'M15-04 consent replay fence anchor missing';end if;
 execute replace(d,anchor,E' if exists(select 1 from public.support_diagnostic_jobs where organization_id=p_organization_id and creator_user_id=p_actor_user_id and preview_digest=p_preview_digest) then return jsonb_build_object(''outcome'',''conflict'');end if;\n'||anchor);
end $$;
