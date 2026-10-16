/** Canonical JSONB snapshots are sealed in the encrypted inventory, never an API. */
export const RECOVERY_CATALOG_SQL = `
with namespaces as (
 select oid,nspname,nspowner,nspacl from pg_namespace
 where nspname not like 'pg_%' and nspname <> 'information_schema'
), relations as (
 select n.nspname,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
 pg_get_userbyid(c.relowner) owner,c.relacl,
 case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end definition
 from pg_class c join namespaces n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','S','f')
), columns as (
 select n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) type,
 a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) default_expression
 from pg_attribute a join pg_class c on c.oid=a.attrelid join namespaces n on n.oid=c.relnamespace
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attnum>0 and not a.attisdropped
), constraints as (
 select n.nspname,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true) definition
 from pg_constraint k join pg_class c on c.oid=k.conrelid join namespaces n on n.oid=c.relnamespace
), indexes as (
 select n.nspname,c.relname,indexdef from pg_indexes i join pg_namespace n on n.nspname=i.schemaname
 join pg_class c on c.relname=i.tablename and c.relnamespace=n.oid join namespaces x on x.oid=n.oid
), routines as (
 select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) identity_arguments,
 p.prokind,pg_get_userbyid(p.proowner) owner,p.proacl,p.proconfig,p.prosecdef,
 case when p.prokind<>'a' then pg_get_functiondef(p.oid) end definition
 from pg_proc p join namespaces n on n.oid=p.pronamespace
), triggers as (
 select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) definition
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join namespaces n on n.oid=c.relnamespace
 where not t.tgisinternal
)
select jsonb_build_object(
 'schemas',(select coalesce(jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl) order by nspname),'[]') from namespaces),
 'relations',(select coalesce(jsonb_agg(to_jsonb(r) order by nspname,relname),'[]') from relations r),
 'columns',(select coalesce(jsonb_agg(to_jsonb(c) order by nspname,relname,attnum),'[]') from columns c),
 'constraints',(select coalesce(jsonb_agg(to_jsonb(c) order by nspname,relname,conname),'[]') from constraints c),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(i) order by nspname,relname,indexdef),'[]') from indexes i),
 'routines',(select coalesce(jsonb_agg(to_jsonb(r) order by nspname,proname,identity_arguments),'[]') from routines r),
 'triggers',(select coalesce(jsonb_agg(to_jsonb(t) order by nspname,relname,tgname),'[]') from triggers t),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p),
 'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by rolname),'[]') from (select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,rolconfig from pg_roles) r),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) order by r.rolname,m.rolname,g.rolname),'[]') from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor),
 'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner),'config',e.extconfig,'condition',e.extcondition) order by extname),'[]') from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'sequences',(select coalesce(jsonb_agg(to_jsonb(s) order by schemaname,sequencename),'[]') from (select schemaname,sequencename,sequenceowner,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text,last_value::text from pg_sequences where schemaname not like 'pg_%') s),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by pubname),'[]') from pg_publication p),
 'publicationTables',(select coalesce(jsonb_agg(to_jsonb(p) order by pubname,schemaname,tablename),'[]') from pg_publication_tables p)
)::text;
`;

export const RECOVERY_AUDIT_HEADS_SQL = `
select coalesce(jsonb_agg(jsonb_build_object('organizationId',organization_id,'sequence',last_sequence::text,'hash',last_hash,'eventId',last_event_id,'legacyCount',legacy_count::text) order by organization_id),'[]')::text
from public.audit_chain_heads;
`;

/** Every row is recomputed in PostgreSQL; only a scalar verdict crosses the boundary. */
export const RECOVERY_AUDIT_INTEGRITY_SQL = `
with rows as (
 select a as audit_row,a.*,lag(content_hash,1,repeat('0',64)) over(partition by organization_id order by chain_sequence) expected_previous,
 row_number() over(partition by organization_id order by chain_sequence) expected_sequence
 from public.audit_logs a where chain_version=1
), invalid as (
 select 1 from rows r where chain_sequence is null or chain_sequence<>expected_sequence or previous_hash<>expected_previous
 or canonical_content is distinct from public.m13_02_canonical_content(r.audit_row,chain_sequence)
 or content_hash is distinct from encode(extensions.digest(decode(previous_hash,'hex')||convert_to(canonical_content,'UTF8'),'sha256'),'hex')
), head_invalid as (
 select 1 from public.audit_chain_heads h left join public.audit_logs a on a.organization_id=h.organization_id and a.chain_sequence=h.last_sequence
 where (h.last_sequence=0 and (h.last_hash<>repeat('0',64) or h.last_event_id is not null))
 or (h.last_sequence>0 and (a.id is distinct from h.last_event_id or a.content_hash is distinct from h.last_hash))
 or exists(select 1 from public.audit_logs x where x.organization_id=h.organization_id and x.chain_sequence>h.last_sequence)
)
select (not exists(select 1 from invalid) and not exists(select 1 from head_invalid))::text;
`;

export const RECOVERY_MIGRATIONS_SQL = `select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]')::text from supabase_migrations.schema_migrations m;`;

export const RECOVERY_OBJECT_METADATA_SQL = `select coalesce(jsonb_agg(jsonb_build_object('bucketId',bucket_id,'name',name,'version',version,'bytes',coalesce((metadata->>'size')::bigint,0)) order by bucket_id,name,version),'[]')::text from storage.objects;`;
