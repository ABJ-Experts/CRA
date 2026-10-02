
-- CRA-M5-01: tenant-scoped read-only vulnerability triage and organization
-- shared saved views. M4 remains the source of matching, enrichment,
-- reachability, and human-assessment facts; this migration deliberately does
-- not introduce an assignment or assessment workflow.

create table public.vulnerability_triage_saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  sort_key text not null default 'lastEvaluatedAt'
    check (sort_key in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss')),
  sort_order text not null default 'desc' check (sort_order in ('asc', 'desc')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id)
);

create unique index vulnerability_triage_saved_views_org_name_idx
  on public.vulnerability_triage_saved_views(organization_id, lower(name));

create table public.vulnerability_triage_saved_view_defaults (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  saved_view_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id),
  foreign key (organization_id, saved_view_id)
    references public.vulnerability_triage_saved_views(organization_id, id)
    on delete set null (saved_view_id)
);

-- Persist a request digest with its result so explicit client retries are safe
-- without replaying a mutation in the web transport.
create table public.vulnerability_triage_saved_view_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('create', 'update', 'delete', 'set_default')),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, actor_user_id, idempotency_key)
);

create index vulnerability_triage_saved_view_commands_created_idx
  on public.vulnerability_triage_saved_view_commands(organization_id, created_at desc, id);

alter table public.vulnerability_triage_saved_views enable row level security;
alter table public.vulnerability_triage_saved_view_defaults enable row level security;
alter table public.vulnerability_triage_saved_view_commands enable row level security;
create trigger set_vulnerability_triage_saved_views_updated_at
  before update on public.vulnerability_triage_saved_views
  for each row execute function public.set_updated_at();
create trigger set_vulnerability_triage_saved_view_defaults_updated_at
  before update on public.vulnerability_triage_saved_view_defaults
  for each row execute function public.set_updated_at();
grant all on table public.vulnerability_triage_saved_views,
  public.vulnerability_triage_saved_view_defaults,
  public.vulnerability_triage_saved_view_commands to service_role;
revoke all on table public.vulnerability_triage_saved_views,
  public.vulnerability_triage_saved_view_defaults,
  public.vulnerability_triage_saved_view_commands from public, anon, authenticated;

-- The queue's main read path is active findings by tenant and recency. The
-- existing release/status/confidence index remains useful for release-only
-- filtering; this covers the default cursor and age filters across products.
create index vulnerability_findings_triage_active_cursor_idx
  on public.vulnerability_findings(organization_id, last_evaluated_at desc, id desc)
  where status = 'active';
create index vulnerability_findings_triage_assessed_idx
  on public.vulnerability_findings(organization_id, human_assessed_by, last_evaluated_at desc, id desc)
  where status = 'active' and human_assessed_by is not null;
create index vulnerability_reachability_results_triage_current_idx
  on public.vulnerability_reachability_results(organization_id, finding_id, executed_at desc, id desc)
  where freshness = 'current';

