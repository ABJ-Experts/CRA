-- All organizations, jobs, policy changes and durable transition receipts below
-- are owned rollback fixtures. Existing development jobs are never modified.
begin;
set local statement_timeout='15s';
create or replace function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
do $$
declare
 v_orgs uuid[]; v_org uuid; v_user uuid; v_filters jsonb; v_digest text;
 v_snapshot jsonb; v_jobs uuid[]:='{}'; v_claim_a jsonb; v_claim_b jsonb; v_restart jsonb;
 v_sentinel uuid; v_selected uuid[]; v_session uuid:=gen_random_uuid(); v_grant_a jsonb; v_grant_b jsonb;
begin
 select array_agg(id order by id) into v_orgs from (select gen_random_uuid() id union all select gen_random_uuid()) x;
 select user_id into strict v_user from public.organization_members where organization_id='00000000-0000-4000-8000-0000000000ca' and role='owner' limit 1;
 v_filters:=jsonb_build_object('from',to_char((clock_timestamp()-interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'to',to_char((clock_timestamp()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(v_filters),'UTF8'),'sha256'),'hex');
 foreach v_org in array v_orgs[1:1] loop
  insert into public.organizations(id,name,slug) values(v_org,'M13 lifecycle fixture','m13-lifecycle-'||v_org::text);
  insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
  insert into public.audit_logs(organization_id,action,entity_type,entity_id) values(v_org,'audit.lifecycle.fixture','organization',v_org::text);
  set constraints m13_02_finalize_audit_chain immediate;
  v_snapshot:=public.m13_03_create_snapshot(v_org,v_user,gen_random_uuid(),v_digest,repeat('b',64));
  v_jobs:=array_append(v_jobs,(public.m13_03_create_export(v_org,v_user,gen_random_uuid(),(v_snapshot->>'receiptId')::uuid,v_filters,v_digest,repeat('b',64),'json')->>'id')::uuid);
  if v_org=v_orgs[1] then
   v_jobs:=array_append(v_jobs,(public.m13_03_create_export(v_org,v_user,gen_random_uuid(),(v_snapshot->>'receiptId')::uuid,v_filters,v_digest,repeat('b',64),'csv')->>'id')::uuid);
   v_jobs:=array_append(v_jobs,(public.m13_03_create_export(v_org,v_user,gen_random_uuid(),(v_snapshot->>'receiptId')::uuid,v_filters,v_digest,repeat('b',64),'csv')->>'id')::uuid);
  end if;
 end loop;
 -- Reproduce an unrelated browser/dev queued job without changing that job:
 -- insert one rollback-only clone of its immutable request inputs. This row
 -- must remain queued while fixture claims/reclaims exercise the real RPC.
 insert into public.audit_export_jobs(organization_id,requester_id,request_id,snapshot_receipt_id,filters,filter_digest,scope_digest,scope_version,high_water_sequence,format)
 select organization_id,requester_id,gen_random_uuid(),snapshot_receipt_id,filters,filter_digest,scope_digest,scope_version,high_water_sequence,format from public.audit_export_jobs where organization_id<>all(v_orgs) order by created_at limit 1 returning id into v_sentinel;
 -- Deterministic priority applies exclusively to the two newly inserted orgs.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity',created_at='1970-01-01'::timestamptz+array_position(v_jobs,id)*interval '1 second' where organization_id=any(v_orgs);
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_claim_a:=public.m13_03_claim_export('lifecycle-original');
 select array_agg(value::uuid) into v_selected from jsonb_array_elements_text(v_claim_a->'selected_event_ids');
 perform pg_temp.check('restart fixture contains actual selected evidence',cardinality(v_selected)=1);
 update public.audit_export_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_jobs[1];
 begin
  perform public.m13_03_transition_export(v_orgs[1],v_jobs[1],'lifecycle-original',(v_claim_a->>'version')::integer,'processing',null,null,null);
  raise exception 'expired lease accepted';
 exception when serialization_failure then null; end;
 -- Reclaim fairness uses the tenant's last update, so refresh only this
 -- rollback fixture's priority after the first claim updated its timestamp.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity' where organization_id=v_orgs[1];
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_restart:=public.m13_03_claim_export('lifecycle-restarted');
 perform pg_temp.check('restart reclaims lease and exact frozen selection',v_restart->>'id'=v_jobs[1]::text and (v_restart->>'attempts')::integer=2 and v_restart->'selected_event_ids'=v_claim_a->'selected_event_ids' and (v_restart->>'version')::integer>(v_claim_a->>'version')::integer);
 begin
  perform public.m13_03_transition_export(v_orgs[1],v_jobs[1],'lifecycle-original',(v_claim_a->>'version')::integer,'processing',null,null,null);
  raise exception 'superseded worker accepted';
 exception when serialization_failure then null; end;
 perform public.m13_03_transition_export(v_orgs[1],v_jobs[1],'lifecycle-restarted',(v_restart->>'version')::integer,'ready',v_selected,jsonb_build_object('sha256',repeat('c',64),'bytes',123,'objectPath',v_orgs[1]::text||'/'||v_jobs[1]::text||'/'||repeat('c',64)||'.zip'),null);
 v_grant_a:=public.m13_03_issue_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('d',64),gen_random_uuid());
 v_grant_b:=public.m13_03_issue_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('e',64),gen_random_uuid());
 perform pg_temp.check('grant rotation increments version',(v_grant_b->>'download_grant_version')::integer=(v_grant_a->>'download_grant_version')::integer+1);
 begin
  perform public.m13_03_redeem_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('d',64),gen_random_uuid());
  raise exception 'rotated grant accepted';
 exception when insufficient_privilege then null; end;
 update public.audit_export_jobs set download_expires_at=clock_timestamp()-interval '1 second' where id=v_jobs[1];
 begin
  perform public.m13_03_redeem_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('e',64),gen_random_uuid());
  raise exception 'expired grant accepted';
 exception when insufficient_privilege then null; end;
 perform public.m13_03_issue_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('f',64),gen_random_uuid());
 begin
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_orgs[1],'owner','{"can_export_audit":false}');
 begin
  perform public.m13_03_redeem_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('f',64),gen_random_uuid());
  raise exception 'revoked export permission accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.m13_03_issue_download_grant(v_orgs[1],v_user,v_jobs[1],v_session,repeat('a',64),gen_random_uuid());
  raise exception 'revoked permission issued grant';
 exception when insufficient_privilege then null; end;
 raise exception using errcode='P0002',message='roll back temporary permission revocation';
 exception when no_data_found then null; end;
 perform pg_temp.check('denied deliveries never produce download-started evidence',not exists(select 1 from public.audit_logs where organization_id=v_orgs[1] and entity_id=v_jobs[1]::text and action='audit.export.download_started'));

 -- Finish all lower-UUID tenant writes before acquiring the second tenant's
 -- chain lock, preserving the existing transaction lock-order invariant.
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity' where organization_id=v_orgs[1];
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_claim_a:=public.m13_03_claim_export('lifecycle-fair-first');
 perform pg_temp.check('first tenant claims its next job',v_claim_a->>'id'=v_jobs[2]::text);
 v_org:=v_orgs[2];
 insert into public.organizations(id,name,slug) values(v_org,'M13 lifecycle fixture','m13-lifecycle-'||v_org::text);
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 v_snapshot:=public.m13_03_create_snapshot(v_org,v_user,gen_random_uuid(),v_digest,repeat('b',64));
 v_jobs:=array_append(v_jobs,(public.m13_03_create_export(v_org,v_user,gen_random_uuid(),(v_snapshot->>'receiptId')::uuid,v_filters,v_digest,repeat('b',64),'json')->>'id')::uuid);
 alter table public.audit_export_jobs disable trigger set_audit_export_jobs_updated_at;
 update public.audit_export_jobs set updated_at='-infinity',created_at='1970-01-01' where organization_id=v_org;
 alter table public.audit_export_jobs enable trigger set_audit_export_jobs_updated_at;
 v_claim_b:=public.m13_03_claim_export('lifecycle-other-tenant');
 perform pg_temp.check('one active job per tenant and fair next tenant',v_claim_b->>'id'=v_jobs[4]::text and (select state='queued' from public.audit_export_jobs where id=v_jobs[3]));
 perform pg_temp.check('two global worker slots',public.m13_03_claim_export('lifecycle-third-slot') is null);
 perform pg_temp.check('unrelated queued job remains untouched',v_sentinel is null or (select state='queued' and attempts=0 and worker_id is null from public.audit_export_jobs where id=v_sentinel));
end $$;
rollback;
