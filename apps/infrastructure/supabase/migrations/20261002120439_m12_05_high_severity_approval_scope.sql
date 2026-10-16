-- Approval prompts are in this chat slice only for high/critical findings.
-- M6 reporting approval prompts remain high priority by regulatory category.
do $$
declare v_definition text;
  v_old text:=$anchor$and a.is_current and a.approval_state='awaiting_approval' and f.status='active'
          and p.archived_at$anchor$;
  v_new text:=$anchor$and a.is_current and a.approval_state='awaiting_approval' and f.status='active'
          and public.m5_triage_finding_severity(p_organization_id,f.id) in ('high','critical')
          and p.archived_at$anchor$;
begin
  select pg_get_functiondef(to_regprocedure('public.m12_05_bridge_chat_deliveries_atomic(uuid,integer)'))
    into v_definition;
  if v_definition is null or position(v_old in v_definition)=0 then
    raise exception 'M12-05 approval bridge anchor missing'; end if;
  execute replace(v_definition,v_old,v_new);
end $$;

do $$
declare v_definition text;
  v_old text:=$anchor$'active',a.is_current and a.approval_state='awaiting_approval' and f.status='active'
      and p.archived_at$anchor$;
  v_new text:=$anchor$'active',a.is_current and a.approval_state='awaiting_approval' and f.status='active'
      and public.m5_triage_finding_severity(p_organization_id,f.id) in ('high','critical')
      and p.archived_at$anchor$;
begin
  select pg_get_functiondef(to_regprocedure('public.m12_05_chat_source_current(uuid,uuid,text,uuid,uuid[])'))
    into v_definition;
  if v_definition is null or position(v_old in v_definition)=0 then
    raise exception 'M12-05 approval resolver anchor missing'; end if;
  execute replace(v_definition,v_old,v_new);
end $$;
