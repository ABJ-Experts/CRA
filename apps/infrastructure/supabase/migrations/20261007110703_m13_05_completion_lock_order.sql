-- M13-05 destination-before-delivery completion lock ordering.
create or replace function public.m13_05_siem_complete(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_lease_token uuid,p_version integer,p_outcome jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_delivery public.siem_deliveries;v_state text:=p_outcome->>'state';v_delay integer;begin
 perform 1 from public.siem_destinations s join public.siem_deliveries d on d.organization_id=s.organization_id and d.destination_id=s.id where d.organization_id=p_organization_id and d.id=p_delivery_id for update of s;
 select * into v_delivery from public.siem_deliveries where organization_id=p_organization_id and id=p_delivery_id and state='processing' and worker_id=p_worker_id and lease_token=p_lease_token and version=p_version and lease_expires_at>clock_timestamp() for update;
 if not found then raise exception 'siem_lease_conflict' using errcode='23505'; end if;
 if v_state not in ('accepted','sent_unacknowledged','retry','failed') or coalesce(p_outcome->>'code','delivered') !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid delivery outcome' using errcode='22023'; end if;
 insert into public.siem_delivery_attempts(organization_id,delivery_id,lease_token,attempt_number,state,code,http_status,duration_ms) values(p_organization_id,v_delivery.id,p_lease_token,v_delivery.attempt_count,v_state,coalesce(p_outcome->>'code','delivered'),(p_outcome->>'status')::integer,(p_outcome->>'durationMs')::integer);
 v_delay:=least(86400,greatest(coalesce((p_outcome->>'retryAfterSeconds')::integer,0),greatest(5,least(300,(5*power(2,v_delivery.attempt_count-1)*(0.5+random()*0.5))::integer))));
 update public.siem_deliveries set state=case when v_state='retry' and attempt_count<6 and first_attempt_at>clock_timestamp()-interval '24 hours' then 'queued' when v_state='retry' then 'failed' else v_state end,version=version+1,failure_code=case when v_state in ('accepted','sent_unacknowledged') then null else p_outcome->>'code' end,next_attempt_at=clock_timestamp()+make_interval(secs=>v_delay),lease_token=null,lease_expires_at=null,worker_id=null,updated_at=clock_timestamp() where id=v_delivery.id returning * into v_delivery;
 if v_state='accepted' then update public.siem_destinations set last_accepted_at=clock_timestamp(),failure_code=null where id=v_delivery.destination_id and organization_id=p_organization_id; end if;
 perform public.m13_05_receipt(p_organization_id,null,gen_random_uuid(),'completed',v_delivery.destination_id,repeat('0',64));
 return jsonb_build_object('ok',true);
end $$;
