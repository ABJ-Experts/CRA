-- Rewrap encrypted credentials without changing their authenticated context.
create or replace function public.m13_05_siem_vault(p_organization_id uuid,p_action text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_result jsonb;v_limit integer;v_next jsonb;begin
 if p_organization_id is null then raise exception 'invalid vault organization' using errcode='22023';end if;
 if p_action='references' then
  return jsonb_build_object('envelopeKeyReferences',(select coalesce(jsonb_object_agg(key_id,total),'{}'::jsonb) from (select credentials->>'keyId' key_id,count(*) total from public.siem_destinations where organization_id=p_organization_id and credentials is not null group by credentials->>'keyId') refs),'commandKeyReferences',(select coalesce(jsonb_object_agg(key_id,total),'{}'::jsonb) from (select after_redacted->>'keyId' key_id,count(*) total from public.audit_logs where organization_id is null and entity_type='audit_siem' and after_redacted->>'organizationId'=p_organization_id::text and after_redacted->>'keyId' is not null group by after_redacted->>'keyId') refs),'legacyEnvelopeCount',0,'hasMoreKeys',false);
 elsif p_action='list' then
  v_limit:=coalesce((p_input->>'limit')::integer,100);if v_limit<1 or v_limit>100 then raise exception 'invalid vault page' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('destinationId',id,'secretId',credential_id,'credentialRevision',credential_revision)||credentials order by credential_id),'[]'::jsonb) into v_result from (select * from public.siem_destinations where organization_id=p_organization_id and credentials is not null and (p_input->>'afterId' is null or credential_id>(p_input->>'afterId')::uuid) order by credential_id limit v_limit) secrets;
  return v_result;
 elsif p_action='replace' then
  v_next:=p_input->'nextEnvelope';
  if jsonb_typeof(v_next) is distinct from 'object' or v_next->>'format' is distinct from 'aes-256-gcm-v1' or v_next->>'keyId' is null or v_next->>'ciphertext' is null or v_next->>'nonce' is null or v_next->>'authTag' is null or pg_column_size(v_next)>100000 then return jsonb_build_object('outcome','invalid_request');end if;
  select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=(p_input->>'destinationId')::uuid for update;
  if not found then return jsonb_build_object('outcome','not_found');end if;
  if v_dest.credential_id is distinct from (p_input->>'secretId')::uuid or v_dest.credential_revision is distinct from (p_input->>'credentialRevision')::integer or v_dest.credentials is distinct from p_input->'expectedEnvelope' then return jsonb_build_object('outcome','conflict');end if;
  update public.siem_destinations set credentials=v_next,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=v_dest.id;
  update public.siem_deliveries set state='queued',version=version+1,lease_token=null,lease_expires_at=null,worker_id=null where organization_id=p_organization_id and destination_id=v_dest.id and state='processing';
  perform public.m13_05_receipt(p_organization_id,null,gen_random_uuid(),'key_rewrapped',v_dest.id,encode(extensions.digest(convert_to(v_dest.credential_id::text||':'||(v_next->>'keyId'),'UTF8'),'sha256'),'hex'));
  return jsonb_build_object('outcome','updated');
 end if;
 raise exception 'invalid vault action' using errcode='22023';
end $$;
revoke all on function public.m13_05_siem_vault(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.m13_05_siem_vault(uuid,text,jsonb) to service_role;