create or replace function public.m5_triage_active_member(
  p_organization_id uuid,
  p_actor_user_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_organization_id is not null
    and p_actor_user_id is not null
    and public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
$$;

create or replace function public.m5_triage_saved_view_json(
  p_organization_id uuid,
  p_saved_view_id uuid
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', views.id,
    'name', views.name,
    'filters', views.filters,
    'sort', views.sort_key,
    'order', views.sort_order,
    'version', views.version,
    'createdByUserId', views.created_by,
    'createdAt', views.created_at,
    'updatedAt', views.updated_at
  )
  from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id
$$;

create or replace function public.m5_triage_command_result(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_operation text,
  p_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_command public.vulnerability_triage_saved_view_commands%rowtype;
begin
  select * into v_command
  from public.vulnerability_triage_saved_view_commands commands
  where commands.organization_id = p_organization_id
    and commands.actor_user_id = p_actor_user_id
    and commands.idempotency_key = p_idempotency_key
  for update;
  if not found then return; end if;
  if v_command.operation <> p_operation or v_command.request_digest <> p_digest then
    return query select 'idempotency_conflict'::text, null::jsonb;
  else
    return query select 'idempotent'::text, v_command.result;
  end if;
end;
$$;

create or replace function public.list_finding_saved_views(
  p_organization_id uuid,
  p_actor_user_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'found'::text, jsonb_build_object(
    'views', coalesce((
      select jsonb_agg(public.m5_triage_saved_view_json(p_organization_id, views.id)
        order by lower(views.name), views.id)
      from public.vulnerability_triage_saved_views views
      where views.organization_id = p_organization_id
    ), '[]'::jsonb),
    'defaultViewId', (
      select defaults.saved_view_id
      from public.vulnerability_triage_saved_view_defaults defaults
      where defaults.organization_id = p_organization_id and defaults.user_id = p_actor_user_id
    )
  );
end;
$$;

create or replace function public.create_finding_saved_view_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_filters jsonb,
  p_sort text,
  p_order text,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_digest text;
  v_existing record;
  v_view public.vulnerability_triage_saved_views%rowtype;
  v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_idempotency_key is null
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or jsonb_typeof(p_filters) <> 'object'
     or p_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss')
     or p_order not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('name', btrim(p_name), 'filters', p_filters,
    'sort', p_sort, 'order', p_order)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'create', v_digest
  );
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  begin
    insert into public.vulnerability_triage_saved_views(
      organization_id, name, filters, sort_key, sort_order, created_by, updated_by
    ) values (
      p_organization_id, btrim(p_name), p_filters, p_sort, p_order, p_actor_user_id, p_actor_user_id
    ) returning * into v_view;
  exception when unique_violation then
    return query select 'name_conflict'::text, null::jsonb;
    return;
  end;
  v_result := jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
    'defaultViewId', (select saved_view_id from public.vulnerability_triage_saved_view_defaults
      where organization_id = p_organization_id and user_id = p_actor_user_id));
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'create', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_created',
    'vulnerability_triage_saved_view', v_view.id::text,
    jsonb_build_object('after', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
      'correlationId', p_correlation_id, 'idempotencyKey', p_idempotency_key));
  return query select 'created'::text, v_result;
end;
$$;

create or replace function public.update_finding_saved_view_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_saved_view_id uuid,
  p_expected_version integer,
  p_name text,
  p_filters jsonb,
  p_sort text,
  p_order text,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_digest text;
  v_existing record;
  v_view public.vulnerability_triage_saved_views%rowtype;
  v_before jsonb;
  v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_saved_view_id is null or p_idempotency_key is null or p_expected_version is null or p_expected_version < 1
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or jsonb_typeof(p_filters) <> 'object'
     or p_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss')
     or p_order not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('id', p_saved_view_id, 'version', p_expected_version,
    'name', btrim(p_name), 'filters', p_filters, 'sort', p_sort, 'order', p_order)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'update', v_digest
  );
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_view from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_view.version <> p_expected_version then
    return query select 'version_conflict'::text,
      jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id));
    return;
  end if;
  v_before := public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id);
  begin
    update public.vulnerability_triage_saved_views views
    set name = btrim(p_name), filters = p_filters, sort_key = p_sort, sort_order = p_order,
      version = views.version + 1,
      updated_by = p_actor_user_id, updated_at = clock_timestamp()
    where views.organization_id = p_organization_id and views.id = p_saved_view_id
    returning * into v_view;
  exception when unique_violation then
    return query select 'name_conflict'::text, null::jsonb;
    return;
  end;
  v_result := jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
    'defaultViewId', (select saved_view_id from public.vulnerability_triage_saved_view_defaults
      where organization_id = p_organization_id and user_id = p_actor_user_id));
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'update', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_updated',
    'vulnerability_triage_saved_view', v_view.id::text,
    jsonb_build_object('before', v_before, 'after', public.m5_triage_saved_view_json(p_organization_id, v_view.id),
      'correlationId', p_correlation_id, 'idempotencyKey', p_idempotency_key));
  return query select 'updated'::text, v_result;
end;
$$;

