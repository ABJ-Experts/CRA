-- Filter closed class before source resolution; SQL boolean expressions may reorder calls.
create or replace function public.m13_05_siem_stage(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_event public.audit_logs;v_count integer:=0;v_bytes integer:=0;v_payload jsonb;v_head bigint;v_last bigint;v_pending integer;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 100 then raise exception 'invalid worker' using errcode='22023'; end if;
 select * into v_dest from public.siem_destinations where state='enabled' order by scheduled_at,id for update skip locked limit 1;
 if not found then return jsonb_build_object('staged',0); end if;
 if not public.m13_05_authority_valid(v_dest) then
  update public.siem_destinations set state='paused',failure_code='authority_changed',version=version+1,updated_at=clock_timestamp() where id=v_dest.id;
  perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'paused',v_dest.id,repeat('0',64)); return jsonb_build_object('staged',0);
 end if;
 select count(*) into v_pending from public.siem_deliveries where organization_id=v_dest.organization_id and destination_id=v_dest.id and state in ('queued','processing');
 if v_pending>=10000 then update public.siem_destinations set failure_code='backpressure',scheduled_at=clock_timestamp() where id=v_dest.id; return jsonb_build_object('staged',0); end if;
 select last_sequence into v_head from public.audit_chain_heads where organization_id=v_dest.organization_id;
 v_last:=v_dest.scan_sequence;
 for v_event in select * from public.audit_logs where organization_id=v_dest.organization_id and chain_sequence>v_dest.scan_sequence and chain_sequence<=coalesce(v_head,0) order by chain_sequence limit least(250,10000-v_pending) loop
  if public.m13_05_event_class(v_event)=any(v_dest.event_classes) then
   if public.m13_05_event_selected(v_dest.organization_id,v_dest.authority_user_id,v_event,v_dest.product_ids) then
   v_payload:=public.m13_05_event_projection(v_event);
   if octet_length(v_payload::text)>8192 then raise exception 'siem_payload_limit' using errcode='54000'; end if;
   if v_bytes+octet_length(v_payload::text)>1048576 then exit; end if;
   insert into public.siem_deliveries(organization_id,destination_id,event_id,event_sequence,destination_revision,payload) values(v_dest.organization_id,v_dest.id,v_event.id,v_event.chain_sequence,v_dest.destination_revision,v_payload) on conflict do nothing;
   v_count:=v_count+1;v_bytes:=v_bytes+octet_length(v_payload::text);
   end if;
  end if;
  v_last:=v_event.chain_sequence;
 end loop;
 update public.siem_destinations set scan_sequence=v_last,scheduled_at=clock_timestamp(),failure_code=null where id=v_dest.id;
 if v_last<>v_dest.scan_sequence then perform public.m13_05_receipt(v_dest.organization_id,null,gen_random_uuid(),'staged',v_dest.id,encode(extensions.digest(convert_to(v_last::text,'UTF8'),'sha256'),'hex')); end if;
 return jsonb_build_object('staged',v_count);
end $$;
