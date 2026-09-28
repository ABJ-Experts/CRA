-- M2 immutable human-declared classification runs. No legal approval is asserted.
create function public.m2_classification_policy() returns jsonb
language sql immutable set search_path=public,pg_temp as $fn$ select $policy${
  "version": "cra-human-declarations-v1",
  "hash": "5941925c5f13b71bb98a1b9f109c359844b8ac531ad5b9ad0ce072333f6237b3",
  "effectiveDate": "2026-09-28",
  "status": "engineering_provisional",
  "sourceRefs": [
    {
      "title": "Regulation (EU) 2024/2847: scope and classification",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847"
    },
    {
      "title": "Implementing Regulation (EU) 2025/2392: category technical descriptions",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32025R2392"
    }
  ],
  "questions": [
    {
      "key": "scope",
      "prompt": "Have you determined that this product falls within CRA scope after reviewing Article 2 and its exclusions?",
      "sourceRefs": ["https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847"]
    },
    {
      "key": "criticalCoreFunction",
      "prompt": "Does the product's core functionality match a critical product category in Annex IV? Review the official categories and technical descriptions before answering.",
      "sourceRefs": [
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847",
        "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32025R2392"
      ]
    },
    {
      "key": "classIICoreFunction",
      "prompt": "Does the product's core functionality match an important Class II category in Annex III? Review the official categories and technical descriptions before answering.",
      "sourceRefs": [
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847",
        "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32025R2392"
      ]
    },
    {
      "key": "classICoreFunction",
      "prompt": "Does the product's core functionality match an important Class I category in Annex III? Review the official categories and technical descriptions before answering.",
      "sourceRefs": [
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847",
        "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32025R2392"
      ]
    }
  ]
}$policy$::jsonb $fn$;

create function public.m2_classification_result(p_answers jsonb) returns text
language plpgsql immutable set search_path=public,pg_temp as $$
declare
  v_scope text := p_answers->>'scope';
  v_critical text := p_answers->>'criticalCoreFunction';
  v_ii text := p_answers->>'classIICoreFunction';
  v_i text := p_answers->>'classICoreFunction';
begin
  if p_answers is null or jsonb_typeof(p_answers)<>'object'
    or (select count(*) from jsonb_object_keys(p_answers))<>4
    or not p_answers ?& array['scope','criticalCoreFunction','classIICoreFunction','classICoreFunction']
    or v_scope is null or v_scope not in ('in_scope','out_of_scope','undetermined') then return null; end if;
  if v_scope<>'in_scope' then
    if p_answers->'criticalCoreFunction'<>'null'::jsonb or p_answers->'classIICoreFunction'<>'null'::jsonb
      or p_answers->'classICoreFunction'<>'null'::jsonb then return null; end if;
    return v_scope;
  end if;
  if v_critical is null or v_critical not in ('yes','no','undetermined') then return null; end if;
  if v_critical<>'no' then
    if p_answers->'classIICoreFunction'<>'null'::jsonb or p_answers->'classICoreFunction'<>'null'::jsonb then return null; end if;
    return case when v_critical='yes' then 'critical' else 'undetermined' end;
  end if;
  if v_ii is null or v_ii not in ('yes','no','undetermined') then return null; end if;
  if v_ii<>'no' then
    if p_answers->'classICoreFunction'<>'null'::jsonb then return null; end if;
    return case when v_ii='yes' then 'important_class_ii' else 'undetermined' end;
  end if;
  if v_i is null or v_i not in ('yes','no','undetermined') then return null; end if;
  return case v_i when 'yes' then 'important_class_i' when 'no' then 'default' else 'undetermined' end;
end $$;