create or replace function public.delete_finding_saved_view_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_saved_view_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_digest text;
  v_existing record;
  v_view public.vulnerability_triage_saved_views%rowtype;
  v_before jsonb;
  v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_saved_view_id is null or p_idempotency_key is null or p_expected_version is null or p_expected_version < 1 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('id', p_saved_view_id, 'version', p_expected_version)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'delete', v_digest
  );
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  select * into v_view from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_view.version <> p_expected_version then
    return query select 'version_conflict'::text,
      jsonb_build_object('view', public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id),
        'defaultViewId', (select saved_view_id from public.vulnerability_triage_saved_view_defaults
          where organization_id = p_organization_id and user_id = p_actor_user_id));
    return;
  end if;
  v_before := public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id);
  delete from public.vulnerability_triage_saved_views views
  where views.organization_id = p_organization_id and views.id = p_saved_view_id;
  v_result := jsonb_build_object('view', null, 'defaultViewId',
    (select saved_view_id from public.vulnerability_triage_saved_view_defaults
      where organization_id = p_organization_id and user_id = p_actor_user_id));
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'delete', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_deleted',
    'vulnerability_triage_saved_view', p_saved_view_id::text,
    jsonb_build_object('before', v_before, 'correlationId', p_correlation_id,
      'idempotencyKey', p_idempotency_key));
  return query select 'deleted'::text, v_result;
end;
$$;

create or replace function public.set_finding_saved_view_default_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_saved_view_id uuid,
  p_idempotency_key uuid,
  p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_digest text;
  v_existing record;
  v_result jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or p_idempotency_key is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object('savedViewId', p_saved_view_id)::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.m5_triage_command_result(
    p_organization_id, p_actor_user_id, p_idempotency_key, 'set_default', v_digest
  );
  if found then return query select v_existing.outcome, v_existing.result; return; end if;
  if p_saved_view_id is not null and not exists (
    select 1 from public.vulnerability_triage_saved_views views
    where views.organization_id = p_organization_id and views.id = p_saved_view_id
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  insert into public.vulnerability_triage_saved_view_defaults(
    organization_id, user_id, saved_view_id, updated_at
  ) values (p_organization_id, p_actor_user_id, p_saved_view_id, clock_timestamp())
  on conflict (organization_id, user_id) do update
    set saved_view_id = excluded.saved_view_id, updated_at = excluded.updated_at;
  v_result := jsonb_build_object('view', case when p_saved_view_id is null then null
      else public.m5_triage_saved_view_json(p_organization_id, p_saved_view_id) end,
    'defaultViewId', p_saved_view_id);
  insert into public.vulnerability_triage_saved_view_commands(
    organization_id, actor_user_id, idempotency_key, operation, request_digest, result
  ) values (p_organization_id, p_actor_user_id, p_idempotency_key, 'set_default', v_digest, v_result);
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.triage_saved_view_default_set',
    'vulnerability_triage_saved_view_default', p_actor_user_id::text,
    jsonb_build_object('savedViewId', p_saved_view_id, 'correlationId', p_correlation_id,
      'idempotencyKey', p_idempotency_key));
  return query select 'updated'::text, v_result;
end;
$$;

