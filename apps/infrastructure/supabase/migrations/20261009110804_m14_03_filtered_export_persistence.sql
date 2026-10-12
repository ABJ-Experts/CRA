-- M14-03: source-owned projections, immutable rows and fenced private delivery.
-- No existing evidence, retention rule, approval or audit signature is modified.
create table public.export_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 subject_kind text not null default 'member' check(subject_kind in ('member','supplier','auditor')),
 requester_id uuid references public.users(id) on delete restrict,
 session_id uuid,
 supplier_invitation_id uuid references public.supplier_evidence_invitations(id) on delete restrict,
 supplier_session_digest text check(supplier_session_digest is null or supplier_session_digest ~ '^[a-f0-9]{64}$'),
 auditor_session_id uuid references public.technical_file_auditor_sessions(id) on delete restrict,
 source text not null check(length(source) between 1 and 100),
 format text not null check(format in ('csv','xlsx','report')),
 scope text not null check(scope in ('all_filtered','current_page','selected')),
 filters jsonb not null check(jsonb_typeof(filters)='object' and octet_length(filters::text)<=32768),
 context jsonb not null check(jsonb_typeof(context)='object' and octet_length(context::text)<=8192),
 columns jsonb not null check(jsonb_typeof(columns)='array' and jsonb_array_length(columns) between 1 and 100),
 selected_ids uuid[] not null default '{}',
 idempotency_key uuid not null,
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 permission_version bigint not null,
 state text not null default 'queued' check(state in ('queued','capturing','audit_pending','rendering','ready','failed','cancelled','expired')),
 version integer not null default 1 check(version>0),
 attempts integer not null default 0 check(attempts between 0 and 3),
 worker_id text check(length(worker_id) between 1 and 200),
 lease_expires_at timestamptz,
 snapshot_as_of timestamptz,
 snapshot_transaction text,
 row_count integer check(row_count between 0 and 100000),
 capture_bytes bigint check(capture_bytes between 0 and 134217728),
 captured_columns jsonb,
 pending_audit_id uuid,
 processed_rows integer not null default 0 check(processed_rows between 0 and 100000),
 parts jsonb not null default '[]' check(jsonb_typeof(parts)='array' and jsonb_array_length(parts)<=512 and octet_length(parts::text)<=1048576),
 manifest jsonb check(manifest is null or (jsonb_typeof(manifest)='object' and octet_length(manifest::text)<=1048576)),
 failure_code text check(failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 grant_id uuid,
 grant_digest text check(grant_digest is null or grant_digest ~ '^[a-f0-9]{64}$'),
 grant_artifact_id text,
 grant_expires_at timestamptz,
 expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
 requested_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,id),
 unique(organization_id,requester_id,idempotency_key),
 check((subject_kind='member' and requester_id is not null and session_id is not null and supplier_invitation_id is null and auditor_session_id is null)
 or (subject_kind='supplier' and requester_id is null and supplier_invitation_id is not null and supplier_session_digest is not null and auditor_session_id is null)
 or (subject_kind='auditor' and requester_id is null and auditor_session_id is not null and supplier_invitation_id is null)),
 check((worker_id is null)=(lease_expires_at is null)),
 check((state in ('capturing','audit_pending','rendering'))=(worker_id is not null)),
 check(cardinality(selected_ids)<=100000)
);
create unique index export_jobs_supplier_idempotency on public.export_jobs(organization_id,supplier_invitation_id,idempotency_key) where subject_kind='supplier';
create unique index export_jobs_auditor_idempotency on public.export_jobs(organization_id,auditor_session_id,idempotency_key) where subject_kind='auditor';
create index export_jobs_claim on public.export_jobs(state,updated_at,organization_id,requested_at) where state in ('queued','capturing','audit_pending','rendering');
create index export_jobs_requester on public.export_jobs(organization_id,requester_id,requested_at desc,id);
create index export_jobs_supplier on public.export_jobs(supplier_invitation_id) where supplier_invitation_id is not null;
create index export_jobs_auditor on public.export_jobs(auditor_session_id) where auditor_session_id is not null;
create index export_jobs_expiry on public.export_jobs(expires_at) where state='ready';
create table public.export_snapshot_rows (
 organization_id uuid not null,
 job_id uuid not null,
 ordinal integer not null check(ordinal between 1 and 100000),
 source_id text not null check(length(source_id) between 1 and 200),
 source_version text not null check(length(source_version)<=200),
 product_id uuid,
 row_values jsonb not null check(jsonb_typeof(row_values)='object' and octet_length(row_values::text)<=5242880),
 row_digest text not null check(row_digest ~ '^[a-f0-9]{64}$'),
 primary key(organization_id,job_id,ordinal),
 foreign key(organization_id,job_id) references public.export_jobs(organization_id,id) on delete restrict
);
create index export_snapshot_rows_product on public.export_snapshot_rows(organization_id,product_id) where product_id is not null;
alter table public.export_jobs enable row level security;
alter table public.export_snapshot_rows enable row level security;
revoke all on public.export_jobs,public.export_snapshot_rows from public,anon,authenticated;
grant select,insert,update on public.export_jobs to service_role;
grant select,insert on public.export_snapshot_rows to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('filtered-exports','filtered-exports',false,67108864,array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/json'])
 on conflict(id) do nothing;

create function public.m14_03_immutable_snapshot() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'export_snapshot_is_immutable' using errcode='55000'; end $$;
create trigger export_snapshot_immutable before update or delete on public.export_snapshot_rows for each row execute function public.m14_03_immutable_snapshot();

-- Same merge order as contracts: defaults, additive custom grants/implications,
-- then explicit organization role override. Custom base_role is never a grant.
create function public.m14_03_actor_can(p_organization_id uuid,p_actor_user_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 with recursive catalogue as (select '{"defaults":{"owner":{"can_view_users":true,"can_create_users":true,"can_edit_users":true,"can_delete_users":true,"can_export_users":true,"can_view_roles":true,"can_create_roles":true,"can_edit_roles":true,"can_delete_roles":true,"can_export_roles":true,"can_view_invitations":true,"can_create_invitations":true,"can_delete_invitations":true,"can_export_invitations":true,"can_view_organization":true,"can_edit_organization":true,"can_delete_organization":true,"can_export_organization":true,"can_view_audit":true,"can_export_audit":true,"can_view_products":true,"can_create_products":true,"can_edit_products":true,"can_delete_products":true,"can_export_products":true,"can_approve_products":true,"can_view_orders":true,"can_create_orders":true,"can_edit_orders":true,"can_delete_orders":true,"can_export_orders":true,"can_view_invoices":true,"can_create_invoices":true,"can_edit_invoices":true,"can_delete_invoices":true,"can_export_invoices":true,"can_view_findings":true,"can_edit_findings":true,"can_approve_findings":true,"can_export_findings":true,"can_manage_finding_views":true,"can_manage_finding_approval_policy":true,"can_manage_finding_publication":true,"can_view_reporting":true,"can_submit_reporting":true,"can_export_reporting":true,"can_view_technical_files":true,"can_edit_technical_files":true,"can_snapshot_technical_files":true,"can_issue_technical_files":true,"can_share_technical_files":true,"can_export_technical_files":true,"can_export_tasks":true,"can_export_notifications":true,"can_export_vulnerabilities":true,"can_view_fleet":true,"can_create_fleet":true,"can_edit_fleet":true,"can_delete_fleet":true,"can_view_routes":true,"can_create_routes":true,"can_edit_routes":true,"can_delete_routes":true,"can_view_messages":true,"can_create_messages":true,"can_delete_messages":true,"can_view_email":true,"can_create_email":true,"can_delete_email":true,"can_view_calendar":true,"can_create_calendar":true,"can_edit_calendar":true,"can_delete_calendar":true,"can_view_files":true,"can_create_files":true,"can_edit_files":true,"can_delete_files":true,"can_view_dashboards":true,"can_export_dashboards":true,"can_view_tables":true,"can_export_tables":true,"can_view_analytics":true,"can_export_analytics":true,"can_view_connectors":true,"can_create_connectors":true,"can_edit_connectors":true,"can_delete_connectors":true,"can_export_connectors":true,"can_approve_connectors":true,"can_view_sboms":true,"can_upload_sboms":true,"can_review_sboms":true,"can_export_sboms":true,"can_view_evidence":true,"can_upload_evidence":true,"can_review_evidence":true,"can_manage_evidence":true,"can_export_evidence":true,"can_view_suppliers":true,"can_manage_suppliers":true,"can_export_suppliers":true,"can_view_frameworks":true,"can_manage_frameworks":true,"can_export_frameworks":true},"admin":{"can_view_users":true,"can_create_users":true,"can_edit_users":true,"can_delete_users":true,"can_export_users":true,"can_view_roles":true,"can_create_roles":true,"can_edit_roles":true,"can_delete_roles":true,"can_export_roles":true,"can_view_invitations":true,"can_create_invitations":true,"can_delete_invitations":true,"can_export_invitations":true,"can_view_organization":true,"can_edit_organization":false,"can_delete_organization":false,"can_export_organization":false,"can_view_audit":true,"can_export_audit":true,"can_view_products":true,"can_create_products":true,"can_edit_products":true,"can_delete_products":true,"can_export_products":true,"can_approve_products":true,"can_view_orders":true,"can_create_orders":true,"can_edit_orders":true,"can_delete_orders":true,"can_export_orders":true,"can_view_invoices":true,"can_create_invoices":true,"can_edit_invoices":true,"can_delete_invoices":true,"can_export_invoices":true,"can_view_findings":true,"can_edit_findings":true,"can_approve_findings":true,"can_export_findings":true,"can_manage_finding_views":true,"can_manage_finding_approval_policy":true,"can_manage_finding_publication":true,"can_view_reporting":true,"can_submit_reporting":true,"can_export_reporting":true,"can_view_technical_files":true,"can_edit_technical_files":true,"can_snapshot_technical_files":true,"can_issue_technical_files":true,"can_share_technical_files":true,"can_export_technical_files":true,"can_export_tasks":true,"can_export_notifications":true,"can_export_vulnerabilities":true,"can_view_fleet":true,"can_create_fleet":true,"can_edit_fleet":true,"can_delete_fleet":true,"can_view_routes":true,"can_create_routes":true,"can_edit_routes":true,"can_delete_routes":true,"can_view_messages":true,"can_create_messages":true,"can_delete_messages":true,"can_view_email":true,"can_create_email":true,"can_delete_email":true,"can_view_calendar":true,"can_create_calendar":true,"can_edit_calendar":true,"can_delete_calendar":true,"can_view_files":true,"can_create_files":true,"can_edit_files":true,"can_delete_files":true,"can_view_dashboards":true,"can_export_dashboards":true,"can_view_tables":true,"can_export_tables":true,"can_view_analytics":true,"can_export_analytics":true,"can_view_connectors":true,"can_create_connectors":true,"can_edit_connectors":true,"can_delete_connectors":true,"can_export_connectors":true,"can_approve_connectors":true,"can_view_sboms":true,"can_upload_sboms":true,"can_review_sboms":true,"can_export_sboms":true,"can_view_evidence":true,"can_upload_evidence":true,"can_review_evidence":true,"can_manage_evidence":true,"can_export_evidence":true,"can_view_suppliers":true,"can_manage_suppliers":true,"can_export_suppliers":true,"can_view_frameworks":true,"can_manage_frameworks":true,"can_export_frameworks":true},"member":{"can_view_organization":true,"can_view_products":true,"can_view_orders":true,"can_view_invoices":true,"can_view_fleet":true,"can_view_routes":true,"can_view_messages":true,"can_view_email":true,"can_view_calendar":true,"can_view_files":true,"can_view_dashboards":true,"can_view_tables":true,"can_view_analytics":true,"can_view_findings":true,"can_view_connectors":true,"can_view_sboms":true,"can_view_evidence":true,"can_view_frameworks":true,"can_create_products":true,"can_edit_products":true,"can_create_orders":true,"can_edit_orders":true,"can_create_invoices":true,"can_edit_invoices":true,"can_create_fleet":true,"can_edit_fleet":true,"can_create_routes":true,"can_edit_routes":true,"can_create_messages":true,"can_create_email":true,"can_create_calendar":true,"can_edit_calendar":true,"can_create_files":true,"can_edit_files":true,"can_export_dashboards":true,"can_export_tables":true,"can_export_analytics":true,"can_export_products":true,"can_export_orders":true,"can_upload_sboms":true,"can_upload_evidence":true},"viewer":{"can_view_organization":true,"can_view_products":true,"can_view_orders":true,"can_view_invoices":true,"can_view_fleet":true,"can_view_routes":true,"can_view_messages":true,"can_view_email":true,"can_view_calendar":true,"can_view_files":true,"can_view_dashboards":true,"can_view_tables":true,"can_view_analytics":true,"can_view_findings":true,"can_view_connectors":true,"can_view_sboms":true,"can_view_evidence":true,"can_view_frameworks":true}},"implications":{"can_view_users":[],"can_create_users":["can_view_users"],"can_edit_users":["can_view_users"],"can_delete_users":["can_view_users"],"can_export_users":["can_view_users"],"can_view_roles":[],"can_create_roles":["can_view_roles"],"can_edit_roles":["can_view_roles"],"can_delete_roles":["can_view_roles"],"can_export_roles":["can_view_roles"],"can_view_invitations":[],"can_create_invitations":["can_view_invitations"],"can_delete_invitations":["can_view_invitations"],"can_export_invitations":["can_view_invitations"],"can_view_organization":[],"can_edit_organization":["can_view_organization"],"can_delete_organization":["can_view_organization"],"can_export_organization":["can_view_organization"],"can_view_audit":[],"can_export_audit":["can_view_audit"],"can_view_products":[],"can_create_products":["can_view_products"],"can_edit_products":["can_view_products"],"can_delete_products":["can_view_products"],"can_export_products":["can_view_products"],"can_approve_products":["can_view_products"],"can_view_orders":[],"can_create_orders":["can_view_orders"],"can_edit_orders":["can_view_orders"],"can_delete_orders":["can_view_orders"],"can_export_orders":["can_view_orders"],"can_view_invoices":[],"can_create_invoices":["can_view_invoices"],"can_edit_invoices":["can_view_invoices"],"can_delete_invoices":["can_view_invoices"],"can_export_invoices":["can_view_invoices"],"can_view_findings":[],"can_edit_findings":["can_view_findings"],"can_approve_findings":["can_view_findings"],"can_export_findings":["can_view_findings"],"can_manage_finding_views":[],"can_manage_finding_approval_policy":[],"can_manage_finding_publication":[],"can_view_reporting":[],"can_submit_reporting":["can_view_reporting"],"can_export_reporting":["can_view_reporting"],"can_view_technical_files":[],"can_edit_technical_files":["can_view_technical_files"],"can_snapshot_technical_files":["can_view_technical_files"],"can_issue_technical_files":["can_view_technical_files"],"can_share_technical_files":["can_view_technical_files"],"can_export_technical_files":["can_view_technical_files"],"can_export_tasks":[],"can_export_notifications":[],"can_export_vulnerabilities":[],"can_view_fleet":[],"can_create_fleet":["can_view_fleet"],"can_edit_fleet":["can_view_fleet"],"can_delete_fleet":["can_view_fleet"],"can_view_routes":[],"can_create_routes":["can_view_routes"],"can_edit_routes":["can_view_routes"],"can_delete_routes":["can_view_routes"],"can_view_messages":[],"can_create_messages":["can_view_messages"],"can_delete_messages":["can_view_messages"],"can_view_email":[],"can_create_email":["can_view_email"],"can_delete_email":["can_view_email"],"can_view_calendar":[],"can_create_calendar":["can_view_calendar"],"can_edit_calendar":["can_view_calendar"],"can_delete_calendar":["can_view_calendar"],"can_view_files":[],"can_create_files":["can_view_files"],"can_edit_files":["can_view_files"],"can_delete_files":["can_view_files"],"can_view_dashboards":[],"can_export_dashboards":["can_view_dashboards"],"can_view_tables":[],"can_export_tables":["can_view_tables"],"can_view_analytics":[],"can_export_analytics":["can_view_analytics"],"can_view_connectors":[],"can_create_connectors":["can_view_connectors"],"can_edit_connectors":["can_view_connectors"],"can_delete_connectors":["can_view_connectors"],"can_export_connectors":["can_view_connectors"],"can_approve_connectors":["can_view_connectors"],"can_view_sboms":[],"can_upload_sboms":["can_view_sboms"],"can_review_sboms":["can_view_sboms"],"can_export_sboms":["can_view_sboms"],"can_view_evidence":[],"can_upload_evidence":["can_view_evidence"],"can_review_evidence":["can_view_evidence"],"can_manage_evidence":[],"can_export_evidence":["can_view_evidence"],"can_view_suppliers":[],"can_manage_suppliers":[],"can_export_suppliers":["can_view_suppliers"],"can_view_frameworks":[],"can_manage_frameworks":[],"can_export_frameworks":["can_view_frameworks"]}}'::jsonb data), actor as (
 select m.role from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
 join public.organizations o on o.id=m.organization_id and o.is_active
 where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
 ), positive(permission) as (
 select j.key from actor a cross join catalogue c cross join lateral jsonb_each(c.data->'defaults'->a.role) j where j.value='true'::jsonb
 union
 select j.key from public.user_role_assignments ua join public.custom_roles r on r.organization_id=ua.organization_id and r.id=ua.role_id
 cross join actor cross join lateral jsonb_each(r.permissions) j
 where ua.organization_id=p_organization_id and ua.user_id=p_actor_user_id and r.is_active and not r.is_deleted and j.value='true'::jsonb
 ), expanded(permission) as (
 select permission from positive
 union
 select j.value from expanded e cross join catalogue c cross join lateral jsonb_array_elements_text(coalesce(c.data->'implications'->e.permission,'[]')) j(value)
 ) select coalesce((select case when not (c.data->'defaults'->'owner' ? p_permission) then false
 when jsonb_typeof(o.permissions->p_permission)='boolean' then (o.permissions->>p_permission)::boolean
 else exists(select 1 from expanded e where e.permission=p_permission) end
 from actor a cross join catalogue c left join public.base_role_permission_overrides o on o.organization_id=p_organization_id and o.base_role=a.role),false)
$$;

-- Source-specific permissions and approved columns are an explicit allowlist.
-- Additional source-owned adapters extend this function, never raw-table access.
create function public.m14_03_source_policy(p_source text) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select case p_source
 when 'products.registry' then '{"permissions":["can_view_products","can_export_products"],"columns":["id","name","internalCode","productType","responsibleOwnerId","legalEntity.id","createdAt","updatedAt"],"page":true}'::jsonb
 when 'products.releases' then '{"permissions":["can_view_products","can_export_products"],"columns":["id","label","version","lifecycle","createdAt"],"page":true}'::jsonb
 when 'evidence.documents' then '{"permissions":["can_view_evidence","can_export_evidence"],"columns":["id","title","documentClass","status","validityStatus","validFrom","validUntil","createdAt"]}'::jsonb
 when 'suppliers.registry' then '{"permissions":["can_view_suppliers","can_view_products","can_view_sboms","can_export_suppliers"],"columns":["id","name","criticality","state","createdAt"]}'::jsonb
 when 'tasks.inbox' then '{"permissions":["can_export_tasks"],"columns":["sourceId","taskType","state","title","accountableOwnerUserId","dueAt"]}'::jsonb
 when 'findings.triage_queue' then '{"permissions":["can_view_findings","can_export_findings"],"columns":["id","productId","releaseId","advisoryId","severity","vexStatus","lastEvaluatedAt"],"page":true,"selected":true}'::jsonb
 when 'audit.events' then '{"permissions":["can_view_audit","can_export_audit"],"columns":["id","sequence","createdAt","action","resourceType","resourceId"]}'::jsonb
 when 'dashboard.trends' then '{"permissions":["can_view_dashboards","can_export_dashboards"],"columns":["bucket","metric","value","sourceVersion","asOf"]}'::jsonb
 when 'users.members' then '{"permissions":["can_view_users","can_export_users"],"columns":["id","firstName","lastName","email","role","isActive","joinedAt"],"page":true}'::jsonb
 when 'roles.custom_roles' then '{"permissions":["can_view_roles","can_export_roles"],"columns":["id","name","baseRole","isActive","memberCount"]}'::jsonb
 when 'invitations.pending' then '{"permissions":["can_view_invitations","can_export_invitations"],"columns":["id","email","role","status","expiresAt"]}'::jsonb
 when 'technical_files.readiness_report' then '{"permissions":["can_view_products","can_view_technical_files","can_export_technical_files"],"columns":["report"]}'::jsonb
 else null end
$$;

create function public.m14_03_job_access(p_job public.export_jobs) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_policy jsonb; v_permission text;
begin
 if p_job.subject_kind<>'member' then return false; end if;
 if not exists(select 1 from public.organization_session_bindings b join public.users u on u.id=b.user_id
 join auth.sessions s on s.id=b.session_id and s.user_id=u.auth_user_id
 where b.organization_id=p_job.organization_id and b.user_id=p_job.requester_id and b.session_id=p_job.session_id
 and floor(extract(epoch from b.issued_at))>=floor(extract(epoch from u.session_epoch_at))
 and (s.not_after is null or s.not_after>clock_timestamp()))
 or exists(select 1 from public.organization_session_revocations r where r.organization_id=p_job.organization_id and r.user_id=p_job.requester_id and r.session_id=p_job.session_id)
 then return false; end if;
 v_policy:=public.m14_03_source_policy(p_job.source); if v_policy is null then return false; end if;
 if v_policy->>'requiredRole'='owner' and not exists(select 1 from public.organization_members m where m.organization_id=p_job.organization_id and m.user_id=p_job.requester_id and m.role='owner') then return false; end if;
 if v_policy->>'requiredRole'='admin' and not exists(select 1 from public.organization_members m where m.organization_id=p_job.organization_id and m.user_id=p_job.requester_id and m.role in ('owner','admin')) then return false; end if;
 for v_permission in select jsonb_array_elements_text(v_policy->'permissions') loop
 if not public.m14_03_actor_can(p_job.organization_id,p_job.requester_id,v_permission) then return false; end if; end loop;
 if p_job.context ? 'productId' and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=(p_job.context->>'productId')::uuid) then return false; end if;
 return true;
end $$;

create function public.m14_03_job_json(p_job public.export_jobs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_job.id,'source',p_job.source,'format',p_job.format,'state',case when p_job.expires_at<=clock_timestamp() then 'expired' else p_job.state end,
 'kind',case when p_job.format='report' then 'readiness' else 'list' end,
 'version',p_job.version,'requestedAt',p_job.requested_at,'snapshotAsOf',p_job.snapshot_as_of,
 'expiresAt',p_job.expires_at,'rowCount',p_job.row_count,'progress',jsonb_build_object('processedRows',p_job.processed_rows,'totalRows',p_job.row_count),
 'failure',case when p_job.failure_code is null then null else jsonb_build_object('code',p_job.failure_code,'message','Export failed: '||p_job.failure_code,'retryable',p_job.failure_code in ('worker_failure','storage_failure','render_failure','capture_timeout','attempts_exhausted','provider_unavailable','storage_unavailable','generation_failed')) end,
 'artifacts',case when p_job.expires_at<=clock_timestamp() then '[]'::jsonb else coalesce((select jsonb_agg(part-'objectPath'-'startOrdinal'-'endOrdinal' order by n) from jsonb_array_elements(p_job.parts) with ordinality a(part,n)),'[]'::jsonb) end)
$$;
create function public.m14_03_private_job_json(p_job public.export_jobs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('publicJob',public.m14_03_job_json(p_job),'organizationId',p_job.organization_id,'requesterId',p_job.requester_id,
 'sessionId',p_job.session_id,'source',p_job.source,'format',p_job.format,'scope',p_job.scope,'filters',p_job.filters,'context',p_job.context,
 'columns',p_job.columns,'requestDigest',p_job.request_digest,'sourceVersionsDigest',coalesce((select encode(extensions.digest(convert_to(coalesce(string_agg(r.source_id||':'||r.source_version||':'||r.row_digest,E'\n' order by r.ordinal),''),'UTF8'),'sha256'),'hex') from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id),repeat('0',64)),'snapshotAsOf',p_job.snapshot_as_of,'requestedAt',p_job.requested_at,
 'totalRows',p_job.row_count,'processedRows',p_job.processed_rows,'parts',p_job.parts,'workerId',p_job.worker_id,'version',p_job.version)
$$;

-- Stable helper owns the original registry predicate. Both rendering and the
-- existing list facade consume it; mutable rows are copied, not only IDs.
create function public.m14_03_product_matches(p public.products,p_q text,p_archived boolean,p_product_type text,p_responsible_owner_id uuid)
returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select (p_archived is null or (p.archived_at is not null)=p_archived) and (p_product_type is null or p.product_type=p_product_type)
 and (p_responsible_owner_id is null or p.responsible_owner_id=p_responsible_owner_id)
 and (p_q is null or p.name ilike '%'||p_q||'%' or p.internal_code ilike '%'||p_q||'%')
$$;
create or replace function public.list_products(p_organization_id uuid,p_actor_user_id uuid,p_q text,p_archived boolean,p_product_type text,p_responsible_owner_id uuid,p_page integer,p_page_size integer)
returns table(outcome text,products jsonb) language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_total integer; v_rows jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select count(*) into v_total from public.products p where p.organization_id=p_organization_id and public.m14_03_product_matches(p,p_q,p_archived,p_product_type,p_responsible_owner_id);
 select coalesce(jsonb_agg(public.m2_product_json(p_organization_id,p.id) order by p.updated_at desc,p.id desc),'[]'::jsonb) into v_rows
 from (select id,updated_at from public.products p where p.organization_id=p_organization_id and public.m14_03_product_matches(p,p_q,p_archived,p_product_type,p_responsible_owner_id) order by p.updated_at desc,p.id desc limit p_page_size offset ((p_page-1)*p_page_size)) p;
 return query select 'found'::text,jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer));
