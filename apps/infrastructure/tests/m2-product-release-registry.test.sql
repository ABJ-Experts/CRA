begin;

create extension if not exists pgtap;
select plan(11);

select has_table('public', 'products', 'products table exists');
select has_table('public', 'product_releases', 'product releases table exists');
select has_table('public', 'product_legal_entity_assignments', 'assignment history table exists');
select has_table('public', 'product_lifecycle_dependency_facts', 'lifecycle dependency projection exists');
select ok((select relrowsecurity from pg_class where oid = 'public.products'::regclass), 'products has RLS enabled');
select table_privs_are('public', 'products', 'anon', array[]::text[], 'anon has no products table grants');
select ok(not has_function_privilege('authenticated', 'public.create_product_atomic(uuid,uuid,uuid,text,text,text,text,uuid,uuid)', 'execute'), 'browser role cannot create products');
select ok(not has_function_privilege('authenticated', 'public.archive_product_release_atomic(uuid,uuid,uuid,uuid,integer,text)', 'execute'), 'browser role cannot archive releases');
select has_index('public', 'products', 'products_list_idx', 'product list pagination index exists');
select has_index('public', 'product_releases', 'releases_list_idx', 'release list pagination index exists');
select has_index('public', 'products', 'products_organization_id_internal_code_normalized_key', 'internal code uniqueness remains organization-scoped and permanent');

select * from finish();
rollback;
