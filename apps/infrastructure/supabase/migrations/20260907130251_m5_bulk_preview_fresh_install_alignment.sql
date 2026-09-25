-- The initial M5-03 migration was applied locally before unavailable selected
-- IDs were added to preview snapshots. Reinstall the canonical function as a
-- forward-only repair so existing databases and clean installs behave alike.
create or replace function public.create_vulnerability_assessment_bulk_preview_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_kind text, p_selection_mode text,
  p_finding_ids jsonb, p_filters jsonb, p_source_finding_id uuid, p_source_assessment_id uuid, p_source_assessment_version integer, p_submission jsonb,
  p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation uuid:=gen_random_uuid(); v_queue jsonb; v_cursor text:=null; v_count integer:=0; v_excluded integer:=0; v_row jsonb; v_finding uuid;
  v_source public.vulnerability_finding_assessments%rowtype; v_id text;
begin
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_kind not in ('bulk','propagation')
    or p_selection_mode not in ('selected_rows','all_matching') or jsonb_typeof(p_submission)<>'object'
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then return query select 'invalid_request'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||':'||p_idempotency_key::text,0));
  return query select * from public.m5_vex_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_preview',p_request_digest); if found then return; end if;
  if p_operation_kind='propagation' then
    select * into v_source from public.vulnerability_finding_assessments a where a.organization_id=p_organization_id and a.finding_id=p_source_finding_id and a.id=p_source_assessment_id and a.version=p_source_assessment_version and a.is_current for share;
    if not found or not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_source_finding_id and f.status='active') then return query select 'not_found'::text,null::jsonb; return; end if;
    p_submission:=jsonb_build_object('status',v_source.vex_status,'justification',v_source.vex_justification,'detail',v_source.detail,'changeReason',coalesce(p_submission->>'changeReason',v_source.change_reason),'evidenceLinks',coalesce((select jsonb_agg(case when e.kind='external' then jsonb_build_object('kind','external','title',e.title,'url',e.external_url) else jsonb_build_object('kind','internal','title',e.title,'evidenceId',e.document_id) end order by e.id) from public.vulnerability_finding_assessment_evidence_links e where e.organization_id=p_organization_id and e.assessment_id=v_source.id),'[]'::jsonb));
  end if;
  insert into public.vulnerability_finding_assessment_bulk_operations(id,organization_id,created_by,operation_kind,selection_mode,selection_filters,source_finding_id,source_assessment_id,source_assessment_version,submission,snapshot_digest,expires_at)
  values(v_operation,p_organization_id,p_actor_user_id,p_operation_kind,p_selection_mode,p_filters,p_source_finding_id,v_source.id,v_source.version,p_submission,p_request_digest,clock_timestamp()+interval '30 minutes');
  if p_selection_mode='selected_rows' then
    if jsonb_typeof(p_finding_ids)<>'array' or jsonb_array_length(p_finding_ids) not between 1 and 500 then return query select 'invalid_request'::text,null::jsonb; return; end if;
    for v_id in select jsonb_array_elements_text(p_finding_ids) loop
      begin v_finding:=v_id::uuid; exception when others then return query select 'invalid_request'::text,null::jsonb; return; end;
      if exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_finding and f.status='active') then
        v_count:=v_count+1;
        insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,expected_assessment_id,expected_assessment_version,previous_assessment_id)
        select p_organization_id,v_operation,f.id,v_count,p.name,r.label,f.component_identity,coalesce(o.component_version,f.evaluated_component_value),a.id,coalesce(a.version,0),a.id
        from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
        left join lateral(select o.* from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' order by o.id limit 1)o on true
        left join public.vulnerability_finding_assessments a on a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current where f.organization_id=p_organization_id and f.id=v_finding;
      else
        v_excluded:=v_excluded+1;
        insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,state,failure_code)
        values(p_organization_id,v_operation,v_finding,v_count+v_excluded,'Unavailable','Unavailable','unavailable','unavailable','excluded','not_found');
      end if;
    end loop;
  else
    loop
      select queue.result into v_queue from public.list_finding_triage_queue(p_organization_id,p_actor_user_id,coalesce(p_filters,'{}'::jsonb),100,v_cursor,'lastEvaluatedAt','desc') queue limit 1;
      if v_queue is null or jsonb_array_length(coalesce(v_queue->'filterIssues','[]'))>0 then
        delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      for v_row in select value from jsonb_array_elements(coalesce(v_queue->'rows','[]')) loop
        v_count:=v_count+1; if v_count>500 then
          delete from public.vulnerability_finding_assessment_bulk_operation_targets where organization_id=p_organization_id and operation_id=v_operation;
          delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
          return query select 'limit_exceeded'::text,null::jsonb; return;
        end if;
        v_finding:=(v_row#>>'{finding,id}')::uuid;
        insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,expected_assessment_id,expected_assessment_version,previous_assessment_id)
        select p_organization_id,v_operation,f.id,v_count,p.name,r.label,f.component_identity,coalesce(o.component_version,f.evaluated_component_value),a.id,coalesce(a.version,0),a.id from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id left join lateral(select o.* from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' order by o.id limit 1)o on true left join public.vulnerability_finding_assessments a on a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current where f.organization_id=p_organization_id and f.id=v_finding;
      end loop;
      v_cursor:=v_queue->>'nextCursor'; exit when v_cursor is null;
    end loop;
  end if;
  if p_operation_kind='propagation' then
    delete from public.vulnerability_finding_assessment_bulk_operation_targets where organization_id=p_organization_id and operation_id=v_operation;
    v_count:=0;
    for v_finding in select distinct f.id from public.vulnerability_findings f join public.vulnerability_finding_component_occurrences l on l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id join public.vulnerability_findings sf on sf.organization_id=f.organization_id and sf.id=p_source_finding_id join public.vulnerability_finding_component_occurrences sl on sl.organization_id=sf.organization_id and sl.finding_id=sf.id and sl.state='active' join public.vulnerability_component_occurrences so on so.organization_id=sl.organization_id and so.id=sl.occurrence_id where f.organization_id=p_organization_id and f.status='active' and f.id<>p_source_finding_id and f.vulnerability_id=sf.vulnerability_id and so.component_version is not null and o.component_identity=so.component_identity and o.component_version=so.component_version order by f.id limit 501 loop
      v_count:=v_count+1; if v_count>500 then
        delete from public.vulnerability_finding_assessment_bulk_operation_targets where organization_id=p_organization_id and operation_id=v_operation;
        delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
        return query select 'limit_exceeded'::text,null::jsonb; return;
      end if;
      insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,expected_assessment_id,expected_assessment_version,previous_assessment_id)
      select p_organization_id,v_operation,f.id,v_count,p.name,r.label,f.component_identity,coalesce(o.component_version,f.evaluated_component_value),a.id,coalesce(a.version,0),a.id from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id left join lateral(select o.* from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' order by o.id limit 1)o on true left join public.vulnerability_finding_assessments a on a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current where f.organization_id=p_organization_id and f.id=v_finding;
    end loop;
  end if;
  if v_count=0 then
    delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
    return query select 'no_eligible_targets'::text,null::jsonb; return;
  end if;
  update public.vulnerability_finding_assessment_bulk_operations set excluded_count=v_excluded where organization_id=p_organization_id and id=v_operation;
  insert into public.vulnerability_finding_assessment_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_preview',p_request_digest,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,v_operation),'idempotent',false));
  return query select 'previewed'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,v_operation),'idempotent',false);
end;
$$;

alter function public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text) owner to postgres;
revoke all on function public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text) to service_role;
