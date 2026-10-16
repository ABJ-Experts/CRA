-- Real rollback-only source calls: denied writes and retained M6 human authority.
begin;
set local statement_timeout='30s';
create function pg_temp.m15_source_check(label text,ok boolean) returns void language plpgsql as $$begin
 if not coalesce(ok,false) then raise exception 'M15 source continuation failed: %',label;end if;
end $$;
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';u uuid;ob uuid:=gen_random_uuid();rehearsal uuid:=gen_random_uuid();rule_id uuid;rel uuid;product uuid;supplier_request uuid:=gen_random_uuid();supplier_invitation uuid:=gen_random_uuid();st uuid:=gen_random_uuid();r record;draft uuid;lock_result record;
begin
 select id into strict u from public.users where email='owner@cra.test';
 select id into strict rule_id from public.reporting_rule_sets order by version desc limit 1;
 select id,product_id into strict rel,product from public.product_releases where organization_id=o and archived_at is null limit 1;
 delete from public.organization_license_states where organization_id=o;
 insert into public.reporting_obligations(id,organization_id,obligation_type,awareness_at,awareness_basis,rule_set_id,rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name,created_at,is_rehearsal)
 select ob,o,'severe_incident',date_trunc('second',clock_timestamp())-interval '1 hour','Protected source fixture',id,version,rules,u,'Owner',date_trunc('second',clock_timestamp())-interval '1 hour',false from public.reporting_rule_sets where id=rule_id;
 insert into public.reporting_obligations(id,organization_id,obligation_type,awareness_at,awareness_basis,rule_set_id,rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name,created_at,is_rehearsal)
 select rehearsal,o,'severe_incident',date_trunc('second',clock_timestamp())-interval '1 hour','Synthetic source fixture',id,version,rules,u,'Owner',date_trunc('second',clock_timestamp())-interval '1 hour',true from public.reporting_rule_sets where id=rule_id;
 insert into public.reporting_obligation_stages(id,organization_id,obligation_id,stage_kind,anchor_kind,duration,state) values(st,o,ob,'early_warning','awareness','PT24H','running');
 select * into r from public.create_reporting_stage_draft_atomic(o,u,ob,st,rel,gen_random_uuid(),gen_random_uuid());
 perform pg_temp.m15_source_check('existing real obligation drafts without licence',r.outcome='created');
 draft:=(r.result->'draft'->>'id')::uuid;
 select * into lock_result from public.acquire_reporting_stage_draft_lock_atomic(o,u,draft,1,gen_random_uuid(),gen_random_uuid());
 perform pg_temp.m15_source_check('normal draft lock remains required',lock_result.outcome='updated');
 select * into r from public.save_reporting_stage_draft_atomic(o,u,draft,1,(lock_result.result->>'lockToken')::uuid,'{"summary":"Human protected continuation","impact":"bounded"}','{"summary":{"origin":"human"},"impact":{"origin":"human"}}','[{"countryCode":"DE","provenance":{"origin":"human"}}]',gen_random_uuid(),gen_random_uuid());
 perform pg_temp.m15_source_check('human protected draft persists normally',r.outcome='updated');
 select * into r from public.save_reporting_stage_draft_atomic(o,gen_random_uuid(),draft,2,(lock_result.result->>'lockToken')::uuid,'{}','{}','[]',gen_random_uuid(),gen_random_uuid());
 perform pg_temp.m15_source_check('continuation retains source actor authorization',r.outcome='invalid_request' and (select version=2 from public.reporting_stage_drafts where organization_id=o and id=draft));
 begin
  perform public.m15_01_assert_reporting_continuation(o,rehearsal);
  raise exception 'rehearsal bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 begin
  perform public.m15_01_assert_reporting_continuation(gen_random_uuid(),ob);
  raise exception 'cross tenant continuation bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 -- Expiry and a removed reporting grant retain the same source-authorized duty.
 update public.reporting_obligations set awareness_at=date_trunc('second',clock_timestamp())-interval '60 days',created_at=date_trunc('second',clock_timestamp())-interval '50 days' where organization_id=o and id=ob;
 insert into public.organization_license_states(organization_id,artifact,artifact_digest,artifact_object_path,verified_claims,issuance_sequence,version,time_high_water_at)
 values(o,'retained.expired.fixture',repeat('e',64),o::text||'/'||repeat('e',64)||'.jws',jsonb_build_object('organizationId',o,'entitlements','[]'::jsonb,'startsAt',clock_timestamp()-interval '90 days','expiresAt',clock_timestamp()-interval '31 days'),1,1,clock_timestamp());
 select * into lock_result from public.acquire_reporting_stage_draft_lock_atomic(o,u,draft,2,gen_random_uuid(),gen_random_uuid());
 perform pg_temp.m15_source_check('past grace retains protected draft lock',lock_result.outcome='updated');
 update public.organization_license_states set protected_regulatory_cutoff=clock_timestamp()-interval '1 day',verified_claims=jsonb_set(verified_claims,'{expiresAt}',to_jsonb(clock_timestamp()+interval '1 day')) where organization_id=o;
 select * into lock_result from public.acquire_reporting_stage_draft_lock_atomic(o,u,draft,2,gen_random_uuid(),gen_random_uuid());
 perform pg_temp.m15_source_check('removed reporting capability retains earlier real duty',lock_result.outcome='updated');
 begin
  perform public.create_reporting_stage_draft_atomic(o,u,rehearsal,gen_random_uuid(),rel,gen_random_uuid(),gen_random_uuid());
  raise exception 'downgraded rehearsal bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 insert into public.sbom_supplier_requests(id,organization_id,product_id,release_id,supplier_display_name,allowed_component_ref,expires_at,idempotency_key,request_digest,created_by)
 values(supplier_request,o,product,rel,'Licence boundary supplier','fixture',clock_timestamp()+interval '1 day',gen_random_uuid(),repeat('7',64),u);
 insert into public.sbom_supplier_invitations(id,organization_id,request_id,token_prefix,token_hash,status,expires_at,consumed_at,session_token_hash,session_expires_at,created_by,idempotency_key,request_digest)
 values(supplier_invitation,o,supplier_request,'cra_sup_m15testx',repeat('8',64),'used',clock_timestamp()+interval '1 day',clock_timestamp(),repeat('9',64),clock_timestamp()+interval '20 minutes',u,gen_random_uuid(),repeat('a',64));
 perform pg_temp.m15_source_check('supplier session resolves authoritative tenant',public.m15_01_supplier_source_organization('supplier_sbom',repeat('9',64))=o);
 begin
  perform public.reserve_supplier_sbom_submission_before_m906(repeat('9',64),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('b',64),'fixture.json','application/json',10,repeat('c',64),gen_random_uuid(),'cyclonedx','1.6');
  raise exception 'supplier source reserve bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 perform pg_temp.m15_source_check('denied supplier reservation has no side effects',not exists(select 1 from public.sbom_supplier_submissions where invitation_id=supplier_invitation));
 begin
  perform public.create_sbom_ci_credential_atomic(o,u,gen_random_uuid(),'blocked','cra_sbom_abcdefgh','salt',repeat('a',64));
  raise exception 'CI credential bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 begin
  perform public.update_sbom_quality_settings_atomic(o,u,1,true,gen_random_uuid());
  raise exception 'SBOM quality config bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 begin
  perform public.m13_05_siem_command(o,u,'create',gen_random_uuid(),null,gen_random_uuid(),'{}');
  raise exception 'SIEM create bypass';
 exception when insufficient_privilege then if sqlerrm<>'licensing_customer_write_denied' then raise;end if;end;
 -- Protective revocation reaches the source permission check, never licensing.
 begin
  perform public.m13_05_siem_command(o,gen_random_uuid(),'disable',gen_random_uuid(),1,gen_random_uuid(),'{}');
  raise exception 'SIEM actor bypass';
 exception when insufficient_privilege then if sqlerrm<>'siem_access_denied' then raise;end if;end;
end $$;
rollback;