end $$;

create function public.m14_03_release_registry_rows(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_archived boolean,p_lifecycle text)
returns setof public.product_releases language sql stable security definer set search_path=pg_catalog,public as $$
 select r from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id
 and public.m2_active_member(p_organization_id,p_actor_user_id)
 and exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id)
 and (p_archived is null or (r.archived_at is not null)=p_archived) and (p_lifecycle is null or r.lifecycle=p_lifecycle)
 order by r.created_at desc,r.id desc
$$;
create or replace function public.list_product_releases(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_archived boolean,p_lifecycle text,p_page integer,p_page_size integer)
returns table(outcome text,releases jsonb) language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_total integer; v_rows jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select count(*) into v_total from public.m14_03_release_registry_rows(p_organization_id,p_actor_user_id,p_product_id,p_archived,p_lifecycle);
 select coalesce(jsonb_agg(public.m2_release_json(p_organization_id,r.id) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows
 from (select id,created_at from public.m14_03_release_registry_rows(p_organization_id,p_actor_user_id,p_product_id,p_archived,p_lifecycle) limit p_page_size offset ((p_page-1)*p_page_size)) r;
 return query select 'found'::text,jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer));
end $$;

-- Dedicated capture dispatcher is extended by source-owned migrations.
create function public.m14_03_source_rows(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_source in ('products','products.registry') then
 return query select p.id::text,p.version::text,p.id,jsonb_build_object('id',p.id,'name',p.name,'internalCode',p.internal_code,'productType',p.product_type,
 'responsibleOwnerId',p.responsible_owner_id,'legalEntity.id',p.legal_entity_id,'createdAt',p.created_at,'updatedAt',p.updated_at)
 from public.products p where p.organization_id=p_organization_id and public.m2_active_member(p_organization_id,p_actor_user_id) and public.m14_03_product_matches(p,nullif(p_filters->>'q',''),(p_filters->>'archived')::boolean,p_filters->>'productType',(p_filters->>'responsibleOwnerId')::uuid) order by p.updated_at desc,p.id desc limit 100001;
 elsif p_source='products.releases' then
 return query select r.id::text,r.version::text,r.product_id,jsonb_build_object('id',r.id,'label',r.label,'version',r.release_version,'lifecycle',r.lifecycle,'createdAt',r.created_at)
 from public.m14_03_release_registry_rows(p_organization_id,p_actor_user_id,(p_context->>'productId')::uuid,(p_filters->>'archived')::boolean,p_filters->>'lifecycle') r;
 else return query select * from public.m14_03_domain_source_rows(p_organization_id,p_actor_user_id,p_source,p_filters,p_context);
 end if;
end $$;

-- Recheck access by source identity without reapplying mutable value filters.
-- A renamed product still delivers its original captured values; an inaccessible
-- or deleted product cannot deliver them. Source-specific policies may tighten.
create function public.m14_03_snapshot_access(p_job public.export_jobs) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.m14_03_job_access(p_job) then return false; end if;
 if p_job.row_count is null then return true; end if;
 if exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and r.product_id is not null
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=r.product_id)) then return false; end if;
 if p_job.source in ('products','products.registry') then
 return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id::text=r.source_id and public.m2_active_member(p_job.organization_id,p_job.requester_id)));
 end if;
 return public.m14_03_domain_snapshot_access(p_job);