create or replace function public.list_finding_triage_queue(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50,
  p_cursor text default null,
  p_sort text default null,
  p_order text default null
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_cursor jsonb := '{}'::jsonb;
  v_sort text;
  v_direction text;
  v_cursor_value text;
  v_cursor_id uuid;
  v_rows jsonb;
  v_invalid_filters jsonb := '[]'::jsonb;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id)
     or jsonb_typeof(p_filters) <> 'object' or p_limit not between 1 and 100
     or (p_cursor is not null and char_length(p_cursor) > 1024) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_sort := coalesce(p_sort, p_filters ->> 'sort', 'lastEvaluatedAt');
  v_direction := coalesce(p_order, p_filters ->> 'order', p_filters ->> 'direction', 'desc');
  if v_sort not in ('lastEvaluatedAt', 'firstDetectedAt', 'severity', 'epss')
     or v_direction not in ('asc', 'desc') then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(
        translate(p_cursor, '-_', '+/') || repeat('=', (4 - length(p_cursor) % 4) % 4), 'base64'
      ), 'utf8')::jsonb;
      v_cursor_value := v_cursor ->> 'value';
      v_cursor_id := (v_cursor ->> 'id')::uuid;
      if v_cursor ->> 'sort' <> v_sort or v_cursor ->> 'direction' <> v_direction
         or v_cursor_value is null then raise exception 'invalid cursor'; end if;
    exception when others then
      return query select 'invalid_cursor'::text, null::jsonb;
      return;
    end;
  end if;
  -- Referenced IDs are intentionally never relaxed: a stale, deleted, or
  -- cross-tenant ID yields an empty page with a safe explanation.
  if jsonb_typeof(p_filters -> 'productIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'productIds') item
    where not exists (select 1 from public.products products
      where products.organization_id = p_organization_id and products.id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'productIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected product is unavailable.'));
  end if;
  if jsonb_typeof(p_filters -> 'releaseIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'releaseIds') item
    where not exists (select 1 from public.product_releases releases
      where releases.organization_id = p_organization_id and releases.id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'releaseIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected release is unavailable.'));
  end if;
  if jsonb_typeof(p_filters -> 'assessedByUserIds') = 'array' and exists (
    select 1 from jsonb_array_elements_text(p_filters -> 'assessedByUserIds') item
    where not exists (select 1 from public.organization_members members
      join public.users users on users.id = members.user_id and users.is_active
      where members.organization_id = p_organization_id and members.user_id = item::uuid)
  ) then v_invalid_filters := v_invalid_filters || jsonb_build_array(jsonb_build_object(
    'field', 'assessedByUserIds', 'referenceId', null, 'code', 'unavailable',
    'message', 'A selected assessor is unavailable.'));
  end if;
  if jsonb_array_length(v_invalid_filters) > 0 then
    return query select 'found'::text, jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null,
      'filterIssues', v_invalid_filters);
    return;
  end if;
  with base as (
    select findings.*, releases.label as release_name, products.id as product_id, products.name as product_name,
      occurrences.document_id, occurrences.component_id, occurrences.canonical_purl,
      occurrences.canonical_cpe, occurrences.component_version,
      public.m4_03_intelligence_with_provenance_json(findings.vulnerability_id, findings.last_evaluated_at) intelligence,
      reachability.result as reachability
    from public.vulnerability_findings findings
    join public.product_releases releases on releases.organization_id = findings.organization_id and releases.id = findings.release_id
    join public.products products on products.organization_id = releases.organization_id and products.id = releases.product_id
    left join lateral (
      select occurrences.* from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      where links.organization_id = findings.organization_id and links.finding_id = findings.id and links.state = 'active'
      order by occurrences.id limit 1
    ) occurrences on true
    left join lateral (
      select public.m4_07_reachability_result_json(results.id) result
      from public.vulnerability_reachability_results results
      where results.organization_id = findings.organization_id and results.finding_id = findings.id and results.freshness = 'current'
      order by results.executed_at desc, results.id desc limit 1
    ) reachability on true
    where findings.organization_id = p_organization_id
      and (p_filters -> 'findingStates' is null or findings.status::text = any(
        array(select jsonb_array_elements_text(p_filters -> 'findingStates'))
      ))
  ), filtered as (
    select base.*,
      coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) as severity_score,
      (intelligence #>> '{epss,value}')::numeric as epss_score,
      case when v_sort = 'lastEvaluatedAt' then extract(epoch from last_evaluated_at)::text
        when v_sort = 'firstDetectedAt' then extract(epoch from first_detected_at)::text
        when v_sort = 'severity' then coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1)::text
        else coalesce((intelligence #>> '{epss,value}')::numeric, -1)::text end as sort_value
    from base
    where (p_filters -> 'productIds' is null or product_id = any(array(select jsonb_array_elements_text(p_filters -> 'productIds')::uuid)))
      and (p_filters -> 'releaseIds' is null or release_id = any(array(select jsonb_array_elements_text(p_filters -> 'releaseIds')::uuid)))
      and (p_filters -> 'assessmentStates' is null or
        case when human_verdict is null then 'unassessed' else human_verdict end = any(array(select jsonb_array_elements_text(p_filters -> 'assessmentStates'))))
      and (p_filters -> 'reevaluationStates' is null or reevaluation_state = any(array(select jsonb_array_elements_text(p_filters -> 'reevaluationStates'))))
      and (p_filters -> 'assessedByUserIds' is null or human_assessed_by = any(array(select jsonb_array_elements_text(p_filters -> 'assessedByUserIds')::uuid)))
      and (p_filters ->> 'ageDaysMin' is null or first_detected_at <= clock_timestamp() - make_interval(days => (p_filters ->> 'ageDaysMin')::integer))
      and (p_filters ->> 'ageDaysMax' is null or first_detected_at >= clock_timestamp() - make_interval(days => (p_filters ->> 'ageDaysMax')::integer))
      and (p_filters -> 'severities' is null or case when coalesce((intelligence #>> '{cvss,preferred,baseScore}')::numeric, -1) < 0 then 'unknown'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 9 then 'critical'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 7 then 'high'
        when (intelligence #>> '{cvss,preferred,baseScore}')::numeric >= 4 then 'medium' else 'low' end
        = any(array(select jsonb_array_elements_text(p_filters -> 'severities'))))
      and (p_filters ->> 'epssMin' is null or coalesce((intelligence #>> '{epss,value}')::numeric, -1) >= (p_filters ->> 'epssMin')::numeric)
      and (p_filters ->> 'epssMax' is null or coalesce((intelligence #>> '{epss,value}')::numeric, -1) <= (p_filters ->> 'epssMax')::numeric)
      and (coalesce(p_filters ->> 'epssState', 'known') <> 'unknown' or (intelligence #>> '{epss,value}') is null)
      and (p_filters -> 'kevStatuses' is null or intelligence #>> '{kev,status}' = any(array(select jsonb_array_elements_text(p_filters -> 'kevStatuses'))))
      and (p_filters -> 'reachability' is null or coalesce(reachability ->> 'verdict', 'unknown') = any(array(select jsonb_array_elements_text(p_filters -> 'reachability'))))
  ), page as (
    select * from filtered
    where p_cursor is null or case when v_direction = 'desc' then
      (sort_value::numeric, id) < (v_cursor_value::numeric, v_cursor_id)
    else (sort_value::numeric, id) > (v_cursor_value::numeric, v_cursor_id) end
    order by case when v_direction = 'asc' then sort_value::numeric end asc nulls last,
      case when v_direction = 'desc' then sort_value::numeric end desc nulls last,
      case when v_direction = 'asc' then id end asc,
      case when v_direction = 'desc' then id end desc
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'finding', jsonb_build_object(
      'id', id, 'documentId', document_id, 'releaseId', release_id, 'componentId', component_id,
      'canonicalPurl', canonical_purl, 'canonicalCpe', canonical_cpe,
      'evaluatedVersion', coalesce(component_version, evaluated_component_value),
      'advisoryId', canonical_advisory_id,
      'advisoryAliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias))
        from public.vulnerability_aliases aliases where aliases.vulnerability_id = page.vulnerability_id), '[]'::jsonb),
      'matchMethod', match_method, 'outcome', 'affected', 'sourceFeed', source_feed_key,
      'sourceRecordId', source_record_id, 'sourceRecordVersionId', source_record_version_id,
      'affectedRangeId', affected_range_id, 'affectedRangeEvents', event_sequence,
      'affectedVersions', coalesce(affected_range -> 'versions', '[]'::jsonb),
      'comparator', comparator_name, 'comparatorVersion', comparator_version,
      'confidence', jsonb_build_object('score', confidence,
        'level', case when confidence >= .9 then 'high' when confidence >= .6 then 'medium' else 'low' end,
        'explanation', confidence_explanation, 'tableVersion', confidence_table_version),
      'cpeSpecificity', case when match_method = 'cpe_nvd' then coalesce(affected_range ->> 'm4CpeSpecificity', 'broad_family') else null end,
      'cpeConfigurationEvidence', case when match_method = 'cpe_nvd' then coalesce(affected_range -> 'm4CpeConfigurationEvidence', '{}'::jsonb) else null end,
      'reEvaluationState', reevaluation_state,
      'humanAssessment', case when human_verdict is null then null else jsonb_build_object(
        'verdict', human_verdict, 'rationale', human_rationale,
        'assessedByUserId', human_assessed_by, 'assessedAt', human_assessed_at) end,
      'firstDetectedAt', first_detected_at, 'lastEvaluatedAt', last_evaluated_at,
      'createdAt', created_at, 'updatedAt', updated_at
    ),
    'product', jsonb_build_object('id', product_id, 'name', product_name),
    'release', jsonb_build_object('id', release_id, 'name', release_name),
    'severity', case when severity_score < 0 then 'unknown' when severity_score >= 9 then 'critical'
      when severity_score >= 7 then 'high' when severity_score >= 4 then 'medium' else 'low' end,
    'epss', epss_score, 'kevStatus', coalesce(intelligence #>> '{kev,status}', 'unavailable'),
    'reachability', reachability ->> 'verdict',
    'assessmentState', case when human_verdict is null then 'unassessed' else human_verdict end,
    'sortValue', sort_value
  ) order by case when v_direction = 'asc' then sort_value::numeric end asc nulls last,
    case when v_direction = 'desc' then sort_value::numeric end desc nulls last,
    case when v_direction = 'asc' then id end asc, case when v_direction = 'desc' then id end desc), '[]'::jsonb)
  into v_rows from page;
  return query select 'found'::text, jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_item - 'sortValue' order by ordinal)
      from jsonb_array_elements(v_rows) with ordinality rows(row_item, ordinal)), '[]'::jsonb),
    'nextCursor', case when jsonb_array_length(v_rows) = p_limit then
      translate(encode(convert_to(jsonb_build_object('sort', v_sort, 'direction', v_direction,
        'value', v_rows -> (p_limit - 1) ->> 'sortValue', 'id', v_rows -> (p_limit - 1) -> 'finding' ->> 'id')::text, 'utf8'), 'base64'), '+/=', '-_')
      else null end,
    'filterIssues', '[]'::jsonb
  );
end;
$$;

create or replace function public.get_finding_triage_detail(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_finding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_document_id uuid;
begin
  if not public.m5_triage_active_member(p_organization_id, p_actor_user_id) or p_finding_id is null then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if not exists (
    select 1 from public.vulnerability_findings findings
    where findings.organization_id = p_organization_id and findings.id = p_finding_id and findings.status = 'active'
  ) then return query select 'not_found'::text, null::jsonb; return; end if;
  select occurrences.document_id into v_document_id
  from public.vulnerability_finding_component_occurrences links
  join public.vulnerability_component_occurrences occurrences
    on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
  where links.organization_id = p_organization_id and links.finding_id = p_finding_id and links.state = 'active'
  order by occurrences.id limit 1;
  return query select 'found'::text, jsonb_build_object(
    'finding', jsonb_build_object(
      'id', findings.id, 'releaseId', findings.release_id, 'productId', products.id,
      'productName', products.name, 'releaseName', releases.label,
      'componentIdentity', findings.component_identity, 'advisoryId', findings.canonical_advisory_id,
      'vulnerabilityId', findings.vulnerability_id, 'matchMethod', findings.match_method,
      'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
      'evaluatedComponentValue', findings.evaluated_component_value, 'affectedRange', findings.affected_range,
      'eventSequence', findings.event_sequence, 'confidence', findings.confidence,
      'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
      'lastEvaluatedAt', findings.last_evaluated_at, 'humanAssessment', case when findings.human_verdict is null then null else
        jsonb_build_object('verdict', findings.human_verdict, 'rationale', findings.human_rationale,
          'assessedByUserId', findings.human_assessed_by, 'assessedAt', findings.human_assessed_at) end,
      'reEvaluationState', findings.reevaluation_state,
      'intelligence', public.m4_03_intelligence_with_provenance_json(findings.vulnerability_id, findings.last_evaluated_at)
    ),
    'componentOccurrences', coalesce((select jsonb_agg(jsonb_build_object(
      'componentId', occurrences.component_id, 'documentId', occurrences.document_id,
      'purl', occurrences.canonical_purl, 'version', occurrences.component_version,
      'identity', occurrences.component_identity
    ) order by occurrences.id) from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences
        on occurrences.organization_id = links.organization_id and occurrences.id = links.occurrence_id
      where links.organization_id = p_organization_id and links.finding_id = findings.id and links.state = 'active'), '[]'::jsonb),
    'reachability', case when v_document_id is null then null else (
      select evidence.result from public.get_vulnerability_finding_reachability_evidence(
        p_organization_id, p_actor_user_id, v_document_id, findings.id, false
      ) evidence
    ) end,
    'advisoryReview', case when v_document_id is null then null else (
      select review.result from public.get_vulnerability_finding_advisory_review(
        p_organization_id, p_actor_user_id, v_document_id, findings.id
      ) review
    ) end,
    'history', coalesce((select history_row.result -> 'items' from public.list_vulnerability_finding_reevaluation_history(
      p_organization_id, p_actor_user_id, v_document_id, findings.id, 1, 100
    ) history_row), '[]'::jsonb),
    'relatedFindings', coalesce((select jsonb_agg(jsonb_build_object(
      'id', related.id, 'productId', related_products.id, 'productName', related_products.name,
      'releaseId', related.release_id, 'releaseName', related_releases.label,
      'componentIdentity', related.component_identity, 'advisoryId', related.canonical_advisory_id,
      'firstDetectedAt', related.first_detected_at
    ) order by related.last_evaluated_at desc, related.id desc)
      from public.vulnerability_findings related
      join public.product_releases related_releases on related_releases.organization_id = related.organization_id and related_releases.id = related.release_id
      join public.products related_products on related_products.organization_id = related_releases.organization_id and related_products.id = related_releases.product_id
      where related.organization_id = p_organization_id and related.status = 'active'
        and related.vulnerability_id = findings.vulnerability_id and related.id <> findings.id), '[]'::jsonb)
  ) from public.vulnerability_findings findings
  join public.product_releases releases on releases.organization_id = findings.organization_id and releases.id = findings.release_id
  join public.products products on products.organization_id = releases.organization_id and products.id = releases.product_id
  where findings.organization_id = p_organization_id and findings.id = p_finding_id;
end;
$$;

alter function public.m5_triage_active_member(uuid, uuid) owner to postgres;
alter function public.m5_triage_saved_view_json(uuid, uuid) owner to postgres;
alter function public.m5_triage_command_result(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.list_finding_saved_views(uuid, uuid) owner to postgres;
alter function public.create_finding_saved_view_atomic(uuid, uuid, text, jsonb, text, text, uuid, uuid) owner to postgres;
alter function public.update_finding_saved_view_atomic(uuid, uuid, uuid, integer, text, jsonb, text, text, uuid, uuid) owner to postgres;
alter function public.delete_finding_saved_view_atomic(uuid, uuid, uuid, integer, uuid, uuid) owner to postgres;
alter function public.set_finding_saved_view_default_atomic(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text) owner to postgres;
alter function public.get_finding_triage_detail(uuid, uuid, uuid) owner to postgres;
revoke all on function public.m5_triage_active_member(uuid, uuid),
  public.m5_triage_saved_view_json(uuid, uuid), public.m5_triage_command_result(uuid, uuid, uuid, text, text),
  public.list_finding_saved_views(uuid, uuid),
  public.create_finding_saved_view_atomic(uuid, uuid, text, jsonb, text, text, uuid, uuid),
  public.update_finding_saved_view_atomic(uuid, uuid, uuid, integer, text, jsonb, text, text, uuid, uuid),
  public.delete_finding_saved_view_atomic(uuid, uuid, uuid, integer, uuid, uuid),
  public.set_finding_saved_view_default_atomic(uuid, uuid, uuid, uuid, uuid),
  public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text),
  public.get_finding_triage_detail(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_finding_saved_views(uuid, uuid),
  public.create_finding_saved_view_atomic(uuid, uuid, text, jsonb, text, text, uuid, uuid),
  public.update_finding_saved_view_atomic(uuid, uuid, uuid, integer, text, jsonb, text, text, uuid, uuid),
  public.delete_finding_saved_view_atomic(uuid, uuid, uuid, integer, uuid, uuid),
  public.set_finding_saved_view_default_atomic(uuid, uuid, uuid, uuid, uuid),
  public.list_finding_triage_queue(uuid, uuid, jsonb, integer, text, text, text),
  public.get_finding_triage_detail(uuid, uuid, uuid)
  to service_role;
