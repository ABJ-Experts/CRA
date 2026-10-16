-- Verdict labels and discovered privilege evidence must agree. Neither an
-- inconsistent provider result nor an inactive original initiator may widen a
-- worker's recorded authorization after approval by another member.
do $$
declare v_definition text; v_anchor text;
begin
 select pg_get_functiondef('public.m11_valid_connector_scope_assessment(jsonb)'::regprocedure) into v_definition;
 v_anchor:=' return true;';
 if position(v_anchor in v_definition)=0 then raise exception 'M11 scope consistency anchor missing'; end if;
 execute replace(v_definition,v_anchor,E' if p_scope->>''status''=''compliant'' and (jsonb_array_length(p_scope->''missingScopes'')>0 or jsonb_array_length(p_scope->''excessScopes'')>0) then return false; end if;\n if p_scope->>''status''=''missing'' and jsonb_array_length(p_scope->''missingScopes'')=0 then return false; end if;\n if p_scope->>''status''=''excess'' and (jsonb_array_length(p_scope->''missingScopes'')>0 or jsonb_array_length(p_scope->''excessScopes'')=0) then return false; end if;\n'||v_anchor);
 select pg_get_functiondef('public.m11_assert_sync_run_fence(uuid,uuid,uuid)'::regprocedure) into v_definition;
 v_anchor:=' if v_actor is null or (p_actor_user_id is not null and p_actor_user_id<>v_actor)';
 if position(v_anchor in v_definition)=0 then raise exception 'M11 initiator fence anchor missing'; end if;
 v_definition:=replace(v_definition,v_anchor,
  ' if not public.m11_lock_connector_authorization(p_organization_id,v_run.actor_user_id,v_run.permission_version) then return false; end if;'||E'\n'||v_anchor);
 v_anchor:='and v_connector.scope_assessment->>''status''<>''missing''';
 if position(v_anchor in v_definition)=0 then raise exception 'M11 required scope fence anchor missing'; end if;
 execute replace(v_definition,v_anchor,v_anchor||E'\n and jsonb_array_length(v_connector.scope_assessment->''missingScopes'')=0');
end $$;