create function public.m2_classification_actor_can(p_organization_id uuid,p_actor_user_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
with membership as (
  select m.role from public.organization_members m
  join public.users u on u.id=m.user_id and u.is_active
  join public.organizations o on o.id=m.organization_id and o.is_active
  where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
), custom_grant as (
  select bool_or((r.permissions->>p_permission)::boolean) granted
  from membership m join public.user_role_assignments a
    on a.organization_id=p_organization_id and a.user_id=p_actor_user_id
  join public.custom_roles r on r.organization_id=p_organization_id and r.id=a.role_id
  where r.is_active and not r.is_deleted and jsonb_typeof(r.permissions->p_permission)='boolean'
    and (r.permissions->>p_permission)::boolean
)
select case when p_permission not in ('can_view_products','can_edit_products') then false else coalesce(
  (select (o.permissions->>p_permission)::boolean from membership m
    join public.base_role_permission_overrides o on o.organization_id=p_organization_id and o.base_role=m.role
    where jsonb_typeof(o.permissions->p_permission)='boolean' limit 1),
  (select (case when p_permission='can_view_products' then true else m.role in ('owner','admin','member') end)
    or coalesce(c.granted,false) from membership m cross join custom_grant c),false) end
$$;

create table public.product_classification_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  revision integer not null check(revision>0),
  product_version integer not null check(product_version>=0),
  classification text not null check(classification in ('default','important_class_i','important_class_ii','critical','out_of_scope','undetermined')),
  answers jsonb not null,
  rationale text not null check(char_length(btrim(rationale)) between 1 and 4000),
  policy_snapshot jsonb not null,
  policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  supersedes_id uuid,
  idempotency_key uuid not null,
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  unique(organization_id,product_id,id),
  unique(organization_id,product_id,revision),
  unique(organization_id,created_by,idempotency_key),
  foreign key(organization_id,product_id) references public.products(organization_id,id) on delete cascade,
  foreign key(organization_id,product_id,supersedes_id) references public.product_classification_runs(organization_id,product_id,id) on delete cascade,
  check(public.m2_classification_result(answers) is not null and classification=public.m2_classification_result(answers)),
  check(policy_snapshot=public.m2_classification_policy() and policy_hash=policy_snapshot->>'hash')
);
create index product_classification_runs_history_idx on public.product_classification_runs(organization_id,product_id,revision desc);
alter table public.product_classification_runs enable row level security;
revoke all on public.product_classification_runs from public,anon,authenticated,service_role;
grant select on public.product_classification_runs to service_role;

create function public.m2_classification_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  -- Reuse authorized M1 organization purge; a product delete cannot erase history.
  if tg_op='DELETE' and pg_trigger_depth()>1
    and not exists(select 1 from public.organizations o where o.id=old.organization_id) then return old; end if;
  raise exception 'Product classification history is immutable' using errcode='55000';
end $$;
create trigger product_classification_runs_immutable before update or delete on public.product_classification_runs
for each row execute function public.m2_classification_immutable();

create function public.m2_classification_run_json(p_run public.product_classification_runs) returns jsonb
language sql stable set search_path=public,pg_temp as $$
select jsonb_build_object('id',p_run.id,'productId',p_run.product_id,'revision',p_run.revision,
'productVersion',p_run.product_version,'classification',p_run.classification,'answers',p_run.answers,
'rationale',p_run.rationale,'policySnapshot',p_run.policy_snapshot,'policyHash',p_run.policy_hash,
'createdBy',p_run.created_by,'createdAt',public.m2_utc_z(p_run.created_at),'supersedesId',p_run.supersedes_id)
$$;