end $$;

create function public.m14_03_worker_job(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer)
returns public.export_jobs language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found or v_job.worker_id is distinct from p_worker_id or v_job.version<>p_expected_version
 or v_job.lease_expires_at<=clock_timestamp() or v_job.state not in ('capturing','audit_pending','rendering') then raise exception 'export_worker_conflict' using errcode='40001'; end if;
 if not public.m14_03_snapshot_access(v_job) then raise exception 'export_access_changed' using errcode='42501'; end if;
 return v_job;
end $$;

create function public.m14_03_claim_export(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 200 then raise exception 'invalid_worker' using errcode='22023'; end if;
 -- Global scheduler lock is held only for the bounded claim, not for work.
 perform pg_advisory_xact_lock(hashtextextended('m14-03-export-scheduler',0));
 select j.* into v_job from public.export_jobs j where j.state in ('queued','capturing','audit_pending','rendering')
 and (j.expires_at<=clock_timestamp() or (j.attempts>=3 and j.lease_expires_at<=clock_timestamp())) order by j.updated_at,j.id for update skip locked limit 1;
 if found then
 update public.export_jobs set state=case when expires_at<=clock_timestamp() then 'expired' else 'failed' end,failure_code=case when expires_at<=clock_timestamp() then 'expired' else 'attempts_exhausted' end,worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where organization_id=v_job.organization_id and id=v_job.id returning * into v_job;
 perform public.m14_03_audit(v_job,'failed',gen_random_uuid());
 end if;
 select j.* into v_job from public.export_jobs j
 where j.attempts<3 and j.expires_at>clock_timestamp()
 and (j.state='queued' or (j.state in ('capturing','audit_pending','rendering') and j.lease_expires_at<=clock_timestamp()))
 and not exists(select 1 from public.export_jobs x where x.organization_id=j.organization_id and x.id<>j.id and x.state in ('capturing','audit_pending','rendering') and x.lease_expires_at>clock_timestamp())
 order by (select max(x.updated_at) from public.export_jobs x where x.organization_id=j.organization_id),j.requested_at,j.id
 for update of j skip locked limit 1;
 if not found then return null; end if;
 if not public.m14_03_snapshot_access(v_job) then
 update public.export_jobs set state='failed',failure_code='access_changed',worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
 perform public.m14_03_audit(v_job,'failed',gen_random_uuid()); return null; end if;
 update public.export_jobs set state=case when row_count is null then 'capturing' when pending_audit_id is not null then 'audit_pending' else 'rendering' end,
 worker_id=p_worker_id,lease_expires_at=clock_timestamp()+interval '120 seconds',attempts=attempts+1,version=version+1,updated_at=clock_timestamp()
 where id=v_job.id returning * into v_job;
 return public.m14_03_private_job_json(v_job);
end $$;

-- Classify bounded-capture overflow before table constraints can turn it into
-- a generic provider failure. The source statement remains atomic and stable.
create function public.m14_03_capture_ordinal(p_ordinal bigint,p_row_bytes integer,p_total_bytes bigint)
returns integer language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 if p_ordinal>100000 or p_row_bytes>5242880 or p_total_bytes>134217728 then raise exception 'export_capture_limit' using errcode='54000';end if;
 return p_ordinal::integer;
end $$;

create function public.m14_03_capture_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='30s' as $$
declare v_job public.export_jobs; v_count integer; v_bytes bigint; v_from integer:=0; v_limit integer:=100001;
begin
 v_job:=public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version);
 if v_job.row_count is not null then return public.m14_03_private_job_json(v_job); end if;
 if v_job.scope='current_page' then
 if v_job.source in ('products.registry','products.releases') then v_from:=greatest(0,(coalesce((v_job.filters->>'page')::integer,1)-1)*coalesce((v_job.filters->>'pageSize')::integer,25)); end if;
 v_limit:=coalesce((v_job.filters->>'pageSize')::integer,(v_job.filters->>'limit')::integer,25);
 end if;
 -- Exactly one source statement snapshot. Stable source helpers may page,
 -- but every internal read observes this same capture statement snapshot.
 insert into public.export_snapshot_rows(organization_id,job_id,ordinal,source_id,source_version,product_id,row_values,row_digest)
 select p_organization_id,p_job_id,public.m14_03_capture_ordinal(row_number() over(),octet_length(r.projected::text),sum(octet_length(r.projected::text)) over()),r.source_id,r.source_version,r.product_id,r.projected,
 encode(extensions.digest(convert_to(public.m13_02_canonical_json(r.projected),'UTF8'),'sha256'),'hex')
 from (select s.source_id,s.source_version,s.product_id,
 (select coalesce(jsonb_object_agg(k.value,s.row_values->k.value),'{}') from jsonb_array_elements_text(v_job.columns) k(value)) projected
 from public.m14_03_source_rows(p_organization_id,v_job.requester_id,v_job.source,v_job.filters,v_job.context||jsonb_build_object('_exportScope',v_job.scope,'_exportJobId',v_job.id)) s
 where v_job.scope<>'selected' or s.source_id=any(v_job.selected_ids::text[]) offset v_from limit v_limit) r;
 select count(*),coalesce(sum(octet_length(row_values::text)),0) into v_count,v_bytes from public.export_snapshot_rows where organization_id=p_organization_id and job_id=p_job_id;
 if v_count>100000 or v_bytes>134217728 then raise exception 'export_capture_limit' using errcode='54000'; end if;
 if v_job.scope='selected' and v_count<>cardinality(v_job.selected_ids) then raise exception 'export_selection_inaccessible' using errcode='42501'; end if;
 update public.export_jobs set state='audit_pending',row_count=v_count,capture_bytes=v_bytes,snapshot_as_of=statement_timestamp(),
 snapshot_transaction=pg_current_snapshot()::text,pending_audit_id=gen_random_uuid(),version=version+1,updated_at=clock_timestamp(),
 lease_expires_at=clock_timestamp()+interval '120 seconds' where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 return public.m14_03_private_job_json(v_job);
