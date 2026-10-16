-- Disposable test database only. No upgrade source tables or foreign keys are introduced.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(9);
select is((select outcome from public.m13_01_append_audit_event(
 null,'security','upgrade:15000000-0000-4000-8000-000000000606:1','operator','15000000-0000-4000-8000-000000000601',
 'upgrade.preflight','upgrade','15000000-0000-4000-8000-000000000606','completed','15000000-0000-4000-8000-000000000606',
 null,'{"stage":"preflight","version":1}'::jsonb,null,null,null,null)), 'inserted','externally journaled upgrade fact appends to existing durable audit');
select is((select outcome from public.m13_01_append_audit_event(
 null,'security','upgrade:15000000-0000-4000-8000-000000000606:1','operator','15000000-0000-4000-8000-000000000601',
 'upgrade.preflight','upgrade','15000000-0000-4000-8000-000000000606','completed','15000000-0000-4000-8000-000000000606',
 null,'{"stage":"preflight","version":1}'::jsonb,null,null,null,null)), 'replayed','restart replays the exact run and journal sequence idempotently');
select is((select outcome from public.m13_01_append_audit_event(
 null,'security','upgrade:15000000-0000-4000-8000-000000000606:1','operator','15000000-0000-4000-8000-000000000601',
 'upgrade.preflight','upgrade','15000000-0000-4000-8000-000000000606','failed','15000000-0000-4000-8000-000000000606',
 null,'{"stage":"preflight","version":1}'::jsonb,null,null,null,null)), 'conflict','same event key cannot rewrite the authenticated outcome');
select is((select count(*) from public.audit_logs where event_key='upgrade:15000000-0000-4000-8000-000000000606:1'),1::bigint,'one durable record for duplicate acknowledgements');
select ok((select actor_type='operator' and actor_id='15000000-0000-4000-8000-000000000601' and organization_id is null and user_id is null from public.audit_logs where event_key='upgrade:15000000-0000-4000-8000-000000000606:1'),'operator identity does not invent a tenant or customer user foreign key');
select ok((select after_redacted='{"stage":"preflight","version":1}'::jsonb and ip_address is null and user_agent is null and reason is null from public.audit_logs where event_key='upgrade:15000000-0000-4000-8000-000000000606:1'),'existing M13 safe projection retains only operational facts');
set constraints all immediate;
select throws_ok($$update public.audit_logs set after_redacted='{}'::jsonb where event_key='upgrade:15000000-0000-4000-8000-000000000606:1'$$,'42501','audit ledger is append-only','durable upgrade audit payload cannot be rewritten after deferred constraints');
select ok((select has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='m13_01_append_audit_event'),'existing durable append remains service-only');
select ok((select organization_id is null and chain_version is null from public.audit_logs where event_key='upgrade:15000000-0000-4000-8000-000000000606:1'),'instance facts preserve the existing organization-only chain boundary; host journal authenticates instance evidence');
select * from finish();
rollback;
