-- M13-05 destination-before-delivery lock ordering matches lifecycle commands.
create or replace function public.m13_05_siem_claim(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_delivery public.siem_deliveries;v_dest public.siem_destinations;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 100 then raise exception 'invalid worker' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('siem-worker-slots',0));
 -- An expired send can have reached the receiver. Retry retains the event ID.
 for v_delivery in select * from public.siem_deliveries where state='processing' and lease_expires_at<=clock_timestamp() for update skip locked loop
  insert into public.siem_delivery_attempts(organization_id,delivery_id,lease_token,attempt_number,state,code) values(v_delivery.organization_id,v_delivery.id,v_delivery.lease_token,v_delivery.attempt_count,'interrupted','lease_expired') on conflict do nothing;
  update public.siem_deliveries set state=case when attempt_count>=6 then 'failed' else 'queued' end,version=version+1,lease_token=null,lease_expires_at=null,worker_id=null,failure_code='lease_expired',updated_at=clock_timestamp() where id=v_delivery.id;
  perform public.m13_05_receipt(v_delivery.organization_id,null,gen_random_uuid(),'lease_expired',v_delivery.destination_id,repeat('0',64));
 end loop;
 if (select count(*) from public.siem_deliveries where state='processing')>=2 then return null; end if;
 for v_delivery in select d.* from public.siem_deliveries d join public.siem_destinations s on s.organization_id=d.organization_id and s.id=d.destination_id where d.state='queued' and s.state='enabled' and d.next_attempt_at<=clock_timestamp() and not exists(select 1 from public.siem_deliveries active where active.organization_id=d.organization_id and active.state='processing') order by s.scheduled_at,d.next_attempt_at,d.created_at,d.id limit 10 loop
  select * into v_dest from public.siem_destinations where organization_id=v_delivery.organization_id and id=v_delivery.destination_id for update skip locked;
  if not found then continue;end if;
  select * into v_delivery from public.siem_deliveries where organization_id=v_dest.organization_id and id=v_delivery.id and state='queued' for update skip locked;
  if not found then continue;end if;
  if not public.m13_05_authority_valid(v_dest) then
   update public.siem_destinations set state='paused',failure_code='authority_changed',version=version+1 where id=v_dest.id;
   perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'paused',v_dest.id,repeat('0',64));continue;
  end if;
  if v_delivery.destination_revision<>v_dest.destination_revision or not exists(select 1 from public.audit_logs a where a.organization_id=v_dest.organization_id and a.id=v_delivery.event_id and public.m13_05_event_selected(v_dest.organization_id,v_dest.authority_user_id,a,v_dest.product_ids)) then
   update public.siem_deliveries set state='cancelled',failure_code='scope_unavailable',version=version+1 where id=v_delivery.id;
   perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'scope_unavailable',v_dest.id,repeat('0',64));continue;
  end if;
  if v_delivery.attempt_count>=6 or v_delivery.first_attempt_at<clock_timestamp()-interval '24 hours' then
   update public.siem_deliveries set state='failed',failure_code='retry_exhausted',version=version+1 where id=v_delivery.id;
   perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'retry_exhausted',v_dest.id,repeat('0',64));continue;
  end if;
  update public.siem_deliveries set state='processing',version=version+1,attempt_count=attempt_count+1,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',worker_id=p_worker_id,updated_at=clock_timestamp() where id=v_delivery.id returning * into v_delivery;
  update public.siem_destinations set scheduled_at=clock_timestamp() where id=v_dest.id;
  perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'claimed',v_dest.id,repeat('0',64));
  return public.m13_05_private_claim(v_delivery,v_dest);
 end loop;
 return null;
end $$;