end $$;

create function public.m14_03_publish_capture(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 v_job:=public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version);
 if v_job.state='rendering' then return public.m14_03_private_job_json(v_job); end if;
 if v_job.state<>'audit_pending' or v_job.pending_audit_id is null then raise exception 'export_not_captured' using errcode='40001'; end if;
 perform public.m14_03_audit(v_job,'captured',v_job.pending_audit_id);
 update public.export_jobs set state='rendering',pending_audit_id=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 return public.m14_03_private_job_json(v_job);
end $$;

create function public.m14_03_heartbeat_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 v_job:=public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version);
 update public.export_jobs set lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 return public.m14_03_private_job_json(v_job);
end $$;
create function public.m14_03_authorize_export_worker(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version); return true; end $$;

create function public.m14_03_read_export_rows(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_after_ordinal integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 if p_limit not between 1 and 250 or p_after_ordinal not between 0 and 100000 then raise exception 'invalid_export_page' using errcode='22023'; end if;
 v_job:=public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version);
 if v_job.state<>'rendering' then raise exception 'unpublished_export_capture' using errcode='40001'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('ordinal',r.ordinal,'sourceId',r.source_id,'sourceVersion',r.source_version,'productId',r.product_id,'values',r.row_values,'sha256',r.row_digest) order by r.ordinal),'[]')
 from (select * from public.export_snapshot_rows where organization_id=p_organization_id and job_id=p_job_id and ordinal>p_after_ordinal order by ordinal limit p_limit) r);