create function public.save_product_classification_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,
  p_expected_product_version integer,p_expected_revision integer,
  p_policy_snapshot jsonb,p_policy_hash text,p_answers jsonb,p_rationale text,p_idempotency_key uuid
) returns table(outcome text,run jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_product public.products%rowtype;
  v_previous public.product_classification_runs%rowtype;
  v_replay public.product_classification_runs%rowtype;
  v_new public.product_classification_runs%rowtype;
  v_digest text;
  v_classification text;
begin
  -- Same lifecycle row lock as existing M1 command coordination.
  perform 1 from public.organization_lifecycles l where l.organization_id=p_organization_id and l.status='active' for share;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  perform 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=p_actor_user_id for share;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if not public.m2_classification_actor_can(p_organization_id,p_actor_user_id,'can_edit_products') then
    return query select 'forbidden'::text,null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_product_version is null or p_expected_product_version<0
    or p_expected_revision is null or p_expected_revision<0 or p_rationale is null
    or char_length(btrim(p_rationale)) not between 1 and 4000
    or p_policy_snapshot is distinct from public.m2_classification_policy()
    or p_policy_hash is distinct from public.m2_classification_policy()->>'hash' then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  v_classification:=public.m2_classification_result(p_answers);
  if v_classification is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('productId',p_product_id,'productVersion',p_expected_product_version,
    'revision',p_expected_revision,'policy',p_policy_snapshot,'hash',p_policy_hash,'answers',p_answers,'rationale',btrim(p_rationale))::text,'sha256'),'hex');
  select * into v_replay from public.product_classification_runs where organization_id=p_organization_id
    and created_by=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_replay.request_digest=v_digest then return query select 'replayed'::text,public.m2_classification_run_json(v_replay);
    else return query select 'idempotency_mismatch'::text,null::jsonb; end if;
    return;
  end if;
  if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
  select * into v_previous from public.product_classification_runs where organization_id=p_organization_id and product_id=p_product_id order by revision desc limit 1;
  if v_product.version<>p_expected_product_version or coalesce(v_previous.revision,0)<>p_expected_revision then
    return query select 'conflict'::text,null::jsonb; return; end if;
  insert into public.product_classification_runs(organization_id,product_id,revision,product_version,classification,answers,rationale,
    policy_snapshot,policy_hash,created_by,supersedes_id,idempotency_key,request_digest)
  values(p_organization_id,p_product_id,p_expected_revision+1,p_expected_product_version,v_classification,p_answers,btrim(p_rationale),
    p_policy_snapshot,p_policy_hash,p_actor_user_id,v_previous.id,p_idempotency_key,v_digest) returning * into v_new;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product.classification_saved','product',p_product_id::text,
    jsonb_build_object('classificationRunId',v_new.id,'revision',v_new.revision,'productVersion',v_new.product_version,
      'classification',v_new.classification,'policyHash',v_new.policy_hash,'supersedesId',v_new.supersedes_id));
  return query select 'saved'::text,public.m2_classification_run_json(v_new);
end $$;

revoke all on function public.m2_classification_policy(),public.m2_classification_result(jsonb),
public.m2_classification_actor_can(uuid,uuid,text),public.m2_classification_immutable(),
public.m2_classification_run_json(public.product_classification_runs),
public.save_product_classification_atomic(uuid,uuid,uuid,integer,integer,jsonb,text,jsonb,text,uuid)
from public,anon,authenticated;
grant execute on function public.save_product_classification_atomic(uuid,uuid,uuid,integer,integer,jsonb,text,jsonb,text,uuid) to service_role;

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
values('product_registry','product_classification_runs','organization_id','id',16);
do $$
declare v_definition text; v_new_lock text := 'public.product_classification_runs';
begin
  select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure) into v_definition;
  if position(chr(10)||'  in share mode' in v_definition)=0 then raise exception 'M2 classification export lock anchor missing'; end if;
  execute replace(v_definition,chr(10)||'  in share mode',', '||v_new_lock||chr(10)||'  in share mode');
end $$;

-- One bounded latest projection rather than 100 per-product queries or an unbounded history scan.
create function public.get_product_classifications_latest(
  p_organization_id uuid,p_actor_user_id uuid,p_product_ids uuid[]
) returns table(outcome text,classifications jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m2_classification_actor_can(p_organization_id,p_actor_user_id,'can_view_products') then
    return query select 'forbidden'::text,null::jsonb; return; end if;
  if p_product_ids is null or cardinality(p_product_ids) not between 1 and 100
    or array_ndims(p_product_ids)<>1 or array_position(p_product_ids,null) is not null
    or cardinality(p_product_ids)<>(select count(distinct id) from unnest(p_product_ids) id) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  if (select count(*) from public.products p where p.organization_id=p_organization_id and p.id=any(p_product_ids))<>cardinality(p_product_ids) then
    return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,jsonb_agg(jsonb_build_object('productId',requested.id,'latest',
    case when latest.id is null then null else jsonb_build_object('classification',latest.classification,
      'revision',latest.revision,'productVersion',latest.product_version,'policyStatus',latest.policy_snapshot->>'status',
      'createdAt',public.m2_utc_z(latest.created_at)) end) order by requested.ordinality)
  from unnest(p_product_ids) with ordinality requested(id,ordinality)
  left join lateral(select r.* from public.product_classification_runs r
    where r.organization_id=p_organization_id and r.product_id=requested.id order by r.revision desc limit 1) latest on true;
end $$;
revoke all on function public.get_product_classifications_latest(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_product_classifications_latest(uuid,uuid,uuid[]) to service_role;
