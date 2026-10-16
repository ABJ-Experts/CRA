-- M11-03: signed outbound webhook endpoints and auditable delivery retries.
-- Secrets are endpoint-scoped AES-GCM envelopes. Payloads stay minimal and
-- source-linked; raw source bodies and receiver response bodies are never stored.

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  url text not null check (url ~ '^https://[^/?#:]+/?.*$' and char_length(url) <= 2048),
  event_types text[] not null check (
    cardinality(event_types) between 1 and 20
    and event_types <@ array['product.release.market_availability_changed','product.release.lifecycle_changed','product.release.placed_on_market_changed','product.relationship.graph_changed','vulnerability.assessment.submitted','vulnerability.assessment.approved','vulnerability.assessment.rejected','vulnerability.assessment.superseded','vulnerability.remediation_anchor.recorded','vulnerability.remediation_anchor.corrected','reporting.deadline.threshold_crossed','reporting.deadline.breached','reporting.filing.recorded','connector.sync_completed','connector.sync_failed']::text[]
  ),
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 100),
  enabled boolean not null default false,
  secret_ciphertext bytea check (octet_length(secret_ciphertext) between 1 and 80000),
  secret_key_id text check (secret_key_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  secret_nonce bytea check (octet_length(secret_nonce) = 12),
  secret_auth_tag bytea check (octet_length(secret_auth_tag) = 16),
  secret_revision integer not null default 0 check (secret_revision >= 0),
  secret_id uuid, signing_key_id uuid, previous_secret_id uuid, previous_signing_key_id uuid,
  authorization_actor_user_id uuid not null references public.users(id) on delete restrict,
  permission_version bigint not null check(permission_version>0),
  destination_revision integer not null default 1, scope_revision integer not null default 1,
  max_attempts integer not null default 6 check(max_attempts between 1 and 10),
  base_delay_seconds integer not null default 5 check(base_delay_seconds between 5 and 60),
  max_delay_seconds integer not null default 300 check(max_delay_seconds between base_delay_seconds and 300),
  previous_secret_ciphertext bytea,
  previous_secret_key_id text,
  previous_secret_nonce bytea,
  previous_secret_auth_tag bytea,
  previous_secret_revision integer,
  previous_secret_expires_at timestamptz,
  version integer not null default 1 check (version > 0),
  last_delivered_at timestamptz,
  last_failure_category text check (last_failure_category is null or last_failure_category ~ '^[a-z][a-z0-9_]{0,99}$'),
  disabled_at timestamptz,
  disabled_by uuid references public.users(id) on delete restrict,
  disabled_reason text check (disabled_reason is null or char_length(disabled_reason) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id) on delete restrict,
  check ((disabled_at is null) = (disabled_by is null) and (disabled_at is null) = (disabled_reason is null)),
  check (
    (previous_secret_ciphertext is null and previous_secret_key_id is null and previous_secret_nonce is null and previous_secret_auth_tag is null and previous_secret_revision is null and previous_secret_expires_at is null)
    or
    (previous_secret_ciphertext is not null and previous_secret_key_id ~ '^[A-Za-z0-9_.-]{1,80}$'
      and previous_secret_nonce is not null and octet_length(previous_secret_nonce) = 12
      and previous_secret_auth_tag is not null and octet_length(previous_secret_auth_tag) = 16
      and previous_secret_revision is not null and previous_secret_revision > 0
      and previous_secret_expires_at is not null)
  )
);
create unique index webhook_endpoints_org_name_key on public.webhook_endpoints(organization_id, lower(display_name));
alter table public.webhook_endpoints add constraint webhook_endpoints_org_id_key unique (organization_id, id);
create unique index webhook_endpoints_active_secret_identity_key on public.webhook_endpoints(secret_id) where secret_id is not null;
create unique index webhook_endpoints_previous_secret_identity_key on public.webhook_endpoints(previous_secret_id) where previous_secret_id is not null;
create index webhook_endpoints_org_enabled_idx on public.webhook_endpoints(organization_id, enabled, updated_at desc, id desc);
create index webhook_endpoints_event_idx on public.webhook_endpoints using gin(event_types);
create index webhook_endpoints_products_idx on public.webhook_endpoints using gin(product_ids);
alter table public.webhook_endpoints enable row level security;
revoke all on public.webhook_endpoints from public, anon, authenticated, service_role;
grant select, insert, update on public.webhook_endpoints to service_role;

create table public.webhook_endpoint_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  operation text not null check (operation in ('create','update','rotate_secret','disable','enable','revoke_secret','test','replay')),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  request_digest_key_id text not null check (request_digest_key_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  expected_version integer check (expected_version is null or expected_version >= 0),
  permission_version bigint not null check (permission_version > 0),
  state text not null check (state in ('completed','interrupted')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object' and octet_length(result::text) <= 20000),
  reason text check (reason is null or char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  unique (organization_id, actor_user_id, idempotency_key),
  foreign key (organization_id, endpoint_id) references public.webhook_endpoints(organization_id, id) on delete cascade
);
create index webhook_endpoint_commands_endpoint_idx on public.webhook_endpoint_commands(organization_id, endpoint_id, created_at desc, id desc);
alter table public.webhook_endpoint_commands enable row level security;
revoke all on public.webhook_endpoint_commands from public, anon, authenticated, service_role;
grant select on public.webhook_endpoint_commands to service_role;

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid not null,
  event_id text not null check (char_length(event_id) between 16 and 128),
  delivery_id text not null check (char_length(delivery_id) between 16 and 128),
  event_type text not null check (event_type in ('product.release.market_availability_changed','product.release.lifecycle_changed','product.release.placed_on_market_changed','product.relationship.graph_changed','vulnerability.assessment.submitted','vulnerability.assessment.approved','vulnerability.assessment.rejected','vulnerability.assessment.superseded','vulnerability.remediation_anchor.recorded','vulnerability.remediation_anchor.corrected','reporting.deadline.threshold_crossed','reporting.deadline.breached','reporting.filing.recorded','connector.sync_completed','connector.sync_failed','webhook.test')),
  resource_type text not null check (resource_type in ('product','release','finding','reporting_obligation','connector','sync_run')),
  resource_id uuid not null,
  product_ids uuid[] not null default '{}',
  source_kind text not null, source_id uuid not null,
  authorization_actor_user_id uuid not null references public.users(id) on delete restrict, permission_version bigint not null,
  endpoint_version integer not null, destination_revision integer not null, scope_revision integer not null,
  max_attempts integer not null, base_delay_seconds integer not null, max_delay_seconds integer not null,
  deadline_at timestamptz not null default clock_timestamp()+interval '24 hours', completed_at timestamptz,
  signing_secret_revision integer,
  payload_bytes text check(payload_bytes is null or octet_length(payload_bytes)<=8192),
  resource_url text not null check (resource_url ~ '^/[A-Za-z0-9/_?=&.-]*$' and char_length(resource_url)<=501),
  occurred_at timestamptz not null,
  endpoint_url text not null check (endpoint_url ~ '^https://[^/?#:]+/?.*$' and char_length(endpoint_url) <= 2048),
  status text not null default 'pending' check (status in ('pending','delivering','retrying','succeeded','failed','canceled')),
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 100),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  lease_generation integer not null default 0 check (lease_generation >= 0),
  last_http_status integer check (last_http_status is null or last_http_status between 100 and 599),
  last_failure_category text check (last_failure_category is null or last_failure_category in ('timeout','rate_limit','receiver_unavailable','receiver_rejected','egress_blocked','authorization','configuration','vault_unavailable','payload_unavailable','interrupted','scope_unknown','unknown')),
  last_failure_code text check (last_failure_code is null or last_failure_code ~ '^[a-z][a-z0-9_]{0,99}$'),
  parent_delivery_id uuid,
  replay_reason text check (replay_reason is null or char_length(replay_reason) between 1 and 500),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, delivery_id),
  unique (organization_id,id),
  foreign key (organization_id, endpoint_id) references public.webhook_endpoints(organization_id, id) on delete cascade,
  foreign key (organization_id, parent_delivery_id) references public.webhook_deliveries(organization_id, id) on delete no action deferrable initially deferred,
  check ((lease_owner is null) = (lease_expires_at is null))
);
create unique index webhook_deliveries_base_event_key on public.webhook_deliveries(organization_id,endpoint_id,event_id) where parent_delivery_id is null;
create unique index webhook_deliveries_active_event_key on public.webhook_deliveries(organization_id,endpoint_id,event_id) where status in ('pending','retrying','delivering');
create unique index webhook_deliveries_active_replay_key on public.webhook_deliveries(organization_id,parent_delivery_id) where parent_delivery_id is not null and status in ('pending','retrying','delivering');
create index webhook_deliveries_due_idx on public.webhook_deliveries(organization_id, next_attempt_at, created_at, id) where status in ('pending','retrying','delivering');
create index webhook_deliveries_endpoint_idx on public.webhook_deliveries(organization_id, endpoint_id, created_at desc, id desc);
create index webhook_deliveries_resource_idx on public.webhook_deliveries(organization_id, resource_type, resource_id);