end $$;

create function public.m14_03_audit(p_job public.export_jobs,p_action text,p_request_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_outcome text;
begin
 select x.outcome into v_outcome from public.m13_01_append_audit_event(p_job.organization_id,'organization','exports.'||p_action||':'||p_request_id::text,
 'user',p_job.requester_id::text,'exports.'||p_action,'export_job',p_job.id::text,'completed',p_request_id,null,
 jsonb_build_object('requestId',p_job.idempotency_key,'state',p_job.state,'version',p_job.version),null,null,null,p_job.requester_id) x;
 if v_outcome='conflict' then raise exception 'export_audit_conflict' using errcode='23505'; end if;
end $$;

create function public.m14_03_create_export(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs; v_existing public.export_jobs; v_policy jsonb; v_digest text; v_column text; v_columns jsonb;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or p_input->>'source' is null or p_input->>'idempotencyKey' is null
 or p_input->>'format' not in ('csv','xlsx','report') or coalesce(p_input->>'scope','all_filtered') not in ('all_filtered','current_page','selected')
 or jsonb_typeof(p_input->'filters')<>'object' or jsonb_typeof(p_input->'context')<>'object' then raise exception 'invalid_export_request' using errcode='22023'; end if;
 v_policy:=public.m14_03_source_policy(p_input->>'source');
 if v_policy is null then raise exception 'unsupported_export_source' using errcode='22023'; end if;
 if p_input->>'scope'='current_page' and not coalesce((v_policy->>'page')::boolean,false) then raise exception 'unsupported_export_scope' using errcode='22023'; end if;
 if p_input->>'scope'='selected' and (not coalesce((v_policy->>'selected')::boolean,false) or jsonb_array_length(coalesce(p_input->'selectedIds','[]'))=0) then raise exception 'unsupported_export_scope' using errcode='22023'; end if;
 v_columns:=coalesce(p_input->'columns',v_policy->'columns');
 for v_column in select jsonb_array_elements_text(v_columns) loop
 if not (v_policy->'columns' ? v_column) then raise exception 'unapproved_export_column' using errcode='22023'; end if; end loop;
 v_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(p_input),'UTF8'),'sha256'),'hex');
 -- Tenant row lock serializes queue bounds and duplicate submission, without
 -- locking source tables or the audit chain during capture.
 perform 1 from public.organizations where id=p_organization_id for update;
 select * into v_existing from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and idempotency_key=(p_input->>'idempotencyKey')::uuid;
 if found then
 if not public.m14_03_job_access(v_existing) or v_existing.session_id<>p_session_id then raise exception 'export_access_denied' using errcode='42501'; end if;
 if v_existing.request_digest<>v_digest then raise exception 'export_idempotency_conflict' using errcode='40001'; end if;
 return public.m14_03_job_json(v_existing); end if;
 v_job.organization_id:=p_organization_id; v_job.subject_kind:='member'; v_job.requester_id:=p_actor_user_id; v_job.session_id:=p_session_id;
 v_job.source:=p_input->>'source'; v_job.context:=p_input->'context';
 if not public.m14_03_job_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 if (select count(*) from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and state in ('queued','capturing','audit_pending','rendering'))>=2
 or (select count(*) from public.export_jobs where organization_id=p_organization_id and state in ('queued','capturing','audit_pending','rendering'))>=10 then raise exception 'export_queue_limit' using errcode='54000'; end if;
 insert into public.export_jobs(organization_id,requester_id,session_id,source,format,scope,filters,context,columns,selected_ids,idempotency_key,request_digest,permission_version)
 values(p_organization_id,p_actor_user_id,p_session_id,p_input->>'source',p_input->>'format',coalesce(p_input->>'scope','all_filtered'),p_input->'filters',p_input->'context',v_columns,
 coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_input->'selectedIds','[]'))),'{}'),(p_input->>'idempotencyKey')::uuid,v_digest,
 coalesce((select version from public.organization_permissions_version where organization_id=p_organization_id),0)) returning * into v_job;
 perform public.m14_03_audit(v_job,'queued',v_job.idempotency_key);
 return public.m14_03_job_json(v_job);
