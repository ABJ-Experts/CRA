-- The first applied reconciler predates the later representative-finding
-- column. Populate it synchronously for every insert so alert creation stays
-- atomic and existing matching triggers cannot fail on a null ledger key.
create or replace function public.m4_03_fill_kev_alert_triggering_finding()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.triggering_finding_id is null then
  select id into new.triggering_finding_id from public.vulnerability_findings
   where organization_id=new.organization_id and release_id=new.release_id and vulnerability_id=new.vulnerability_id and status='active'
   order by id limit 1;
 end if;
 if new.triggering_finding_id is null then raise exception 'KEV alert requires an active triggering finding'; end if;
 return new;
end;$$;
drop trigger if exists fill_kev_alert_triggering_finding on public.vulnerability_kev_alerts;
create trigger fill_kev_alert_triggering_finding before insert on public.vulnerability_kev_alerts
for each row execute function public.m4_03_fill_kev_alert_triggering_finding();

-- Preserve the authoritative KEV projection emitted by the baseline list
-- while replacing CVSS/EPSS/CWE/alias/reference intelligence from immutable
-- source versions.
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text)
 rename to list_vulnerability_enriched_findings_for_document_page_intelligence;
create or replace function public.list_vulnerability_enriched_findings_for_document_page(
 p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_include_low_confidence boolean,p_page integer default 1,p_page_size integer default 50,p_q text default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; rows jsonb;
begin
 select * into raw from public.list_vulnerability_enriched_findings_for_document_page_intelligence(p_organization_id,p_actor_user_id,p_document_id,p_include_low_confidence,p_page,p_page_size,p_q);
 if raw.outcome<>'found' then return query select raw.outcome,raw.result;return;end if;
 select coalesce(jsonb_agg(item||jsonb_build_object('intelligence',public.m4_03_intelligence_with_provenance_json((select vulnerability_id from public.vulnerability_findings where id=(item->'finding'->>'id')::uuid),(item->'finding'->>'lastEvaluatedAt')::timestamptz)||jsonb_build_object('kev',item->'intelligence'->'kev'))),'[]'::jsonb) into rows from jsonb_array_elements(raw.result->'rows') item;
 return query select 'found'::text,jsonb_set(raw.result,'{rows}',rows);
end;$$;
alter function public.m4_03_fill_kev_alert_triggering_finding() owner to postgres;
alter function public.list_vulnerability_enriched_findings_for_document_page_intelligence(uuid,uuid,uuid,boolean,integer,integer,text) owner to postgres;
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) owner to postgres;
revoke all on function public.m4_03_fill_kev_alert_triggering_finding(),public.list_vulnerability_enriched_findings_for_document_page_intelligence(uuid,uuid,uuid,boolean,integer,integer,text),public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) from public,anon,authenticated;
grant execute on function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) to service_role;