alter table public.webhook_deliveries enable row level security;
revoke all on public.webhook_deliveries from public, anon, authenticated, service_role;
grant select, insert, update on public.webhook_deliveries to service_role;

create table public.webhook_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_row_id uuid not null,
  lease_generation integer not null check (lease_generation > 0),
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null check (char_length(btrim(worker_id)) between 1 and 100),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text check (outcome is null or outcome in ('succeeded','retrying','failed','interrupted','canceled')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 120000),
  failure_category text check (failure_category is null or failure_category in ('timeout','rate_limit','receiver_unavailable','receiver_rejected','egress_blocked','authorization','configuration','vault_unavailable','payload_unavailable','interrupted','scope_unknown','unknown')),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,99}$'),
  response_bytes integer check (response_bytes is null or response_bytes between 0 and 64000),
  unique (organization_id, delivery_row_id, lease_generation),
  foreign key (organization_id, delivery_row_id) references public.webhook_deliveries(organization_id, id) on delete cascade
);
create index webhook_delivery_attempts_delivery_idx on public.webhook_delivery_attempts(organization_id, delivery_row_id, started_at desc, id desc);
alter table public.webhook_delivery_attempts enable row level security;
revoke all on public.webhook_delivery_attempts from public, anon, authenticated, service_role;
grant select on public.webhook_delivery_attempts to service_role;

create function public.m1103_webhook_endpoint_json(p_endpoint public.webhook_endpoints)
returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'id',p_endpoint.id,'organizationId',p_endpoint.organization_id,'displayName',p_endpoint.display_name,
  'url',p_endpoint.url,'eventTypes',p_endpoint.event_types,'productIds',p_endpoint.product_ids,
  'enabled',p_endpoint.enabled,
  'status',case when p_endpoint.secret_ciphertext is null then 'secret_required' when not p_endpoint.enabled then 'disabled' when p_endpoint.last_failure_category is not null then 'degraded' else 'active' end,
  'hasSecret',p_endpoint.secret_ciphertext is not null,
  'signingKeyId',p_endpoint.signing_key_id,'previousSigningKeyId',p_endpoint.previous_signing_key_id,'previousKeyExpiresAt',public.m2_utc_z(p_endpoint.previous_secret_expires_at),
  'scopeRevision',p_endpoint.scope_revision,'destinationRevision',p_endpoint.destination_revision,
  'retryPolicy',jsonb_build_object('maxAttempts',p_endpoint.max_attempts,'baseDelaySeconds',p_endpoint.base_delay_seconds,'maxDelaySeconds',p_endpoint.max_delay_seconds),
  'secretRevision',p_endpoint.secret_revision,'version',p_endpoint.version,
  'lastDeliveredAt',public.m2_utc_z(p_endpoint.last_delivered_at),'lastFailureCategory',p_endpoint.last_failure_category,
  'createdAt',public.m2_utc_z(p_endpoint.created_at),'updatedAt',public.m2_utc_z(p_endpoint.updated_at))
$$;

create function public.m1103_webhook_delivery_json(p_delivery public.webhook_deliveries)
returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'id',p_delivery.id,'endpointId',p_delivery.endpoint_id,'eventId',p_delivery.event_id,'deliveryId',p_delivery.delivery_id,
  'eventType',p_delivery.event_type,'status',p_delivery.status,
  'resource',jsonb_build_object('type',p_delivery.resource_type,'id',p_delivery.resource_id,'url',p_delivery.resource_url),
  'occurredAt',public.m2_utc_z(p_delivery.occurred_at),'nextAttemptAt',case when p_delivery.status in ('pending','retrying','delivering') then public.m2_utc_z(p_delivery.next_attempt_at) else null end,
  'attemptCount',p_delivery.attempt_count,'lastHttpStatus',p_delivery.last_http_status,
  'lastFailureCategory',p_delivery.last_failure_category,'lastFailureCode',p_delivery.last_failure_code,
  'replayParentId',p_delivery.parent_delivery_id,'endpointVersion',p_delivery.endpoint_version,'scopeRevision',p_delivery.scope_revision,'destinationRevision',p_delivery.destination_revision,'completedAt',public.m2_utc_z(p_delivery.completed_at),'deadlineAt',public.m2_utc_z(p_delivery.deadline_at),
  'version',p_delivery.version,'createdAt',public.m2_utc_z(p_delivery.created_at),'updatedAt',public.m2_utc_z(p_delivery.updated_at))
$$;

create function public.m1103_webhook_attempt_json(p_attempt public.webhook_delivery_attempts)
returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'id',p_attempt.id,'deliveryRowId',p_attempt.delivery_row_id,'attemptNumber',p_attempt.attempt_number,'leaseGeneration',p_attempt.lease_generation,
  'startedAt',public.m2_utc_z(p_attempt.started_at),'finishedAt',public.m2_utc_z(p_attempt.finished_at),'outcome',coalesce(p_attempt.outcome,'running'),
  'httpStatus',p_attempt.http_status,'durationMs',p_attempt.duration_ms,
  'failureCategory',p_attempt.failure_category,'failureCode',p_attempt.failure_code,
  'responseBytes',p_attempt.response_bytes)
$$;