end $$;

create function public.m14_03_checkpoint_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_parts jsonb,p_processed_rows integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs; v_part jsonb; v_total bigint:=0; v_ids uuid[]:='{}'; v_n integer:=0;
begin
 v_job:=public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version);
 if v_job.state<>'rendering' or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)>512 or p_processed_rows<v_job.processed_rows or p_processed_rows>v_job.row_count then raise exception 'invalid_export_checkpoint' using errcode='22023'; end if;
 for v_part in select value from jsonb_array_elements(p_parts) loop
 if jsonb_typeof(v_part)<>'object' or not (v_part ?& array['id','name','mediaType','byteLength','sha256','rowCount','objectPath','startOrdinal','endOrdinal']) then raise exception 'invalid_export_artifact' using errcode='22023'; end if;
 if v_n<jsonb_array_length(v_job.parts) and v_job.parts->v_n is distinct from v_part then raise exception 'export_checkpoint_rewrite' using errcode='40001'; end if;
 if v_part->>'id' is null or (v_part->>'id')::uuid=any(v_ids)
 or v_part->>'objectPath' not like p_organization_id::text||'/'||p_job_id::text||'/%'
 or v_part->>'objectPath' ~ '(^|/)\.\.(/|$)|[[:cntrl:]]' or length(v_part->>'objectPath')>500
 or (v_part->>'name') ~ '[/\\[:cntrl:]]' or char_length(v_part->>'name') not between 1 and 180
 or (v_part->>'sha256') !~ '^[a-f0-9]{64}$'
 or (v_part->>'byteLength')::bigint not between 0 and 67108864
 or (v_part->>'rowCount')::integer not between 0 and 100000
 or (v_part->>'startOrdinal')::integer not between 1 and 100001
 or (v_part->>'endOrdinal')::integer<(v_part->>'startOrdinal')::integer-1
 or (v_part->>'endOrdinal')::integer>v_job.row_count
 or v_part->>'mediaType' not in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/json')
 or exists(select 1 from jsonb_object_keys(v_part) k where k not in ('id','name','mediaType','byteLength','sha256','rowCount','objectPath','startOrdinal','endOrdinal'))
 then raise exception 'invalid_export_artifact' using errcode='22023'; end if;
 v_total:=v_total+(v_part->>'byteLength')::bigint; v_ids:=array_append(v_ids,(v_part->>'id')::uuid); v_n:=v_n+1;
 end loop;
 if jsonb_array_length(p_parts)<jsonb_array_length(v_job.parts) or v_total>1073741824 then raise exception 'export_artifact_limit' using errcode='54000'; end if;
 update public.export_jobs set parts=p_parts,processed_rows=p_processed_rows,version=version+1,updated_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '120 seconds'
 where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 return public.m14_03_private_job_json(v_job);
