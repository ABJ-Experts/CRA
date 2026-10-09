#!/usr/bin/env bash
set -euo pipefail
# Disposable two-connection proof: committed fixture roots are exact-run owned.
# Writer readiness is bounded. A heavily delayed reader may fail the initial
# old-value assertion after the three-second commit; this is a safe test failure,
# never evidence of a mixed-snapshot pass. Run without overlapping load tests.
database="${M14_CONTEXT_DATABASE:-cra_m14_benchmark}"
[[ "$database" == cra_m14_benchmark ]] || { echo 'Context concurrency requires disposable clone' >&2; exit 1; }
container=supabase_db_cra
run_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
actor="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
role_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
owned_dir="$(mktemp -d)"
writer_pid=""
query() { docker exec -i "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v org="$run_id" -v actor="$actor" -v role_id="$role_id"; }
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$writer_pid" ]]; then wait "$writer_pid" || status=1; fi
  query <<'SQL' || status=1
begin;
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception 'Disposable cleanup only';end if;end$$;
delete from public.organizations where id=:'org'::uuid and slug='m14-context-concurrency-'||:'org';
delete from public.users where id=:'actor'::uuid and email='m14-context-concurrency-'||:'actor'||'@example.invalid';
commit;
SQL
  rm -rf "$owned_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
query <<'SQL'
begin;
do $$begin if current_database()<>'cra_m14_benchmark'then raise exception 'Disposable concurrency only';end if;end$$;
insert into public.users(id,email)values(:'actor','m14-context-concurrency-'||:'actor'||'@example.invalid');
insert into public.organizations(id,name,slug)values(:'org','M14 synthetic context concurrency','m14-context-concurrency-'||:'org');
insert into public.organization_members(organization_id,user_id,role)values(:'org',:'actor','viewer');
insert into public.custom_roles(id,organization_id,name,permissions)values(:'role_id',:'org','Synthetic coherent context','{"can_view_findings":false}');
insert into public.user_role_assignments(organization_id,user_id,role_id)values(:'org',:'actor',:'role_id');
insert into public.base_role_permission_overrides(organization_id,base_role,permissions)values(:'org','viewer','{"can_view_dashboards":true}');
commit;
SQL
query > "$owned_dir/writer.log" 2>&1 <<'SQL' &
begin;
update public.custom_roles set permissions='{"can_view_findings":true}'where organization_id=:'org' and id=:'role_id';
update public.base_role_permission_overrides set permissions='{"can_view_dashboards":false}'where organization_id=:'org' and base_role='viewer';
\echo WRITER_READY
select pg_sleep(3);
commit;
SQL
writer_pid=$!
for attempt in {1..100}; do
  if rg -q WRITER_READY "$owned_dir/writer.log"; then break; fi
  if ! kill -0 "$writer_pid" 2>/dev/null; then cat "$owned_dir/writer.log"; exit 1; fi
  sleep .05
done
rg -q WRITER_READY "$owned_dir/writer.log" || { echo 'Writer handshake expired' >&2; exit 1; }
query <<'SQL'
begin isolation level repeatable read;
create temporary table context_scope as select :'org'::uuid org,:'actor'::uuid actor;
create temporary table initial_context as select public.get_dashboard_permission_context(:'org',:'actor','viewer')j;
do $$declare j jsonb;begin select initial_context.j into j from initial_context;if j->>'outcome'<>'available' or j#>'{context,customRoles,0,permissions}'<>'{"can_view_findings":false}'::jsonb or j#>'{context,baseRoleOverrides}'<>'{"can_view_dashboards":true}'::jsonb then raise exception 'Uncommitted permission inputs leaked';end if;end$$;
select pg_sleep(4);
do $$declare s record;j jsonb;begin select *into s from context_scope;j:=public.get_dashboard_permission_context(s.org,s.actor,'viewer');if j<>(select initial_context.j from initial_context)then raise exception 'Snapshot mixed versions and inputs';end if;end$$;
commit;
do $$declare s record;j jsonb;prior jsonb;begin select *into s from context_scope;select initial_context.j into prior from initial_context;j:=public.get_dashboard_permission_context(s.org,s.actor,'viewer');if(j#>>'{context,permissionVersion}')::bigint<=(prior#>>'{context,permissionVersion}')::bigint or j#>'{context,customRoles,0,permissions}'<>'{"can_view_findings":true}'::jsonb or j#>'{context,baseRoleOverrides}'<>'{"can_view_dashboards":false}'::jsonb then raise exception 'Next statement missed coherent committed invalidation';end if;if public.get_dashboard_projection(s.org,s.actor,'overview','{}')<>'{"outcome":"not_found"}'::jsonb then raise exception 'Source facade disclosed stale counts after denied override';end if;raise notice 'M14 context concurrent version/custom-role/override snapshot verified';end$$;
SQL
wait "$writer_pid"
writer_pid=""
query > "$owned_dir/rollback-writer.log" 2>&1 <<'SQL' &
begin;
update public.organization_members set role='admin'where organization_id=:'org' and user_id=:'actor';
update public.custom_roles set permissions='{"can_view_findings":false}'where organization_id=:'org' and id=:'role_id';
\echo ROLLBACK_WRITER_READY
select pg_sleep(3);
rollback;
SQL
writer_pid=$!
for attempt in {1..100}; do
  if rg -q ROLLBACK_WRITER_READY "$owned_dir/rollback-writer.log"; then break; fi
  if ! kill -0 "$writer_pid" 2>/dev/null; then cat "$owned_dir/rollback-writer.log"; exit 1; fi
  sleep .05
done
rg -q ROLLBACK_WRITER_READY "$owned_dir/rollback-writer.log" || { echo 'Rollback writer handshake expired' >&2; exit 1; }
query <<'SQL'
create temporary table context_scope as select :'org'::uuid org,:'actor'::uuid actor;
create temporary table initial_context as select public.get_dashboard_permission_context(:'org',:'actor','viewer')j;
do $$begin if(select j->>'outcome'from initial_context)<>'available'then raise exception 'Uncommitted role changed verified context';end if;end$$;
select pg_sleep(4);
do $$declare s record;j jsonb;begin select *into s from context_scope;j:=public.get_dashboard_permission_context(s.org,s.actor,'viewer');if j<>(select initial_context.j from initial_context)then raise exception 'Rolled-back role/permission transaction invalidated context';end if;raise notice 'M14 context concurrent role/permission rollback verified';end$$;
SQL
wait "$writer_pid"
writer_pid=""
echo 'M14 dashboard permission context concurrency PASS'