create function public.m1103_valid_webhook_url(p_url text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select p_url ~ '^https://[A-Za-z0-9.-]+(?:/[^[:space:]?#]*)?$' and char_length(p_url)<=2048
   and p_url !~ '[?#]' and position(chr(92) in p_url)=0
   and p_url !~* '%(0[0-9a-f]|1[0-9a-f]|7f)'
   and lower(split_part(split_part(p_url,'://',2),'/',1)) !~ '^([0-9.]+|(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+)){0,3})$'
   and lower(split_part(split_part(p_url,'://',2),'/',1)) !~ '^(localhost|metadata|metadata\.google\.internal)$'
   and p_url !~ '^https://(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)'
   and p_url !~ '^https://[^/]+:[0-9]+'
$$;

create function public.m1103_valid_webhook_event_types(p_event_types text[])
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(cardinality(p_event_types),0) between 1 and 20
   and p_event_types <@ array['product.release.market_availability_changed','product.release.lifecycle_changed','product.release.placed_on_market_changed','product.relationship.graph_changed','vulnerability.assessment.submitted','vulnerability.assessment.approved','vulnerability.assessment.rejected','vulnerability.assessment.superseded','vulnerability.remediation_anchor.recorded','vulnerability.remediation_anchor.corrected','reporting.deadline.threshold_crossed','reporting.deadline.breached','reporting.filing.recorded','connector.sync_completed','connector.sync_failed']::text[]
$$;

create function public.m1103_webhook_secret_from_payload(p_payload jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select case when p_payload->>'format' = 'aes-256-gcm-v1'
   and p_payload->>'keyId' ~ '^[A-Za-z0-9_.-]{1,80}$'
   and octet_length(decode(p_payload->>'ciphertext','base64')) between 1 and 80000
   and octet_length(decode(p_payload->>'nonce','base64')) = 12
   and octet_length(decode(p_payload->>'authTag','base64')) = 16
 then p_payload else null end
$$;

-- Arrays cannot escape their tenant; every write is serialized at organization scope.
create function public.m1103_distinct_array(p_values anyarray) returns boolean language sql immutable set search_path=public,pg_temp as $$
 select cardinality(p_values)=(select count(distinct v) from unnest(p_values) v) $$;
alter table public.webhook_endpoints add check(public.m1103_distinct_array(event_types) and public.m1103_distinct_array(product_ids));
alter table public.webhook_endpoints add check((secret_id is null and signing_key_id is null and secret_ciphertext is null and secret_key_id is null and secret_nonce is null and secret_auth_tag is null) or (secret_id=signing_key_id and secret_id is not null and secret_ciphertext is not null and secret_key_id is not null and secret_nonce is not null and secret_auth_tag is not null and secret_revision>0));
alter table public.webhook_endpoints add check((previous_secret_id is null and previous_signing_key_id is null and previous_secret_ciphertext is null) or (previous_secret_id=previous_signing_key_id and previous_secret_id is not null and previous_secret_ciphertext is not null));
create function public.m1103_webhook_source_scope(p_organization_id uuid,p_source_kind text,p_source_id uuid,p_event_type text)
returns table(outcome text,product_ids uuid[],resource jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_products uuid[]; v_type text; v_resource uuid; v_url text; v_finding uuid; v_event text; v_scope_unknown boolean:=false;
begin
 if p_source_kind='product' then
  select array[e.product_id],case when e.release_id is null then 'product' else 'release' end,coalesce(e.release_id,e.product_id),'/products/'||e.product_id::text,e.event_type
   into v_products,v_type,v_resource,v_url,v_event from public.product_regulatory_outbox_events e where e.organization_id=p_organization_id and e.id=p_source_id;
  if p_event_type is distinct from (case v_event when 'release.market_availability_changed' then 'product.release.market_availability_changed' when 'release.lifecycle_changed' then 'product.release.lifecycle_changed' when 'release.placed_on_market_changed' then 'product.release.placed_on_market_changed' when 'product_relationship.graph_changed' then 'product.relationship.graph_changed' when 'remediation_anchor.recorded' then 'vulnerability.remediation_anchor.recorded' when 'remediation_anchor.corrected' then 'vulnerability.remediation_anchor.corrected' end) then return query select 'scope_unknown'::text,'{}'::uuid[],null::jsonb;return;end if;
  if v_event='product_relationship.graph_changed' then
   -- Both ends are required. Malformed graph context is unknown, never guessed.
   with recursive seeds(id) as (
    select e.product_id from public.product_regulatory_outbox_events e where e.organization_id=p_organization_id and e.id=p_source_id
    union select r.source_product_id from public.product_relationships r join public.product_regulatory_outbox_events e on e.organization_id=r.organization_id where e.organization_id=p_organization_id and e.id=p_source_id and (r.id::text=e.payload->>'relationshipId' or r.id::text=e.payload->>'priorRelationshipId')
    union select r.target_product_id from public.product_relationships r join public.product_regulatory_outbox_events e on e.organization_id=r.organization_id where e.organization_id=p_organization_id and e.id=p_source_id and (r.id::text=e.payload->>'relationshipId' or r.id::text=e.payload->>'priorRelationshipId')
   ), nodes(id) as (select id from seeds union select case when r.source_product_id=n.id then r.target_product_id else r.source_product_id end from nodes n join public.product_relationships r on r.organization_id=p_organization_id and (r.source_product_id=n.id or r.target_product_id=n.id) where r.ended_at is null)
   select array(select id from nodes limit 101) into v_products;
   if cardinality(v_products)=0 or cardinality(v_products)>100 then v_scope_unknown:=true; end if;
  end if;
  if v_event like 'remediation_anchor.%' then
   select e.finding_id into v_finding from public.product_regulatory_outbox_events e where e.organization_id=p_organization_id and e.id=p_source_id;
   v_type:='finding';v_resource:=v_finding;v_url:='/findings?findingId='||v_finding::text;
  end if;
 elsif p_source_kind='assessment' then
  select a.finding_id into v_finding from public.vulnerability_finding_assessment_history_events e join public.vulnerability_finding_assessments a on a.organization_id=e.organization_id and a.id=e.assessment_id where e.organization_id=p_organization_id and e.id=p_source_id and p_event_type='vulnerability.assessment.'||e.event_type;
  v_type:='finding';v_resource:=v_finding;v_url:='/findings?findingId='||v_finding::text;
 elsif p_source_kind='reporting' then
  select o.source_finding_id,o.id into v_finding,v_resource from public.reporting_obligation_events e join public.reporting_obligations o on o.organization_id=e.organization_id and o.id=e.obligation_id where e.organization_id=p_organization_id and e.id=p_source_id and not o.is_rehearsal and not e.is_rehearsal and p_event_type=case e.event_kind when 'deadline_threshold_crossed' then 'reporting.deadline.threshold_crossed' when 'deadline_breached' then 'reporting.deadline.breached' when 'filing_recorded' then 'reporting.filing.recorded' end;
  v_type:='reporting_obligation';v_url:='/reporting?obligationId='||v_resource::text;
 elsif p_source_kind='sync' then
  select array(select distinct i.cra_product_id from public.sync_run_plan_items i where i.organization_id=r.organization_id and i.sync_run_id=r.id and i.cra_product_id is not null),r.id,'/connectors/'||r.connector_id::text into v_products,v_resource,v_url from public.sync_runs r where r.organization_id=p_organization_id and r.id=p_source_id and r.status in ('completed','failed') and p_event_type='connector.sync_'||r.status;
  v_type:='sync_run';
  v_scope_unknown:=exists(select 1 from public.sync_run_plan_items i where i.organization_id=p_organization_id and i.sync_run_id=p_source_id and i.cra_product_id is null);
 elsif p_source_kind='test' then
  select e.product_ids,e.id,'/connectors/webhooks' into v_products,v_resource,v_url from public.webhook_endpoints e where e.organization_id=p_organization_id and e.id=p_source_id and p_event_type='webhook.test';
  v_type:='connector';
 end if;
 if v_finding is not null then
  select array(select distinct p from (
   select r.product_id p from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id where f.organization_id=p_organization_id and f.id=v_finding
   union select a.affected_product_id from public.finding_impact_associations a where a.organization_id=p_organization_id and a.source_finding_id=v_finding and a.superseded_at is null
  ) q) into v_products;
 end if;
 if v_resource is null or cardinality(coalesce(v_products,'{}'))=0 or v_scope_unknown or exists(select 1 from unnest(v_products) p where not exists(select 1 from public.products x where x.organization_id=p_organization_id and x.id=p)) then
  return query select 'scope_unknown'::text,'{}'::uuid[],null::jsonb; return;
 end if;
 return query select 'authorized_scope'::text,array(select x from unnest(v_products) x order by x),jsonb_build_object('type',v_type,'id',v_resource,'url',v_url);
exception when invalid_text_representation then return query select 'scope_unknown'::text,'{}'::uuid[],null::jsonb;
end $$;

create function public.m1103_cancel_webhook_work(p_organization_id uuid,p_endpoint_id uuid,p_code text) returns void language plpgsql set search_path=public,pg_temp as $$
begin
 update public.webhook_delivery_attempts a set finished_at=clock_timestamp(),outcome='canceled',failure_category='configuration',failure_code=p_code from public.webhook_deliveries d where d.organization_id=p_organization_id and d.endpoint_id=p_endpoint_id and a.organization_id=d.organization_id and a.delivery_row_id=d.id and a.finished_at is null;
 update public.webhook_deliveries set status='canceled',completed_at=clock_timestamp(),last_failure_category='configuration',last_failure_code=p_code,lease_owner=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and endpoint_id=p_endpoint_id and status in ('pending','retrying','delivering');
end $$;

create function public.m1103_preview_webhook_replay(p_organization_id uuid,p_endpoint_id uuid,p_delivery_id uuid,p_actor_user_id uuid,p_permission_version bigint,p_expected_endpoint_version integer,p_expected_delivery_version integer)
returns table(outcome text,preview jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.webhook_endpoints%rowtype; d public.webhook_deliveries%rowtype; s record; j jsonb;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,false) then return query select 'forbidden'::text,null::jsonb;return;end if;
 select * into e from public.webhook_endpoints where organization_id=p_organization_id and id=p_endpoint_id for share;
 select * into d from public.webhook_deliveries where organization_id=p_organization_id and endpoint_id=p_endpoint_id and id=p_delivery_id for share;
 if e.id is null or d.id is null then return query select 'not_found'::text,null::jsonb;return;end if;
 if e.version<>p_expected_endpoint_version or d.version<>p_expected_delivery_version or d.status not in ('failed','canceled') or not e.enabled or e.secret_id is null then return query select 'conflict'::text,null::jsonb;return;end if;
 select * into s from public.m1103_webhook_source_scope(p_organization_id,d.source_kind,d.source_id,d.event_type);
 if s.outcome<>'authorized_scope' or not s.product_ids<@e.product_ids or (d.event_type<>'webhook.test' and not d.event_type=any(e.event_types)) then return query select 'forbidden'::text,null::jsonb;return;end if;
 j:=jsonb_build_object('deliveryRowId',d.id,'endpointId',e.id,'deliveryVersion',d.version,'endpointVersion',e.version,'receiverChanged',e.url<>d.endpoint_url,'currentDestination',e.url,'previousDestination',d.endpoint_url,'currentHost',split_part(split_part(e.url,'://',2),'/',1),'previousHost',split_part(split_part(d.endpoint_url,'://',2),'/',1),'eventType',d.event_type,'resource',s.resource,'payloadSha256',encode(extensions.digest(coalesce(d.payload_bytes,'')::text,'sha256'),'hex'));
 return query select 'previewed'::text,j||jsonb_build_object('previewDigest',encode(extensions.digest((j||jsonb_build_object('url',e.url,'scopeRevision',e.scope_revision,'destinationRevision',e.destination_revision,'productIds',s.product_ids))::text,'sha256'),'hex'));
end $$;
-- A bounded credential-copy guard complements application checks without needing keys.
create function public.m1103_metadata_contains_credential(p_text text) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare v text:=coalesce(p_text,'');i integer;
begin
 for i in 1..3 loop
  if v ~ '[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=' then return true;end if;
  v:=regexp_replace(regexp_replace(regexp_replace(regexp_replace(v,'%25','%','gi'),'%3D','=','gi'),'%2B','+','gi'),'%2F','/','gi');
 end loop;
 return v ~ '[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=';
end $$;

create function public.m1103_execute_webhook_endpoint_command_atomic(
 p_organization_id uuid,p_endpoint_id uuid,p_actor_user_id uuid,p_operation text,p_expected_version integer,p_idempotency_key uuid,p_request_digest text,p_request_digest_key_id text,p_permission_version bigint,p_payload jsonb,p_reason text default null)
returns table(outcome text,endpoint jsonb,command jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.webhook_endpoints%rowtype; c public.webhook_endpoint_commands%rowtype; d public.webhook_deliveries%rowtype; n public.webhook_deliveries%rowtype; s record; v_preview record;
 v_events text[];v_products uuid[];k jsonb;v_overlap integer;v_cancel boolean:=false;v_result jsonb;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,(p_operation in ('rotate_secret','revoke_secret') or (p_operation='create' and p_payload->'secret' is not null))) then return query select 'forbidden'::text,null::jsonb,null::jsonb;return;end if;
 if public.m1103_metadata_contains_credential(p_reason) or public.m1103_metadata_contains_credential(p_payload->>'displayName') or public.m1103_metadata_contains_credential(p_payload->>'url') then return query select 'invalid_request'::text,null::jsonb,null::jsonb;return;end if;
 if p_operation not in ('create','update','rotate_secret','disable','enable','revoke_secret','test','replay') or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_request_digest_key_id !~ '^[A-Za-z0-9_.-]{1,80}$' or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then return query select 'invalid_request'::text,null::jsonb,null::jsonb;return;end if;
 -- Consistent lock order: org command serializer -> endpoint -> delivery.
 perform pg_advisory_xact_lock(hashtextextended('webhook:'||p_organization_id::text,31));
 select * into c from public.webhook_endpoint_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if c.operation<>p_operation or c.request_digest<>p_request_digest or c.request_digest_key_id<>p_request_digest_key_id or (p_operation<>'create' and c.endpoint_id<>p_endpoint_id) then return query select 'idempotency_conflict'::text,null::jsonb,null::jsonb;return;end if;
  select * into e from public.webhook_endpoints where organization_id=p_organization_id and id=c.endpoint_id;
  return query select 'replayed'::text,c.result->'endpoint',c.result;return;
 end if;
 if p_operation in ('create','update') then
  v_events:=array(select jsonb_array_elements_text(p_payload->'eventTypes'));
  v_products:=array(select x::uuid from jsonb_array_elements_text(p_payload->'productIds') x order by x);
  if char_length(btrim(coalesce(p_payload->>'displayName',''))) not between 1 and 120 or not coalesce(public.m1103_valid_webhook_url(p_payload->>'url'),false) or not coalesce(public.m1103_valid_webhook_event_types(v_events),false) or cardinality(v_products) not between 1 and 100 or not public.m1103_distinct_array(v_events) or not public.m1103_distinct_array(v_products) or exists(select 1 from unnest(v_products) x where not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=x)) then return query select 'invalid_request'::text,null::jsonb,null::jsonb;return;end if;
 end if;
 if p_operation='create' then
  if (select count(*) from public.webhook_endpoints where organization_id=p_organization_id)>=50 then return query select 'conflict'::text,null::jsonb,null::jsonb;return;end if;
  insert into public.webhook_endpoints(id,organization_id,display_name,url,event_types,product_ids,authorization_actor_user_id,permission_version,created_by,updated_by,max_attempts,base_delay_seconds,max_delay_seconds)
  values(p_endpoint_id,p_organization_id,btrim(p_payload->>'displayName'),p_payload->>'url',v_events,v_products,p_actor_user_id,p_permission_version,p_actor_user_id,p_actor_user_id,coalesce((p_payload#>>'{retryPolicy,maxAttempts}')::integer,6),coalesce((p_payload#>>'{retryPolicy,baseDelaySeconds}')::integer,5),coalesce((p_payload#>>'{retryPolicy,maxDelaySeconds}')::integer,300)) returning * into e;
 else
  select * into e from public.webhook_endpoints where organization_id=p_organization_id and id=p_endpoint_id for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb;return;end if;
  if p_expected_version is null or p_expected_version<>e.version then return query select 'conflict'::text,null::jsonb,null::jsonb;return;end if;
 end if;
 if (p_operation='create' and p_payload->'secret' is not null) or p_operation='rotate_secret' then
  if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,true) then return query select 'forbidden'::text,null::jsonb,null::jsonb;return;end if;
  k:=p_payload->'secret';v_overlap:=coalesce((p_payload->>'overlapSeconds')::integer,3600);
  if public.m1103_webhook_secret_from_payload(k->'envelope') is null or (k->>'secretId')::uuid<>(k->>'keyId')::uuid or (k->>'revision')::integer<>e.secret_revision+1 or v_overlap not between 0 and 86400 or (p_operation='rotate_secret' and e.previous_secret_expires_at>clock_timestamp()) or (k->>'keyId')::uuid=e.secret_id or exists(select 1 from public.webhook_endpoints x where x.id<>e.id and ((k->>'keyId')::uuid=x.secret_id or (k->>'keyId')::uuid=x.previous_secret_id)) then raise exception 'Invalid secret rotation' using errcode='22023';end if;
  update public.webhook_endpoints set previous_secret_id=case when v_overlap>0 then secret_id end,previous_signing_key_id=case when v_overlap>0 then signing_key_id end,previous_secret_revision=case when v_overlap>0 and secret_id is not null then secret_revision end,
   previous_secret_ciphertext=case when v_overlap>0 then secret_ciphertext end,previous_secret_key_id=case when v_overlap>0 then secret_key_id end,previous_secret_nonce=case when v_overlap>0 then secret_nonce end,previous_secret_auth_tag=case when v_overlap>0 then secret_auth_tag end,previous_secret_expires_at=case when v_overlap>0 and secret_id is not null then clock_timestamp()+make_interval(secs=>v_overlap) end,
   secret_id=(k->>'secretId')::uuid,signing_key_id=(k->>'keyId')::uuid,secret_revision=(k->>'revision')::integer,secret_ciphertext=decode(k#>>'{envelope,ciphertext}','base64'),secret_key_id=k#>>'{envelope,keyId}',secret_nonce=decode(k#>>'{envelope,nonce}','base64'),secret_auth_tag=decode(k#>>'{envelope,authTag}','base64') where organization_id=p_organization_id and id=e.id returning * into e;
 elsif p_operation='update' then
  v_cancel:=e.url<>p_payload->>'url' or e.product_ids<>v_products or e.event_types<>v_events or e.authorization_actor_user_id<>p_actor_user_id;
  update public.webhook_endpoints set display_name=btrim(p_payload->>'displayName'),url=p_payload->>'url',event_types=v_events,product_ids=v_products,authorization_actor_user_id=p_actor_user_id,permission_version=p_permission_version,
   destination_revision=destination_revision+case when url<>p_payload->>'url' then 1 else 0 end,scope_revision=scope_revision+case when product_ids<>v_products or event_types<>v_events or authorization_actor_user_id<>p_actor_user_id then 1 else 0 end,
   max_attempts=coalesce((p_payload#>>'{retryPolicy,maxAttempts}')::integer,6),base_delay_seconds=coalesce((p_payload#>>'{retryPolicy,baseDelaySeconds}')::integer,5),max_delay_seconds=coalesce((p_payload#>>'{retryPolicy,maxDelaySeconds}')::integer,300) where organization_id=p_organization_id and id=e.id returning * into e;
 elsif p_operation in ('disable','revoke_secret') then
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then return query select 'invalid_request'::text,null::jsonb,null::jsonb;return;end if;
  update public.webhook_endpoints set enabled=false,disabled_at=clock_timestamp(),disabled_by=p_actor_user_id,disabled_reason=btrim(p_reason) where organization_id=p_organization_id and id=e.id returning * into e;
  if p_operation='revoke_secret' then update public.webhook_endpoints set secret_id=null,signing_key_id=null,secret_ciphertext=null,secret_key_id=null,secret_nonce=null,secret_auth_tag=null,previous_secret_id=null,previous_signing_key_id=null,previous_secret_ciphertext=null,previous_secret_key_id=null,previous_secret_nonce=null,previous_secret_auth_tag=null,previous_secret_revision=null,previous_secret_expires_at=null where organization_id=p_organization_id and id=e.id returning * into e;end if;
  v_cancel:=true;
 elsif p_operation='enable' then
  if e.secret_id is null then return query select 'conflict'::text,null::jsonb,null::jsonb;return;end if;
  v_cancel:=e.authorization_actor_user_id<>p_actor_user_id;
  update public.webhook_endpoints set enabled=true,disabled_at=null,disabled_by=null,disabled_reason=null,scope_revision=scope_revision+case when authorization_actor_user_id<>p_actor_user_id then 1 else 0 end,authorization_actor_user_id=p_actor_user_id,permission_version=p_permission_version where organization_id=p_organization_id and id=e.id returning * into e;
 elsif p_operation in ('replay','test') then
  if e.secret_id is null or (p_operation='replay' and not e.enabled) then return query select 'conflict'::text,null::jsonb,null::jsonb;return;end if;
  if p_operation='replay' then
   select * into d from public.webhook_deliveries where organization_id=p_organization_id and endpoint_id=e.id and id=(p_payload->>'deliveryId')::uuid for update;
   select * into v_preview from public.m1103_preview_webhook_replay(p_organization_id,e.id,d.id,p_actor_user_id,p_permission_version,e.version,(p_payload->>'expectedDeliveryVersion')::integer);
   if v_preview.outcome<>'previewed' or v_preview.preview->>'previewDigest'<>p_payload->>'previewDigest' or (e.url<>d.endpoint_url and coalesce((p_payload->>'confirmDestinationChange')::boolean,false)=false) or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then return query select 'conflict'::text,null::jsonb,null::jsonb;return;end if;
   if exists(select 1 from public.webhook_deliveries x where x.organization_id=p_organization_id and x.endpoint_id=e.id and x.event_id=d.event_id and x.status in ('pending','retrying','delivering')) then return query select 'conflict'::text,null::jsonb,null::jsonb;return;end if;
   select * into s from public.m1103_webhook_source_scope(p_organization_id,d.source_kind,d.source_id,d.event_type);
  else
   d.id:=null;d.source_kind:='test';d.source_id:=e.id;d.event_type:='webhook.test';d.event_id:='evt_'||encode(extensions.digest(p_organization_id::text||':test:'||p_idempotency_key::text,'sha256'),'hex');d.occurred_at:=clock_timestamp();
   select * into s from public.m1103_webhook_source_scope(p_organization_id,'test',e.id,'webhook.test');
  end if;
  insert into public.webhook_deliveries(organization_id,endpoint_id,event_id,delivery_id,event_type,resource_type,resource_id,product_ids,resource_url,occurred_at,endpoint_url,parent_delivery_id,replay_reason,source_kind,source_id,authorization_actor_user_id,permission_version,endpoint_version,destination_revision,scope_revision,max_attempts,base_delay_seconds,max_delay_seconds)
   values(p_organization_id,e.id,d.event_id,gen_random_uuid()::text,d.event_type,s.resource->>'type',(s.resource->>'id')::uuid,s.product_ids,s.resource->>'url',d.occurred_at,e.url,d.id,p_reason,d.source_kind,d.source_id,p_actor_user_id,p_permission_version,e.version,e.destination_revision,e.scope_revision,e.max_attempts,e.base_delay_seconds,e.max_delay_seconds) returning * into n;
 end if;
 if v_cancel then perform public.m1103_cancel_webhook_work(p_organization_id,e.id,case when p_operation in ('update','enable') then 'endpoint_changed' else 'endpoint_disabled' end);end if;
 if p_operation not in ('replay','test') then update public.webhook_endpoints set version=version+case when p_operation='create' then 0 else 1 end,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=e.id returning * into e;end if;
 v_result:=jsonb_build_object('endpointId',e.id,'version',e.version,'deliveryId',n.id,'delivery',case when n.id is not null then public.m1103_webhook_delivery_json(n) end,'endpoint',public.m1103_webhook_endpoint_json(e));
 insert into public.webhook_endpoint_commands(organization_id,endpoint_id,actor_user_id,operation,idempotency_key,request_digest,request_digest_key_id,expected_version,permission_version,state,result,reason) values(p_organization_id,e.id,p_actor_user_id,p_operation,p_idempotency_key,p_request_digest,p_request_digest_key_id,p_expected_version,p_permission_version,'completed',v_result,p_reason) returning * into c;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'webhook.'||p_operation,'webhook_endpoint',e.id::text,jsonb_build_object('commandId',c.id,'version',e.version,'deliveryId',n.id,'reason',p_reason));
 return query select case when p_operation='create' then 'created' else 'updated' end,public.m1103_webhook_endpoint_json(e),v_result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or invalid_parameter_value or unique_violation or foreign_key_violation then return query select 'invalid_request'::text,null::jsonb,null::jsonb;
end $$;
create function public.m1103_capture_webhook_event(p_organization_id uuid,p_source_kind text,p_source_id uuid,p_event_type text,p_occurred_at timestamptz)
returns void language plpgsql set search_path=public,pg_temp as $$
declare e public.webhook_endpoints%rowtype;s record;v_event text;v_status text;
begin
 -- No subscription means no additional source traversal on core domain writes.
 if not exists(select 1 from public.webhook_endpoints where organization_id=p_organization_id and enabled and p_event_type=any(event_types)) then return;end if;
 -- A bounded fan-out copies identity only, never source payload or existing queue state.
 select * into s from public.m1103_webhook_source_scope(p_organization_id,p_source_kind,p_source_id,p_event_type);
 v_event:='evt_'||encode(extensions.digest(p_organization_id::text||':'||p_source_kind||':'||p_source_id::text||':'||p_event_type,'sha256'),'hex');
 for e in select * from public.webhook_endpoints where organization_id=p_organization_id and enabled and p_event_type=any(event_types) order by id limit 50 for share loop
  if s.outcome='authorized_scope' and not s.product_ids<@e.product_ids then continue;end if;
  v_status:=case when s.outcome='authorized_scope' then 'pending' else 'canceled' end;
  insert into public.webhook_deliveries(organization_id,endpoint_id,event_id,delivery_id,event_type,resource_type,resource_id,product_ids,resource_url,occurred_at,endpoint_url,source_kind,source_id,authorization_actor_user_id,permission_version,endpoint_version,destination_revision,scope_revision,max_attempts,base_delay_seconds,max_delay_seconds,status,last_failure_category,last_failure_code,completed_at)
   values(p_organization_id,e.id,v_event,gen_random_uuid()::text,p_event_type,coalesce(s.resource->>'type','connector'),coalesce((s.resource->>'id')::uuid,e.id),coalesce(s.product_ids,'{}'),coalesce(s.resource->>'url','/connectors/webhooks'),p_occurred_at,e.url,p_source_kind,p_source_id,e.authorization_actor_user_id,e.permission_version,e.version,e.destination_revision,e.scope_revision,e.max_attempts,e.base_delay_seconds,e.max_delay_seconds,v_status,case when v_status='canceled' then 'scope_unknown' end,case when v_status='canceled' then 'source_scope_unknown' end,case when v_status='canceled' then clock_timestamp() end)
   on conflict (organization_id,endpoint_id,event_id) where parent_delivery_id is null do nothing;
 end loop;
end $$;
create function public.m1103_capture_product_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare t text;
begin
 t:=case new.event_type when 'release.market_availability_changed' then 'product.release.market_availability_changed' when 'release.lifecycle_changed' then 'product.release.lifecycle_changed' when 'release.placed_on_market_changed' then 'product.release.placed_on_market_changed' when 'product_relationship.graph_changed' then 'product.relationship.graph_changed' when 'remediation_anchor.recorded' then 'vulnerability.remediation_anchor.recorded' when 'remediation_anchor.corrected' then 'vulnerability.remediation_anchor.corrected' end;
 if t is not null then perform public.m1103_capture_webhook_event(new.organization_id,'product',new.id,t,new.occurred_at);end if;return new;
end $$;
create function public.m1103_capture_assessment_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.event_type in ('submitted','approved','rejected','superseded') then perform public.m1103_capture_webhook_event(new.organization_id,'assessment',new.id,'vulnerability.assessment.'||new.event_type,new.occurred_at);end if;return new;
end $$;
create function public.m1103_capture_reporting_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare t text;
begin
 t:=case new.event_kind when 'deadline_threshold_crossed' then 'reporting.deadline.threshold_crossed' when 'deadline_breached' then 'reporting.deadline.breached' when 'filing_recorded' then 'reporting.filing.recorded' end;
 if t is not null and not new.is_rehearsal then perform public.m1103_capture_webhook_event(new.organization_id,'reporting',new.id,t,new.occurred_at);end if;return new;
end $$;
create function public.m1103_capture_sync_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in ('completed','failed') and old.status is distinct from new.status then perform public.m1103_capture_webhook_event(new.organization_id,'sync',new.id,'connector.sync_'||new.status,clock_timestamp());end if;return new;
end $$;
create trigger m1103_capture_product_event after insert on public.product_regulatory_outbox_events for each row execute function public.m1103_capture_product_event();
create trigger m1103_capture_assessment_event after insert on public.vulnerability_finding_assessment_history_events for each row execute function public.m1103_capture_assessment_event();
create trigger m1103_capture_reporting_event after insert on public.reporting_obligation_events for each row execute function public.m1103_capture_reporting_event();
create trigger m1103_capture_sync_event after update of status on public.sync_runs for each row execute function public.m1103_capture_sync_event();

create function public.m1103_list_due_webhook_delivery_organizations(p_limit integer default 50) returns table(organization_id uuid,oldest_due_at timestamptz) language sql security definer set search_path=public,pg_temp as $$
 select d.organization_id,min(case when d.status='delivering' then d.lease_expires_at else d.next_attempt_at end) from public.webhook_deliveries d where (d.status in ('pending','retrying') and d.next_attempt_at<=clock_timestamp()) or (d.status='delivering' and d.lease_expires_at<=clock_timestamp()) group by d.organization_id order by 2,d.organization_id limit greatest(1,least(100,coalesce(p_limit,50))) $$;
create function public.m1103_webhook_slot_json(p_endpoint public.webhook_endpoints,p_previous boolean default false) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select case when case when p_previous then p_endpoint.previous_secret_id else p_endpoint.secret_id end is null then null else jsonb_build_object(
 'keyId',case when p_previous then p_endpoint.previous_signing_key_id else p_endpoint.signing_key_id end,
 'secretId',case when p_previous then p_endpoint.previous_secret_id else p_endpoint.secret_id end,
 'revision',case when p_previous then p_endpoint.previous_secret_revision else p_endpoint.secret_revision end,
 'envelope',jsonb_build_object('format','aes-256-gcm-v1','keyId',case when p_previous then p_endpoint.previous_secret_key_id else p_endpoint.secret_key_id end,
 'ciphertext',encode(case when p_previous then p_endpoint.previous_secret_ciphertext else p_endpoint.secret_ciphertext end,'base64'),
 'nonce',encode(case when p_previous then p_endpoint.previous_secret_nonce else p_endpoint.secret_nonce end,'base64'),
 'authTag',encode(case when p_previous then p_endpoint.previous_secret_auth_tag else p_endpoint.secret_auth_tag end,'base64')))
 ||case when p_previous then jsonb_build_object('expiresAt',public.m2_utc_z(p_endpoint.previous_secret_expires_at)) else '{}'::jsonb end end $$;
create function public.m1103_claim_webhook_delivery(p_organization_id uuid,p_worker_id text,p_lease_seconds integer) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.webhook_deliveries%rowtype;e public.webhook_endpoints%rowtype;v_id uuid;v_retry boolean;v_delay double precision;
begin
 perform 1 from public.organizations where id=p_organization_id and is_active for share;
 if not found then return query select 'empty'::text,null::jsonb;return;end if;
 if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_lease_seconds not between 15 and 300 then return query select 'invalid_request'::text,null::jsonb;return;end if;
 -- Lock endpoint before delivery, matching command/cancellation lock order.
 for e in select x.* from public.webhook_endpoints x where x.organization_id=p_organization_id and exists(select 1 from public.webhook_deliveries q where q.organization_id=p_organization_id and q.endpoint_id=x.id and ((q.status='delivering' and q.lease_expires_at<=clock_timestamp()) or (q.status in ('pending','retrying') and q.next_attempt_at<=clock_timestamp()))) order by (select min(q.next_attempt_at) from public.webhook_deliveries q where q.organization_id=p_organization_id and q.endpoint_id=x.id and q.status in ('pending','retrying','delivering')),x.id limit 50 for share skip locked loop
  select * into d from public.webhook_deliveries where organization_id=p_organization_id and endpoint_id=e.id and ((status='delivering' and lease_expires_at<=clock_timestamp()) or (status in ('pending','retrying') and next_attempt_at<=clock_timestamp())) order by next_attempt_at,created_at,id limit 1 for update skip locked;
  if not found then continue;end if;
  if d.status='delivering' then
   update public.webhook_delivery_attempts set finished_at=clock_timestamp(),outcome='interrupted',failure_category='interrupted',failure_code='lease_expired' where organization_id=p_organization_id and delivery_row_id=d.id and lease_generation=d.lease_generation and finished_at is null;
   v_delay:=least(d.max_delay_seconds,d.base_delay_seconds*power(2,greatest(0,d.attempt_count-1)));v_delay:=v_delay/2+random()*v_delay/2;
   v_retry:=d.attempt_count<d.max_attempts and d.deadline_at>clock_timestamp()+make_interval(secs=>v_delay);
   update public.webhook_deliveries set status=case when v_retry then 'retrying' else 'failed' end,next_attempt_at=clock_timestamp()+make_interval(secs=>v_delay),completed_at=case when not v_retry then clock_timestamp() end,lease_owner=null,lease_expires_at=null,last_failure_category='interrupted',last_failure_code=case when v_retry then 'lease_expired' else 'recovery_deadline_exceeded' end,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
   continue;
  end if;
  if (not e.enabled and d.event_type<>'webhook.test') or e.secret_id is null or e.destination_revision<>d.destination_revision or e.scope_revision<>d.scope_revision or d.attempt_count>=d.max_attempts or d.deadline_at<=clock_timestamp() then
   update public.webhook_deliveries set status=case when d.attempt_count>=d.max_attempts or d.deadline_at<=clock_timestamp() then 'failed' else 'canceled' end,completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_failure_category='configuration',last_failure_code='delivery_fence_changed',version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
   return query select 'canceled'::text,null::jsonb;return;
  end if;
  update public.webhook_deliveries set status='delivering',signing_secret_revision=e.secret_revision,lease_owner=btrim(p_worker_id),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_generation=lease_generation+1,attempt_count=attempt_count+1,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
  insert into public.webhook_delivery_attempts(organization_id,delivery_row_id,lease_generation,attempt_number,worker_id) values(p_organization_id,d.id,d.lease_generation,d.attempt_count,p_worker_id);
  return query select 'claimed'::text,jsonb_build_object('delivery',public.m1103_webhook_delivery_json(d),'endpoint',jsonb_build_object('id',e.id,'url',e.url,'secretRevision',e.secret_revision,'active',public.m1103_webhook_slot_json(e,false),'previous',case when e.previous_secret_expires_at>clock_timestamp() then public.m1103_webhook_slot_json(e,true) end),
   'endpointAuthorizationActorId',e.authorization_actor_user_id,'destinationUrl',d.endpoint_url,'authorizationActorId',d.authorization_actor_user_id,'permissionVersion',d.permission_version,'productIds',d.product_ids,'sourceKind',d.source_kind,'sourceId',d.source_id,'destinationRevision',d.destination_revision,'scopeRevision',d.scope_revision,'payloadBytes',d.payload_bytes,'leaseGeneration',d.lease_generation,'workerId',p_worker_id);return;
 end loop;
 return query select 'empty'::text,null::jsonb;
end $$;

create function public.m1103_prepare_webhook_delivery(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_generation integer,p_actor_user_id uuid,p_permission_version bigint,p_payload_bytes text,p_secret_revision integer)
returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.webhook_deliveries%rowtype;e public.webhook_endpoints%rowtype;s record;j jsonb;
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version,false) then return query select 'forbidden'::text,null::jsonb;return;end if;
 select x.* into e from public.webhook_endpoints x join public.webhook_deliveries q on q.organization_id=x.organization_id and q.endpoint_id=x.id where q.organization_id=p_organization_id and q.id=p_delivery_id for share of x;
 select * into d from public.webhook_deliveries where organization_id=p_organization_id and id=p_delivery_id and status='delivering' and lease_owner=p_worker_id and lease_generation=p_generation and lease_expires_at>clock_timestamp() for update;
 if d.id is null then return query select 'lease_lost'::text,null::jsonb;return;end if;
 select * into s from public.m1103_webhook_source_scope(p_organization_id,d.source_kind,d.source_id,d.event_type);
 if p_secret_revision is null or not public.m11_lock_connector_authorization(p_organization_id,e.authorization_actor_user_id,p_permission_version,false) or (d.signing_secret_revision<>p_secret_revision or not (e.secret_revision=p_secret_revision or coalesce(e.previous_secret_revision=p_secret_revision and e.previous_secret_expires_at>clock_timestamp(),false))) or d.authorization_actor_user_id<>p_actor_user_id or (not e.enabled and d.event_type<>'webhook.test') or e.secret_id is null or e.destination_revision<>d.destination_revision or e.scope_revision<>d.scope_revision or s.outcome<>'authorized_scope' or s.product_ids<>d.product_ids or not s.product_ids<@e.product_ids or (d.event_type<>'webhook.test' and not d.event_type=any(e.event_types)) then return query select 'forbidden'::text,null::jsonb;return;end if;
 j:=p_payload_bytes::jsonb;
 if jsonb_typeof(j) is distinct from 'object' then return query select 'invalid_request'::text,null::jsonb;return;end if;
 if not j?&array['schemaVersion','organizationId','eventId','deliveryId','eventType','occurredAt','resource'] or (select count(*) from jsonb_object_keys(j))<>7 or j->'schemaVersion' is distinct from '1'::jsonb or j->>'organizationId' is distinct from p_organization_id::text or j->>'eventId' is distinct from d.event_id or j->>'deliveryId' is distinct from d.delivery_id or j->>'eventType' is distinct from d.event_type or j->>'occurredAt' is distinct from public.m2_utc_z(d.occurred_at) or j->'resource' is distinct from s.resource then return query select 'invalid_request'::text,null::jsonb;return;end if;
 if p_payload_bytes is null or octet_length(p_payload_bytes)>8192 or (d.payload_bytes is not null and d.payload_bytes<>p_payload_bytes) then return query select 'conflict'::text,null::jsonb;return;end if;
 update public.webhook_deliveries set payload_bytes=coalesce(payload_bytes,p_payload_bytes),permission_version=p_permission_version where organization_id=p_organization_id and id=d.id returning * into d;
 return query select 'prepared'::text,public.m1103_webhook_delivery_json(d);
exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb;
end $$;
create function public.m1103_complete_webhook_delivery(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_generation integer,p_http_status integer,p_duration_ms integer,p_response_bytes integer)
returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.webhook_deliveries%rowtype;e public.webhook_endpoints%rowtype;
begin
 perform 1 from public.organizations where id=p_organization_id and is_active for share;
 if not found then return query select 'lease_lost'::text,null::jsonb;return;end if;
 if p_http_status not between 200 and 299 or p_duration_ms not between 0 and 120000 or p_response_bytes not between 0 and 4096 then return query select 'invalid_request'::text,null::jsonb;return;end if;
 select x.* into e from public.webhook_endpoints x join public.webhook_deliveries q on q.organization_id=x.organization_id and q.endpoint_id=x.id where q.organization_id=p_organization_id and q.id=p_delivery_id for update of x;
 select * into d from public.webhook_deliveries where organization_id=p_organization_id and id=p_delivery_id and status='delivering' and lease_owner=p_worker_id and lease_generation=p_generation and lease_expires_at>clock_timestamp() for update;
 if d.id is null then return query select 'lease_lost'::text,null::jsonb;return;end if;
 if d.payload_bytes is null or e.destination_revision<>d.destination_revision or e.scope_revision<>d.scope_revision or (not e.enabled and d.event_type<>'webhook.test') or not public.m11_lock_connector_authorization(p_organization_id,d.authorization_actor_user_id,d.permission_version,false) or not public.m11_lock_connector_authorization(p_organization_id,e.authorization_actor_user_id,d.permission_version,false) then return query select 'lease_lost'::text,null::jsonb;return;end if;
 update public.webhook_delivery_attempts set finished_at=clock_timestamp(),outcome='succeeded',http_status=p_http_status,duration_ms=p_duration_ms,response_bytes=p_response_bytes where organization_id=p_organization_id and delivery_row_id=d.id and lease_generation=p_generation and finished_at is null;
 update public.webhook_deliveries set status='succeeded',completed_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_http_status=p_http_status,last_failure_category=null,last_failure_code=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
 update public.webhook_endpoints set last_delivered_at=clock_timestamp(),last_failure_category=null where organization_id=p_organization_id and id=e.id and secret_revision=d.signing_secret_revision;
 return query select 'succeeded'::text,public.m1103_webhook_delivery_json(d);
end $$;
create function public.m1103_fail_webhook_delivery(p_organization_id uuid,p_delivery_id uuid,p_worker_id text,p_generation integer,p_category text,p_code text,p_http_status integer,p_duration_ms integer,p_response_bytes integer,p_retry_after_seconds bigint)
returns table(outcome text,delivery jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.webhook_deliveries%rowtype;e public.webhook_endpoints%rowtype;v_retry boolean;v_delay double precision;v_category text;v_code text;
begin
 perform 1 from public.organizations where id=p_organization_id and is_active for share;
 if not found then return query select 'lease_lost'::text,null::jsonb;return;end if;
 select x.* into e from public.webhook_endpoints x join public.webhook_deliveries q on q.organization_id=x.organization_id and q.endpoint_id=x.id where q.organization_id=p_organization_id and q.id=p_delivery_id for update of x;
 select * into d from public.webhook_deliveries where organization_id=p_organization_id and id=p_delivery_id and status='delivering' and lease_owner=p_worker_id and lease_generation=p_generation and lease_expires_at>clock_timestamp() for update;
 if d.id is null then return query select 'lease_lost'::text,null::jsonb;return;end if;
 v_category:=case when p_category in ('timeout','rate_limit','receiver_unavailable','receiver_rejected','egress_blocked','authorization','configuration','vault_unavailable','payload_unavailable','interrupted','scope_unknown','unknown') then p_category else 'unknown' end;
 -- Provider-controlled strings can never enter durable diagnostics.
 v_code:=case v_category when 'timeout' then 'delivery_timeout' when 'rate_limit' then 'receiver_rate_limited' when 'receiver_unavailable' then 'receiver_unavailable' when 'receiver_rejected' then 'receiver_rejected' when 'egress_blocked' then 'endpoint_policy_rejected' when 'authorization' then 'authorization_changed' when 'configuration' then 'configuration_changed' when 'vault_unavailable' then 'vault_unavailable' when 'payload_unavailable' then 'payload_unavailable' when 'interrupted' then 'delivery_interrupted' when 'scope_unknown' then 'source_scope_unknown' else 'delivery_failed' end;
 v_delay:=least(d.max_delay_seconds,d.base_delay_seconds*power(2,greatest(0,d.attempt_count-1)));v_delay:=v_delay/2+random()*v_delay/2;v_delay:=greatest(v_delay,coalesce(greatest(0,p_retry_after_seconds),0));
 v_retry:=v_category in ('timeout','rate_limit','receiver_unavailable','interrupted') and d.attempt_count<d.max_attempts and clock_timestamp()+make_interval(secs=>v_delay)<d.deadline_at;
 update public.webhook_delivery_attempts set finished_at=clock_timestamp(),outcome=case when v_retry then 'retrying' else 'failed' end,http_status=case when p_http_status between 100 and 599 then p_http_status end,duration_ms=greatest(0,least(coalesce(p_duration_ms,0),120000)),response_bytes=greatest(0,least(coalesce(p_response_bytes,0),4096)),failure_category=v_category,failure_code=v_code where organization_id=p_organization_id and delivery_row_id=d.id and lease_generation=p_generation and finished_at is null;
 update public.webhook_deliveries set status=case when v_retry then 'retrying' else 'failed' end,completed_at=case when not v_retry then clock_timestamp() end,next_attempt_at=clock_timestamp()+make_interval(secs=>v_delay),lease_owner=null,lease_expires_at=null,last_http_status=case when p_http_status between 100 and 599 then p_http_status end,last_failure_category=v_category,last_failure_code=v_code,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
 update public.webhook_endpoints set last_failure_category=v_category where organization_id=p_organization_id and id=e.id and secret_revision=d.signing_secret_revision;
 return query select d.status,public.m1103_webhook_delivery_json(d);
end $$;
create function public.m1103_guard_closed_attempt() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin if old.finished_at is not null then raise exception 'Closed webhook attempts are immutable' using errcode='55000';end if;return new;end $$;
create trigger m1103_closed_attempt_immutable before update on public.webhook_delivery_attempts for each row execute function public.m1103_guard_closed_attempt();

create function public.m1103_list_webhook_secret_envelopes(p_organization_id uuid,p_after_secret_id uuid default null,p_limit integer default 50)
returns table("secretId" uuid,"endpointId" uuid,"credentialRevision" integer,"keyId" text,ciphertext text,nonce text,"authTag" text,format text) language sql security definer set search_path=public,pg_temp as $$
 select x.secret_id,x.endpoint_id,x.rev,x.key_id,encode(x.ciphertext,'base64'),encode(x.nonce,'base64'),encode(x.tag,'base64'),'aes-256-gcm-v1'::text from (
 select e.secret_id,e.id endpoint_id,e.secret_revision rev,e.secret_key_id key_id,e.secret_ciphertext ciphertext,e.secret_nonce nonce,e.secret_auth_tag tag from public.webhook_endpoints e where e.organization_id=p_organization_id and e.secret_id is not null
 union all select e.previous_secret_id,e.id,e.previous_secret_revision,e.previous_secret_key_id,e.previous_secret_ciphertext,e.previous_secret_nonce,e.previous_secret_auth_tag from public.webhook_endpoints e where e.organization_id=p_organization_id and e.previous_secret_id is not null
 ) x where p_after_secret_id is null or x.secret_id>p_after_secret_id order by x.secret_id limit greatest(1,least(100,coalesce(p_limit,50))) $$;
create function public.m1103_webhook_key_references(p_organization_id uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 with refs as (select secret_key_id k,count(*) n,0::bigint c from public.webhook_endpoints where organization_id=p_organization_id and secret_id is not null group by secret_key_id union all select previous_secret_key_id,count(*),0::bigint from public.webhook_endpoints where organization_id=p_organization_id and previous_secret_id is not null group by previous_secret_key_id union all select request_digest_key_id,0::bigint,count(*) from public.webhook_endpoint_commands where organization_id=p_organization_id group by request_digest_key_id), grouped as (select k,sum(n)::bigint n,sum(c)::bigint c from refs group by k), bounded as (select * from grouped order by k limit 100)
 select jsonb_build_object('envelopeKeyReferences',coalesce((select jsonb_object_agg(k,n) from bounded where n>0),'{}'::jsonb),'commandKeyReferences',coalesce((select jsonb_object_agg(k,c) from bounded where c>0),'{}'::jsonb),'legacyEnvelopeCount',0,'hasMoreKeys',(select count(*)>100 from grouped)) $$;
create function public.m1103_rewrap_webhook_secret_atomic(p_organization_id uuid,p_endpoint_id uuid,p_secret_id uuid,p_expected_revision integer,p_expected_envelope jsonb,p_next_envelope jsonb)
returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.webhook_endpoints%rowtype;k jsonb;v_previous boolean;
begin
 select * into e from public.webhook_endpoints where organization_id=p_organization_id and id=p_endpoint_id for update;
 if not found then return query select 'not_found'::text;return;end if;
 v_previous:=e.previous_secret_id=p_secret_id;
 if e.secret_id is distinct from p_secret_id and e.previous_secret_id is distinct from p_secret_id then return query select 'conflict'::text;return;end if;
 k:=public.m1103_webhook_slot_json(e,v_previous);
 if (k->>'revision')::integer<>p_expected_revision or k->'envelope'<>p_expected_envelope then return query select 'conflict'::text;return;end if;
 if public.m1103_webhook_secret_from_payload(p_next_envelope) is null then return query select 'invalid_request'::text;return;end if;
 if v_previous then update public.webhook_endpoints set previous_secret_key_id=p_next_envelope->>'keyId',previous_secret_ciphertext=decode(p_next_envelope->>'ciphertext','base64'),previous_secret_nonce=decode(p_next_envelope->>'nonce','base64'),previous_secret_auth_tag=decode(p_next_envelope->>'authTag','base64') where organization_id=p_organization_id and id=p_endpoint_id;
 else update public.webhook_endpoints set secret_key_id=p_next_envelope->>'keyId',secret_ciphertext=decode(p_next_envelope->>'ciphertext','base64'),secret_nonce=decode(p_next_envelope->>'nonce','base64'),secret_auth_tag=decode(p_next_envelope->>'authTag','base64') where organization_id=p_organization_id and id=p_endpoint_id;end if;
 return query select 'rewrapped'::text;
exception when invalid_parameter_value or invalid_text_representation or check_violation then return query select 'invalid_request'::text;
end $$;
create function public.m1103_webhook_delivery_scopes(p_organization_id uuid,p_endpoint_id uuid,p_delivery_ids uuid[])
returns table(delivery_id uuid,outcome text,product_ids uuid[],resource jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(cardinality(p_delivery_ids),0) not between 1 and 100 or not public.m1103_distinct_array(p_delivery_ids) then raise exception 'Invalid delivery page' using errcode='22023';end if;
 return query select d.id,s.outcome,s.product_ids,s.resource from public.webhook_deliveries d cross join lateral public.m1103_webhook_source_scope(d.organization_id,d.source_kind,d.source_id,d.event_type) s where d.organization_id=p_organization_id and d.endpoint_id=p_endpoint_id and d.id=any(p_delivery_ids);
end $$;

-- Metadata-only tenant export. Payload bytes and encrypted key slots are never portable.
insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
values('connector_sync','webhook_endpoints','organization_id','id',9),('connector_sync','webhook_deliveries','organization_id','id',10),('connector_sync','webhook_delivery_attempts','organization_id','id',11),('connector_sync','webhook_endpoint_commands','organization_id','id',12)
on conflict(source_id,table_name) do nothing;
do $$
declare v_def text;v_anchor text;
begin
 select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure) into v_def;
 v_anchor:='public.sync_connector_cursors';
 if position(v_anchor in v_def)=0 then raise exception 'M11-03 export lock anchor missing';end if;
 execute replace(v_def,v_anchor,'public.sync_connector_cursors, public.webhook_endpoints, public.webhook_deliveries, public.webhook_delivery_attempts, public.webhook_endpoint_commands');
 select pg_get_functiondef('public.m1_export_business_record_jsonb(text,jsonb)'::regprocedure) into v_def;
 v_anchor:='  case p_table_name';
 if position(v_anchor in v_def)=0 then raise exception 'M11-03 export projection anchor missing';end if;
 execute replace(v_def,v_anchor,E'  if p_table_name=''webhook_endpoints'' then return jsonb_build_object(''id'',v_record->''id'',''display_name'',v_record->''display_name'',''event_types'',v_record->''event_types'',''product_ids'',v_record->''product_ids'',''enabled'',v_record->''enabled'',''version'',v_record->''version''); end if;\n  if p_table_name=''webhook_endpoint_commands'' then return v_record-array[''idempotency_key'',''request_digest'',''request_digest_key_id'',''result'',''reason'']; end if;\n  if p_table_name=''webhook_deliveries'' then return v_record-array[''payload_bytes'',''endpoint_url'',''lease_owner'',''lease_expires_at'',''lease_generation'',''replay_reason'']; end if;\n  if p_table_name=''webhook_delivery_attempts'' then return v_record-array[''worker_id'',''lease_generation'']; end if;\n'||v_anchor);
end $$;
-- All four tables cascade from their organization; deferred replay FK permits tenant purge.
-- Runtime can read scoped storage but mutation is restricted to atomic RPCs.
revoke all on public.webhook_endpoints,public.webhook_deliveries,public.webhook_endpoint_commands,public.webhook_delivery_attempts from public,anon,authenticated,service_role;
grant select on public.webhook_endpoints,public.webhook_deliveries,public.webhook_endpoint_commands,public.webhook_delivery_attempts to service_role;
do $$
declare f record;
begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'm1103_%' loop
  execute format('alter function %s owner to postgres',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('m1103_execute_webhook_endpoint_command_atomic','m1103_preview_webhook_replay','m1103_webhook_source_scope','m1103_webhook_delivery_scopes','m1103_list_due_webhook_delivery_organizations','m1103_claim_webhook_delivery','m1103_prepare_webhook_delivery','m1103_complete_webhook_delivery','m1103_fail_webhook_delivery','m1103_list_webhook_secret_envelopes','m1103_webhook_key_references','m1103_rewrap_webhook_secret_atomic') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