end $$;

create function public.m14_03_complete_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 v_job:=public.m14_03_worker_job(p_organization_id,p_job_id,p_worker_id,p_expected_version);
 if p_manifest is null or jsonb_typeof(p_manifest)<>'object' or not (p_manifest ?& array['version','jobId','source','requestedAt','snapshotAsOf','scope','requestDigest','rowCount','columns','artifacts','sourceVersionsDigest','documentationReadinessOnly'])
 or p_manifest->>'version'<>'m14_03_v1' or p_manifest->>'source'<>v_job.source or p_manifest->>'scope'<>v_job.scope
 or v_job.state<>'rendering' or v_job.processed_rows<>v_job.row_count or jsonb_array_length(v_job.parts)=0
 or p_manifest->>'jobId'<>p_job_id::text or p_manifest->>'requestDigest'<>v_job.request_digest or (p_manifest->>'rowCount')::integer<>v_job.row_count
 or (p_manifest->>'snapshotAsOf')::timestamptz is distinct from v_job.snapshot_as_of
 or (p_manifest->>'requestedAt')::timestamptz is distinct from v_job.requested_at
 or p_manifest->'artifacts' is distinct from public.m14_03_job_json(v_job)->'artifacts' then raise exception 'invalid_export_completion' using errcode='22023'; end if;
 update public.export_jobs set state='ready',manifest=p_manifest,worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp()
 where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 perform public.m14_03_audit(v_job,'ready',gen_random_uuid());
 return public.m14_03_private_job_json(v_job);
end $$;

