import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const tests = dirname(fileURLToPath(import.meta.url));
// Reuse maintained source-owned workflow fixtures inside their original first
// rollback transaction; do not copy migrations, seed global state or reset data.
const parity = readFileSync(
  resolve(tests, "m14_03-nested-source-parity.test.sql"),
  "utf8",
);
const helper = parity.slice(
  parity.indexOf("create function pg_temp.assert_export_parity"),
  parity.indexOf("do $$ declare org"),
);
const checks = {
  "m2-v2-substantial-modifications-security-update-artifacts.test.sql": `
do $$ declare ctx record;r record;s text;covered text[]:='{}';begin
 for ctx in select m.organization_id,m.user_id,p.id product_id from public.products p join public.organization_members m on m.organization_id=p.organization_id and m.role='owner' where p.archived_at is null loop
 select * into r from public.list_product_substantial_modification_assessments(ctx.organization_id,ctx.product_id,ctx.user_id,null,null,1,100);
 if r.outcome='found' and jsonb_array_length(r.assessments->'rows')>0 then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'products.compliance.mod_assessments','{}',jsonb_build_object('productId',ctx.product_id),r.assessments->'rows');covered:=array_append(covered,'assessments');end if;
 select * into r from public.list_product_security_update_artifacts(ctx.organization_id,ctx.product_id,null,ctx.user_id,null,1,100);
 if r.outcome='found' and jsonb_array_length(r.artifacts->'rows')>0 then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'products.compliance.security_artifacts','{}',jsonb_build_object('productId',ctx.product_id),r.artifacts->'rows');covered:=array_append(covered,'artifacts');end if;
 end loop;
 for ctx in select distinct a.organization_id,a.product_id,a.modification_id,m.user_id from public.product_substantial_modification_assessments a join public.organization_members m on m.organization_id=a.organization_id and m.role='owner' loop
 select * into r from public.list_product_substantial_modification_assessments(ctx.organization_id,ctx.product_id,ctx.user_id,null,null,1,100);
 select coalesce(jsonb_agg(x order by x->>'createdAt',n),'[]') as history into r from jsonb_array_elements(r.assessments->'rows') with ordinality a(x,n) where x->>'modificationId'=ctx.modification_id::text;
 if jsonb_array_length(r.history)>0 then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'products.compliance.mod_assessment_history','{}',jsonb_build_object('productId',ctx.product_id,'modificationId',ctx.modification_id),r.history);covered:=array_append(covered,'history');end if;
 end loop;if not covered@>array['assessments','artifacts','history'] then raise exception 'positive compliance coverage incomplete: %',covered;end if;end $$;`,
  "m5-vex-export-browser-fixture.sql": `
do $$ declare o uuid:='00000000-0000-4000-8000-0000000000ca';p uuid:='c6060000-0000-4000-8000-000000000001';rel uuid:='c6060000-0000-4000-8000-000000000002';u uuid;r record;scope_value jsonb;hash_value text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');object_path text;snapshot uuid;target uuid;target_version integer;begin
 select id into strict u from public.users where email='owner@cra.test';
 scope_value:=public.m5_vex_export_scope_json(o,p,rel);
 if (scope_value#>>'{scope,assessmentCount}')::integer<1 then raise exception 'positive VEX export eligible scope missing';end if;
 object_path:=o||'/vex/openvex/0_2_0/'||hash_value||'.json';
 insert into storage.objects(bucket_id,name,metadata) values('tenant-exports',object_path,'{"size":8,"mimetype":"application/json"}');
 select * into r from public.create_vulnerability_vex_export_snapshot_atomic(o,u,p,rel,'openvex','0.2.0',scope_value->>'scopeDigest',hash_value,8,object_path,gen_random_uuid(),gen_random_uuid());
 if r.outcome not in ('created','reused') then raise exception 'VEX export native fixture: %',r.outcome;end if;
 snapshot:=(r.result#>>'{snapshot,id}')::uuid;
 select * into r from public.list_vulnerability_vex_export_snapshots(o,u,p,rel);
 perform pg_temp.assert_export_parity(o,u,'findings.vex_exports','{}',jsonb_build_object('productId',p,'releaseId',rel),r.result->'snapshots');
 select * into r from public.set_vulnerability_vex_publication_target_atomic(o,u,'m14-fixture-'||substr(replace(gen_random_uuid()::text,'-',''),1,16),true,0,gen_random_uuid(),gen_random_uuid());
 if r.outcome<>'updated' then raise exception 'VEX target native fixture: %',r.outcome;end if;
 target:=(r.result#>>'{target,id}')::uuid;target_version:=(r.result#>>'{target,version}')::integer;
 select * into r from public.list_vulnerability_vex_publication_targets(o,u);
 perform pg_temp.assert_export_parity(o,u,'findings.vex_publication_targets','{}','{}',r.result->'targets');
 select * into r from public.enqueue_vulnerability_vex_publication_atomic(o,u,snapshot,target,target_version,'publish',hash_value,true,null,gen_random_uuid(),gen_random_uuid());
 if r.outcome<>'queued' then raise exception 'VEX publication native fixture: %',r.outcome;end if;
 select * into r from public.list_vulnerability_vex_publication_jobs(o,u,snapshot);
 perform pg_temp.assert_export_parity(o,u,'findings.vex_publications','{}',jsonb_build_object('exportId',snapshot),r.result->'jobs');
 raise notice 'M14 positive native VEX scope, export, target and publication parity';end $$;`,
  "m5-vex-assessments-approval.test.sql": `
do $$ declare o uuid:='00000000-0000-4000-8000-0000000000ca';u uuid;r record;filters jsonb;rows jsonb;begin
 select id into strict u from public.users where email='owner@cra.test';
 filters:='{"approvalStates":["awaiting_approval"],"vexStatuses":["affected"],"reEvaluationStates":["unchanged"],"sort":"lastEvaluatedAt","order":"desc"}';
 select * into r from public.list_finding_triage_queue(o,u,filters,100,null,'lastEvaluatedAt','desc');
 select jsonb_agg(jsonb_build_object('id',x#>'{finding,id}','productId',x#>'{product,id}','releaseId',x#>'{release,id}','advisoryId',x#>'{finding,advisoryId}','severity',x->'severity','vexStatus',x->'vexStatus','lastEvaluatedAt',x#>'{finding,lastEvaluatedAt}') order by n) into rows from jsonb_array_elements(r.result->'rows') with ordinality a(x,n);
 perform pg_temp.assert_export_parity(o,u,'findings.triage_queue',filters,'{}',rows);
 raise notice 'M14 positive triage parity includes native VEX approval and reEvaluation filters';end $$;`,
  "m11-05-remediation-ticket-sync.test.sql": `
do $$ declare ctx record;r record;verified integer:=0;begin
 for ctx in select distinct t.organization_id,t.finding_id,m.user_id from public.vulnerability_remediation_tickets t join public.organization_members m on m.organization_id=t.organization_id and m.role='owner' loop
 select * into r from public.list_finding_remediation_tickets(ctx.organization_id,ctx.user_id,ctx.finding_id);
 if r.outcome='found' and jsonb_array_length(r.result->'tickets')>0 then
 perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'findings.remediation_tickets','{}',jsonb_build_object('findingId',ctx.finding_id),r.result->'tickets');verified:=verified+1;end if;
 end loop;if verified=0 then raise exception 'positive remediation tickets absent';end if;
 raise notice 'M14 positive ticket parity from complete native sync lifecycle';end $$;`,
  "m2-v1-support-period-retention-alerts.test.sql": `
do $$ declare ctx record;r record;rows jsonb;verified integer:=0;begin
 for ctx in select distinct m.organization_id,m.user_id,p.product_id from public.product_support_periods p join public.organization_members m on m.organization_id=p.organization_id and m.role='owner' loop
 select * into r from public.get_product_support_periods(ctx.organization_id,ctx.product_id,ctx.user_id);
 select jsonb_agg(x||jsonb_build_object('revision',x->'scopeRevision','startsAt',x->'supportStartsAt','endsAt',x->'supportEndsAt','rationale',x->'expectedLifetimeJustification') order by n) into rows from jsonb_array_elements(r.support_periods) with ordinality a(x,n);
 perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'products.support_period_history','{}',jsonb_build_object('productId',ctx.product_id),rows);
 select * into r from public.get_product_support_alert_history(ctx.organization_id,ctx.product_id,ctx.user_id);
 perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'products.support_alerts','{}',jsonb_build_object('productId',ctx.product_id),r.alerts);
 verified:=verified+2;end loop;
 if verified<2 then raise exception 'support positive histories absent';end if;
 raise notice 'M14 positive history parity: support periods and alerts';end $$;`,
  "m2-v1-variants-hierarchy-finding-propagation.test.sql": `
do $$ declare ctx record;r record;s text;rows jsonb;asof_value timestamptz:=clock_timestamp()+interval '2 minutes';covered text[]:='{}';begin
 for ctx in select m.organization_id,m.user_id,p.id product_id from public.products p join public.organization_members m on m.organization_id=p.organization_id and m.role='owner' where p.archived_at is null loop
 foreach s in array array['products.relationship.component_links','products.relationship.baseline_memberships','products.relationship.variants','products.relationship.graph_links'] loop
 case s
 when 'products.relationship.component_links' then select * into r from public.get_product_component_links(ctx.organization_id,ctx.product_id,ctx.user_id,null);rows:=r.links;
 when 'products.relationship.baseline_memberships' then select * into r from public.get_product_software_baseline_memberships(ctx.organization_id,ctx.product_id,ctx.user_id,null);rows:=r.memberships;
 when 'products.relationship.variants' then select * into r from public.get_product_variant_relationships(ctx.organization_id,ctx.product_id,ctx.user_id,null);rows:=r.relationships;
 when 'products.relationship.graph_links' then select * into r from public.get_product_relationship_graph(ctx.organization_id,ctx.product_id,ctx.user_id,asof_value,null,8,true);rows:=r.graph->'links';end case;
 if r.outcome='found' and jsonb_array_length(rows)>0 then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,s,case when s='products.relationship.graph_links' then jsonb_build_object('includeEnded',true,'asOf',asof_value) else '{}'::jsonb end,jsonb_build_object('productId',ctx.product_id),rows);covered:=array_append(covered,s);end if;
 end loop;end loop;
 for ctx in select m.organization_id,m.user_id,b.baseline_id baseline_id from public.software_baselines b join public.organization_members m on m.organization_id=b.organization_id and m.role='owner' loop
 select * into r from public.get_software_baseline_history(ctx.organization_id,ctx.baseline_id,ctx.user_id);
 if r.outcome='found' and jsonb_array_length(r.baselines)>0 then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'products.relationship.baseline_revisions','{}',jsonb_build_object('baselineId',ctx.baseline_id),r.baselines);covered:=array_append(covered,'products.relationship.baseline_revisions');end if;end loop;
 if not covered@>array['products.relationship.component_links','products.relationship.baseline_memberships','products.relationship.variants','products.relationship.graph_links','products.relationship.baseline_revisions'] then raise exception 'positive relationship coverage incomplete: %',covered;end if;
 raise notice 'M14 positive history parity: all five relationship lists';end $$;`,
};
for (const [file, check] of Object.entries(checks)) {
  let original = readFileSync(resolve(tests, file), "utf8");
  // The legacy browser fixture predates immutable completed SBOM graphs. Build
  // its graph in the native processing state and finalize only after components.
  if (file === "m5-vex-export-browser-fixture.sql") {
    original = original.replace(
      "'valid', 'completed', 'completed',\n      1, 1, clock_timestamp()",
      "'valid', 'processing', 'resolving_graph',\n      1, 1, null",
    );
    original = original.replace(
      "returning id into v_component;",
      "returning id into v_component;\n    update public.sbom_documents set state='completed',progress_stage='completed',completed_at=clock_timestamp() where organization_id=v_org and id=v_document;",
    );
  }

  const end = original.indexOf("rollback;");
  assert.ok(
    end !== -1 || file === "m5-vex-export-browser-fixture.sql",
    "fixture must be rollback-only or explicitly wrapped browser fixture",
  );
  const fixture = end === -1 ? "begin;\n" + original : original.slice(0, end);
  let sql = fixture + helper + check + "\nrollback;\n";
  if (
    file ===
    "m2-v2-substantial-modifications-security-update-artifacts.test.sql"
  ) {
    // Verify while the source fixture's actors are active, before its intentional
    // authority-revocation and deletion regression checks run.
    const verifier = check.replace(
      "do $$ declare",
      () =>
        "create function pg_temp.verify_compliance_parity() returns void language plpgsql as $$ declare",
    );
    sql =
      helper +
      verifier +
      fixture.replace(
        "  update public.users set is_active = false",
        "  perform pg_temp.verify_compliance_parity();\n  update public.users set is_active = false",
      ) +
      "\nrollback;\n";
  }

  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_cra",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ],
    { input: sql, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  console.log(`M14 positive native history parity passed: ${file}`);
}