create function public.m14_03_fail_export(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 -- Fenced failures must remain possible after scope revocation; they never
 -- disclose snapshot rows and cannot resurrect a cancelled job.
 select * into v_job from public.export_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found or v_job.worker_id is distinct from p_worker_id or v_job.version<>p_expected_version or v_job.lease_expires_at<=clock_timestamp() then raise exception 'export_worker_conflict' using errcode='40001'; end if;
 if p_failure_code is null or p_failure_code !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid_export_failure' using errcode='22023'; end if;
 update public.export_jobs set state='failed',failure_code=p_failure_code,worker_id=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 perform public.m14_03_audit(v_job,'failed',gen_random_uuid());
 return public.m14_03_private_job_json(v_job);
end $$;

create function public.m14_03_get_export(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id and id=p_job_id;
 if not found or not public.m14_03_snapshot_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 if v_job.expires_at<=clock_timestamp() then v_job.state:='expired'; v_job.parts:='[]'; end if;
 return public.m14_03_job_json(v_job);
end $$;
create function public.m14_03_list_exports(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_query jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_limit integer:=coalesce((p_query->>'limit')::integer,25); v_job public.export_jobs; v_data jsonb:='[]'; v_count integer:=0; v_cursor uuid; v_next text;
begin
 if v_limit not between 1 and 100 then raise exception 'invalid_export_list_limit' using errcode='22023'; end if;
 if p_query ? 'cursor' then v_cursor:=(p_query->>'cursor')::uuid; end if;
 for v_job in select * from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id
 and (not p_query ? 'source' or source=p_query->>'source') and (v_cursor is null or id>v_cursor) order by id loop
 if not public.m14_03_snapshot_access(v_job) then continue; end if;
 if v_count=v_limit then v_next:=(v_data->(v_count-1)->>'id'); exit; end if;
 if v_job.expires_at<=clock_timestamp() then v_job.state:='expired'; v_job.parts:='[]'; end if;
 v_data:=v_data||jsonb_build_array(public.m14_03_job_json(v_job)); v_count:=v_count+1;
 end loop;
 return jsonb_build_object('data',v_data,'nextCursor',v_next);
end $$;

create function public.m14_03_cancel_export(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_expected_version integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id and id=p_job_id for update;
 if not found or not public.m14_03_job_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 if exists(select 1 from public.audit_logs where organization_id=p_organization_id and event_key='exports.cancelled:'||p_idempotency_key::text and entity_id=p_job_id::text) then return public.m14_03_job_json(v_job); end if;
 if v_job.version<>p_expected_version or v_job.state not in ('queued','capturing','audit_pending','rendering','ready') then raise exception 'export_version_conflict' using errcode='40001'; end if;
 update public.export_jobs set state='cancelled',worker_id=null,lease_expires_at=null,grant_digest=null,grant_id=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 perform public.m14_03_audit(v_job,'cancelled',p_idempotency_key);
 return public.m14_03_job_json(v_job);
end $$;
create function public.m14_03_retry_export(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_expected_version integer,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id and id=p_job_id for update;
 if not found or not public.m14_03_snapshot_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 if exists(select 1 from public.audit_logs where organization_id=p_organization_id and event_key='exports.retried:'||p_idempotency_key::text and entity_id=p_job_id::text) then return public.m14_03_job_json(v_job); end if;
 if v_job.version<>p_expected_version or v_job.state<>'failed' or v_job.expires_at<=clock_timestamp() or v_job.failure_code not in ('worker_failure','storage_failure','render_failure','capture_timeout','attempts_exhausted','provider_unavailable','storage_unavailable','generation_failed') then raise exception 'export_retry_conflict' using errcode='40001'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if (select count(*) from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and state in ('queued','capturing','audit_pending','rendering'))>=2 or (select count(*) from public.export_jobs where organization_id=p_organization_id and state in ('queued','capturing','audit_pending','rendering'))>=10 then raise exception 'export_queue_limit' using errcode='54000'; end if;
 update public.export_jobs set state='queued',failure_code=null,attempts=0,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 perform public.m14_03_audit(v_job,'retried',p_idempotency_key); return public.m14_03_job_json(v_job);
end $$;

create function public.m14_03_issue_export_download_grant(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_artifact_id uuid,p_token_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id and id=p_job_id for update;
 if not found or not public.m14_03_snapshot_access(v_job) or v_job.state<>'ready' or v_job.expires_at<=clock_timestamp()
 or not exists(select 1 from jsonb_array_elements(v_job.parts) p where p->>'id'=p_artifact_id::text) then raise exception 'export_access_denied' using errcode='42501'; end if;
 if p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid_download_digest' using errcode='22023'; end if;
 update public.export_jobs set grant_id=gen_random_uuid(),grant_digest=p_token_digest,grant_artifact_id=p_artifact_id::text,grant_expires_at=least(expires_at,clock_timestamp()+interval '5 minutes') where organization_id=p_organization_id and id=p_job_id returning * into v_job;
 perform public.m14_03_audit(v_job,'download_authorized',v_job.grant_id);
 return jsonb_build_object('grantId',v_job.grant_id,'expiresAt',v_job.grant_expires_at,'downloadPath','/api/v1/exports/'||v_job.id||'/download/'||v_job.grant_id);
end $$;
create function public.m14_03_redeem_export_download_grant(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_grant_id uuid,p_token_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs; v_artifact jsonb;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id and id=p_job_id for update;
 if not found or not public.m14_03_snapshot_access(v_job) or v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or v_job.grant_expires_at<=clock_timestamp()
 or v_job.grant_id is distinct from p_grant_id or v_job.grant_digest is null or v_job.grant_digest is distinct from p_token_digest then raise exception 'export_access_denied' using errcode='42501'; end if;
 select p into v_artifact from jsonb_array_elements(v_job.parts) p where p->>'id'=v_job.grant_artifact_id;
 if v_artifact is null then raise exception 'export_access_denied' using errcode='42501'; end if;
 perform public.m14_03_audit(v_job,'download_started',p_grant_id);
 update public.export_jobs set grant_digest=null,grant_id=null,grant_expires_at=null where organization_id=p_organization_id and id=p_job_id;
 return jsonb_build_object('artifact',v_artifact-'startOrdinal'-'endOrdinal');
end $$;
create function public.m14_03_create_readiness_export(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_input jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select public.m14_03_create_export(p_organization_id,p_actor_user_id,p_session_id,jsonb_build_object('source','technical_files.readiness_report','format','report','scope','all_filtered','filters','{}'::jsonb,'context',jsonb_build_object('productId',p_input->>'productId'),'idempotencyKey',p_input->>'idempotencyKey'))
$$;

-- Every newly exposed RPC/helper is service-only, including trigger helpers.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'm14_03_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
