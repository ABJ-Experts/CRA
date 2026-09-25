-- M9-02: bounded, supplier-scoped evidence requests. This deliberately does
-- not extend the M3 SBOM portal: its component/SBOM disclosure contract is
-- materially narrower than an evidence request.

create table public.supplier_evidence_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  recipient_contact_id uuid not null,
  recipient_name text not null check (recipient_name=btrim(recipient_name) and char_length(recipient_name) between 1 and 160),
  recipient_email text not null check (recipient_email=btrim(recipient_email) and char_length(recipient_email) between 3 and 320 and recipient_email !~ '[[:cntrl:] ]+' and position('@' in recipient_email)>1),
  product_id uuid not null,
  internal_owner_user_id uuid not null references public.users(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft','open','closed','revoked')),
  version integer not null default 0 check (version>=0),
  current_revision_id uuid,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  closed_by_user_id uuid references public.users(id) on delete restrict,
  unique (organization_id,id),
  foreign key (organization_id,supplier_id) references public.supplier_organizations(organization_id,id) on delete restrict,
  foreign key (organization_id,recipient_contact_id) references public.supplier_contacts(organization_id,id) on delete restrict,
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict,
  check ((state in ('draft','open') and closed_at is null and closed_by_user_id is null) or (state in ('closed','revoked') and closed_at is not null and closed_by_user_id is not null))
);

create table public.supplier_evidence_request_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  revision_number integer not null check (revision_number>=1),
  portal_title text not null check (portal_title=btrim(portal_title) and char_length(portal_title) between 1 and 255 and portal_title !~ '[[:cntrl:]]'),
  instructions text not null check (instructions=btrim(instructions) and char_length(instructions) between 1 and 8000 and instructions !~ '[[:cntrl:]]'),
  due_at timestamptz not null,
  disclosure_payload jsonb not null check (jsonb_typeof(disclosure_payload)='object' and octet_length(disclosure_payload::text)<=32768),
  disclosure_digest text not null check (disclosure_digest ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,request_id,revision_number),
  foreign key (organization_id,request_id) references public.supplier_evidence_requests(organization_id,id) on delete restrict
);
alter table public.supplier_evidence_requests add constraint supplier_evidence_requests_current_revision_fk
  foreign key (organization_id,current_revision_id) references public.supplier_evidence_request_revisions(organization_id,id) on delete restrict;

create table public.supplier_evidence_request_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 50),
  title text not null check (title=btrim(title) and char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'),
  instructions text check (instructions is null or (instructions=btrim(instructions) and char_length(instructions) between 1 and 4000 and instructions !~ '[[:cntrl:]]')),
  document_class text not null check (document_class in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other')),
  required boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,revision_id,ordinal),
  foreign key (organization_id,revision_id) references public.supplier_evidence_request_revisions(organization_id,id) on delete restrict
);

create table public.supplier_evidence_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  revision_id uuid not null,
  token_prefix text not null check (token_prefix ~ '^cra_sev_[a-f0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'active' check (state in ('active','used','expired','revoked')),
  expires_at timestamptz not null,
  session_token_hash text unique check (session_token_hash is null or session_token_hash ~ '^[a-f0-9]{64}$'),
  session_expires_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.users(id) on delete restrict,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  foreign key (organization_id,request_id) references public.supplier_evidence_requests(organization_id,id) on delete restrict,
  foreign key (organization_id,revision_id) references public.supplier_evidence_request_revisions(organization_id,id) on delete restrict,
  check (expires_at>created_at),
  check ((state='active' and used_at is null and revoked_at is null and session_token_hash is null and session_expires_at is null)
    or (state='used' and used_at is not null and revoked_at is null and session_token_hash is not null and session_expires_at is not null)
    or (state='expired' and used_at is null and revoked_at is null and session_token_hash is null and session_expires_at is null)
    or (state='revoked' and revoked_at is not null))
);

create table public.supplier_evidence_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  revision_id uuid not null,
  request_item_id uuid not null,
  invitation_id uuid not null,
  evidence_document_id uuid not null,
  evidence_version_id uuid not null,
  original_filename text not null check (original_filename=btrim(original_filename) and char_length(original_filename) between 1 and 255 and original_filename !~ '[\\/[:cntrl:]]'),
  declared_media_type text not null check (declared_media_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain')),
  declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800),
  declared_sha256 text not null check (declared_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'uploading' check (state in ('uploading','scan_pending','submitted_pending_review','rejected','failed','cancelled')),
  supplier_visible_reason text check (supplier_visible_reason is null or (supplier_visible_reason=btrim(supplier_visible_reason) and char_length(supplier_visible_reason) between 1 and 500 and supplier_visible_reason !~ '[[:cntrl:]]')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,request_id,idempotency_key),
  unique (organization_id,evidence_version_id),
  foreign key (organization_id,request_id) references public.supplier_evidence_requests(organization_id,id) on delete restrict,
  foreign key (organization_id,revision_id) references public.supplier_evidence_request_revisions(organization_id,id) on delete restrict,
  foreign key (organization_id,request_item_id) references public.supplier_evidence_request_items(organization_id,id) on delete restrict,
  foreign key (organization_id,invitation_id) references public.supplier_evidence_invitations(organization_id,id) on delete restrict,
  foreign key (organization_id,evidence_document_id) references public.evidence_documents(organization_id,id) on delete restrict,
  foreign key (organization_id,evidence_version_id) references public.evidence_document_versions(organization_id,id) on delete restrict
);

create table public.supplier_evidence_request_commands (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict, idempotency_key uuid not null,
  operation text not null check (operation in ('create','revise','issue','reissue','revoke','close')),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'), result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(), unique(organization_id,actor_user_id,idempotency_key)
);

create index supplier_evidence_requests_supplier_idx on public.supplier_evidence_requests(organization_id,supplier_id,state,created_at desc,id);
create index supplier_evidence_invitations_active_idx on public.supplier_evidence_invitations(organization_id,request_id,expires_at) where state in ('active','used');
create index supplier_evidence_submissions_request_idx on public.supplier_evidence_submissions(organization_id,request_id,created_at desc,id);

create or replace function public.m9_02_internal_can(p_organization_id uuid,p_actor_user_id uuid,p_manage boolean)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
   and public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_suppliers')
   and public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
   and public.sbom_actor_can_view(p_organization_id,p_actor_user_id)
   and (not p_manage or public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_manage_suppliers'))
$$;

create or replace function public.m9_02_revision_json(p_organization_id uuid,p_revision_id uuid,p_portal boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'revisionNumber',r.revision_number,'title',r.portal_title,'instructions',nullif(r.instructions,''),
  'dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'disclosureContent',case when p_portal then null else r.disclosure_payload->>'content' end,'disclosureFingerprint',r.disclosure_digest,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'instructions',i.instructions,'documentClass',i.document_class,'position',i.ordinal-1) order by i.ordinal) from public.supplier_evidence_request_items i where i.organization_id=r.organization_id and i.revision_id=r.id),'[]'::jsonb),
  'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'createdBy',r.created_by_user_id)
 from public.supplier_evidence_request_revisions r where r.organization_id=p_organization_id and r.id=p_revision_id
$$;

create or replace function public.m9_02_invitation_json(p_organization_id uuid,p_invitation_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',i.id,'state',case when i.state='used' then 'active' else i.state end,'expiresAt',to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'issuedAt',to_char(i.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'revokedAt',case when i.revoked_at is null then null else to_char(i.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'revisionId',i.revision_id)
 from public.supplier_evidence_invitations i where i.organization_id=p_organization_id and i.id=p_invitation_id
$$;

create or replace function public.m9_02_request_summary_json(p_organization_id uuid,p_request_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',q.id,'supplierId',q.supplier_id,'recipientContactId',q.recipient_contact_id,'productId',q.product_id,'ownerUserId',q.internal_owner_user_id,'state',q.state,'version',q.version,
  'currentRevision',public.m9_02_revision_json(q.organization_id,q.current_revision_id,false),
  'activeInvitation',(select public.m9_02_invitation_json(q.organization_id,i.id) from public.supplier_evidence_invitations i where i.organization_id=q.organization_id and i.request_id=q.id and i.state in ('active','used') order by i.created_at desc limit 1),
  'createdAt',to_char(q.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(q.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 from public.supplier_evidence_requests q where q.organization_id=p_organization_id and q.id=p_request_id
$$;

create or replace function public.m9_02_request_json(p_organization_id uuid,p_request_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select public.m9_02_request_summary_json(q.organization_id,q.id) || jsonb_build_object(
  'revisions',coalesce((select jsonb_agg(public.m9_02_revision_json(q.organization_id,r.id) order by r.revision_number) from public.supplier_evidence_request_revisions r where r.organization_id=q.organization_id and r.request_id=q.id),'[]'::jsonb),
  'invitations',coalesce((select jsonb_agg(public.m9_02_invitation_json(q.organization_id,i.id) order by i.created_at desc) from public.supplier_evidence_invitations i where i.organization_id=q.organization_id and i.request_id=q.id),'[]'::jsonb))
 from public.supplier_evidence_requests q where q.organization_id=p_organization_id and q.id=p_request_id
$$;

create or replace function public.m9_02_validate_draft(p_organization_id uuid,p_actor_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare x jsonb; v_supplier uuid; v_contact uuid; v_product uuid; v_owner uuid; v_due timestamptz; v_items jsonb; v_disclosure jsonb; v_title text; v_instructions text;
begin
 if jsonb_typeof(p_payload)<>'object' then return null; end if;
 begin v_supplier:=(p_payload->>'supplierId')::uuid; v_contact:=(p_payload->>'recipientContactId')::uuid; v_product:=(p_payload->>'productId')::uuid; v_owner:=(p_payload->>'ownerUserId')::uuid; v_due:=(p_payload->>'dueAt')::timestamptz; exception when others then return null; end;
 v_title:=p_payload->>'title'; v_instructions:=coalesce(p_payload->>'instructions',''); v_items:=p_payload->'items'; v_disclosure:=jsonb_build_object('content',nullif(p_payload->>'disclosureContent',''));
 if v_title is null or v_title<>btrim(v_title) or char_length(v_title) not between 1 and 160 or v_title~'[[:cntrl:]]' or char_length(v_instructions)>10000 or v_instructions~'[[:cntrl:]]' or v_due<=clock_timestamp() or jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items) not between 1 and 25 or octet_length(v_disclosure::text)>32768 then return null; end if;
 if not exists(select 1 from public.supplier_organizations s where s.organization_id=p_organization_id and s.id=v_supplier and s.archived_at is null)
  or not exists(select 1 from public.supplier_contacts c where c.organization_id=p_organization_id and c.id=v_contact and c.supplier_id=v_supplier and c.archived_at is null and c.email is not null)
  or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=v_product and p.archived_at is null)
  or not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=v_owner) then return null; end if;
 for x in select value from jsonb_array_elements(v_items) loop
   if x->>'title' is null or x->>'title'<>btrim(x->>'title') or char_length(x->>'title') not between 1 and 160 or x->>'title'~'[[:cntrl:]]' or coalesce(x->>'documentClass','') not in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other') or (x ? 'instructions' and (x->>'instructions'<>btrim(x->>'instructions') or char_length(x->>'instructions')>2000 or x->>'instructions'~'[[:cntrl:]]')) then return null; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('title',x->>'title','instructions',coalesce(x->>'instructions',''),'documentClass',x->>'documentClass') order by ord) into v_items from jsonb_array_elements(v_items) with ordinality q(x,ord);
 return jsonb_build_object('supplierId',v_supplier,'recipientContactId',v_contact,'productId',v_product,'ownerUserId',v_owner,'title',v_title,'instructions',v_instructions,'dueAt',to_char(v_due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'disclosurePayload',v_disclosure,'items',v_items);
end $$;

create or replace function public.m9_02_current_draft(p_organization_id uuid,p_request_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('supplierId',q.supplier_id,'recipientContactId',q.recipient_contact_id,'productId',q.product_id,'ownerUserId',q.internal_owner_user_id,'title',r.portal_title,'instructions',r.instructions,'dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'disclosurePayload',r.disclosure_payload,
   'items',coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'instructions',coalesce(i.instructions,''),'documentClass',i.document_class) order by i.ordinal) from public.supplier_evidence_request_items i where i.organization_id=q.organization_id and i.revision_id=r.id),'[]'::jsonb))
 from public.supplier_evidence_requests q join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=q.current_revision_id where q.organization_id=p_organization_id and q.id=p_request_id
$$;

create or replace function public.preview_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_payload jsonb)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; f text;
begin
 if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if;
 d:=public.m9_02_validate_draft(p_organization_id,p_actor_user_id,p_payload); if d is null then return query select 'invalid_request',null::jsonb; return; end if;
 f:=encode(extensions.digest(d::text,'sha256'),'hex');
 return query select 'previewed',jsonb_build_object('fingerprint',f,'portalPayload',jsonb_build_object('title',d->>'title','instructions',nullif(d->>'instructions',''),'disclosureContent',d->'disclosurePayload'->>'content','dueAt',d->>'dueAt','items',(select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title',x->>'title','instructions',nullif(x->>'instructions',''),'documentClass',x->>'documentClass','position',ord-1) order by ord) from jsonb_array_elements(d->'items') with ordinality q(x,ord))));
end $$;

create or replace function public.m9_02_insert_revision(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_draft jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision_id uuid; v_number integer;
begin
 select coalesce(max(revision_number),0)+1 into v_number from public.supplier_evidence_request_revisions where organization_id=p_organization_id and request_id=p_request_id;
 insert into public.supplier_evidence_request_revisions(organization_id,request_id,revision_number,portal_title,instructions,due_at,disclosure_payload,disclosure_digest,created_by_user_id)
 values(p_organization_id,p_request_id,v_number,p_draft->>'title',coalesce(p_draft->>'instructions',''),(p_draft->>'dueAt')::timestamptz,p_draft->'disclosurePayload',encode(extensions.digest((p_draft->'disclosurePayload')::text,'sha256'),'hex'),p_actor_user_id) returning id into v_revision_id;
 insert into public.supplier_evidence_request_items(organization_id,revision_id,ordinal,title,instructions,document_class,required)
 select p_organization_id,v_revision_id,ord::integer,x->>'title',nullif(x->>'instructions',''),x->>'documentClass',coalesce((x->>'required')::boolean,true) from jsonb_array_elements(p_draft->'items') with ordinality q(x,ord);
 return v_revision_id;
end $$;

create or replace function public.create_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_payload jsonb,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; q public.supplier_evidence_requests%rowtype; rid uuid; dg text; old public.supplier_evidence_request_commands%rowtype;
begin
 if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if;
 d:=public.m9_02_validate_draft(p_organization_id,p_actor_user_id,p_payload); if p_idempotency_key is null or d is null then return query select 'invalid_request',null::jsonb; return; end if; dg:=encode(extensions.digest(d::text,'sha256'),'hex');
 select * into old from public.supplier_evidence_request_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key; if found then return query select case when old.operation='create' and old.request_digest=dg then 'replayed' else 'idempotency_conflict' end,old.result; return; end if;
 insert into public.supplier_evidence_requests(organization_id,supplier_id,recipient_contact_id,recipient_name,recipient_email,product_id,internal_owner_user_id,created_by_user_id) select p_organization_id,s.id,c.id,c.name,c.email,(d->>'productId')::uuid,(d->>'ownerUserId')::uuid,p_actor_user_id from public.supplier_organizations s join public.supplier_contacts c on c.organization_id=s.organization_id and c.id=(d->>'recipientContactId')::uuid where s.organization_id=p_organization_id and s.id=(d->>'supplierId')::uuid returning * into q;
 rid:=public.m9_02_insert_revision(p_organization_id,p_actor_user_id,q.id,d); update public.supplier_evidence_requests set current_revision_id=rid,updated_at=clock_timestamp() where organization_id=p_organization_id and id=q.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_request_created','supplier_evidence_request',q.id::text,jsonb_build_object('revisionId',rid,'disclosureDigest',encode(extensions.digest((d->'disclosurePayload')::text,'sha256'),'hex')));
 insert into public.supplier_evidence_request_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'create',dg,public.m9_02_request_json(p_organization_id,q.id));
 return query select 'created',public.m9_02_request_json(p_organization_id,q.id);
end $$;

create or replace function public.revise_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_payload jsonb,p_expected_version integer,p_preview_fingerprint text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.supplier_evidence_requests%rowtype; d jsonb; dg text; rid uuid; old public.supplier_evidence_request_commands%rowtype;
begin
 if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if; d:=public.m9_02_validate_draft(p_organization_id,p_actor_user_id,p_payload); if p_idempotency_key is null or p_preview_fingerprint !~ '^[a-f0-9]{64}$' or d is null then return query select 'invalid_request',null::jsonb; return; end if; dg:=encode(extensions.digest(d::text,'sha256'),'hex'); if dg<>p_preview_fingerprint then return query select 'conflict',jsonb_build_object('previewFingerprint',dg); return; end if;
 select * into old from public.supplier_evidence_request_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key; if found then return query select case when old.operation='revise' and old.request_digest=dg then 'replayed' else 'idempotency_conflict' end,old.result; return; end if;
 select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=p_request_id for update; if not found then return query select 'not_found',null::jsonb; return; end if; if q.state<>'draft' or q.version<>p_expected_version then return query select 'conflict',public.m9_02_request_json(p_organization_id,q.id); return; end if;
 update public.supplier_evidence_requests set supplier_id=(d->>'supplierId')::uuid,recipient_contact_id=(d->>'recipientContactId')::uuid,recipient_name=c.name,recipient_email=c.email,product_id=(d->>'productId')::uuid,internal_owner_user_id=(d->>'ownerUserId')::uuid,version=version+1,updated_at=clock_timestamp() from public.supplier_contacts c where c.organization_id=p_organization_id and c.id=(d->>'recipientContactId')::uuid and supplier_evidence_requests.organization_id=p_organization_id and supplier_evidence_requests.id=q.id;
 rid:=public.m9_02_insert_revision(p_organization_id,p_actor_user_id,q.id,d); update public.supplier_evidence_requests set current_revision_id=rid where organization_id=p_organization_id and id=q.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_request_revised','supplier_evidence_request',q.id::text,jsonb_build_object('revisionId',rid,'disclosureDigest',encode(extensions.digest((d->'disclosurePayload')::text,'sha256'),'hex')));
 insert into public.supplier_evidence_request_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'revise',dg,public.m9_02_request_json(p_organization_id,q.id)); return query select 'revised',public.m9_02_request_json(p_organization_id,q.id);
end $$;

create or replace function public.m9_02_issue_invitation(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,p_preview_fingerprint text,p_token_hash text,p_expires_at timestamptz,p_idempotency_key uuid,p_operation text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.supplier_evidence_requests%rowtype; r public.supplier_evidence_request_revisions%rowtype; i public.supplier_evidence_invitations%rowtype; dg text; old public.supplier_evidence_request_commands%rowtype; f text; response jsonb;
begin
 if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if;
 if p_token_hash !~ '^[a-f0-9]{64}$' or p_idempotency_key is null or p_preview_fingerprint !~ '^[a-f0-9]{64}$' then return query select 'invalid_request',null::jsonb; return; end if;
 select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=p_request_id for update; if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into r from public.supplier_evidence_request_revisions where organization_id=p_organization_id and id=q.current_revision_id;
 f:=encode(extensions.digest(public.m9_02_current_draft(p_organization_id,q.id)::text,'sha256'),'hex');
 dg:=encode(extensions.digest(jsonb_build_object('requestId',q.id,'revisionId',r.id,'expectedVersion',p_expected_version,'previewFingerprint',p_preview_fingerprint,'operation',p_operation)::text,'sha256'),'hex');
 select * into old from public.supplier_evidence_request_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key; if found then return query select case when old.operation=p_operation and old.request_digest=dg then 'replayed' else 'idempotency_conflict' end,old.result; return; end if;
 if p_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '7 days 1 minute' then return query select 'invalid_request',null::jsonb; return; end if;
 if q.state not in ('draft','open') or q.version<>p_expected_version or f<>p_preview_fingerprint then return query select 'conflict',jsonb_build_object('previewFingerprint',f); return; end if;
 update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=p_actor_user_id where organization_id=p_organization_id and request_id=q.id and state in ('active','used');
 insert into public.supplier_evidence_invitations(organization_id,request_id,revision_id,token_prefix,token_hash,expires_at,created_by_user_id) values(p_organization_id,q.id,r.id,'cra_sev_'||substr(p_token_hash,1,8),p_token_hash,p_expires_at,p_actor_user_id) returning * into i;
 update public.supplier_evidence_requests set state='open',version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=q.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_request_'||p_operation,'supplier_evidence_request',q.id::text,jsonb_build_object('invitationId',i.id,'revisionId',r.id,'disclosureDigest',r.disclosure_digest));
 response:=jsonb_build_object('request',public.m9_02_request_json(p_organization_id,q.id),'invitation',public.m9_02_invitation_json(p_organization_id,i.id),'recipientEmail',q.recipient_email);
 insert into public.supplier_evidence_request_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,p_operation,dg,response); return query select case when p_operation='issue' then 'issued' else 'reissued' end,response;
end $$;

create or replace function public.issue_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,p_preview_fingerprint text,p_token_hash text,p_expires_at timestamptz,p_idempotency_key uuid) returns table(outcome text,result jsonb) language sql security definer set search_path=public,pg_temp as $$ select * from public.m9_02_issue_invitation($1,$2,$3,$4,$5,$6,$7,$8,'issue') $$;
create or replace function public.reissue_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,p_preview_fingerprint text,p_token_hash text,p_expires_at timestamptz,p_idempotency_key uuid) returns table(outcome text,result jsonb) language sql security definer set search_path=public,pg_temp as $$ select * from public.m9_02_issue_invitation($1,$2,$3,$4,$5,$6,$7,$8,'reissue') $$;

create or replace function public.revoke_supplier_evidence_invitation_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_invitation_id uuid,p_expected_version integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.supplier_evidence_requests%rowtype; i public.supplier_evidence_invitations%rowtype; dg text;
begin if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if; if p_idempotency_key is null then return query select 'invalid_request',null::jsonb; return; end if; select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=p_request_id for update; select * into i from public.supplier_evidence_invitations where organization_id=p_organization_id and id=p_invitation_id and request_id=p_request_id for update; if q.id is null or i.id is null then return query select 'not_found',null::jsonb; return; end if; if q.version<>p_expected_version then return query select 'conflict',public.m9_02_request_json(p_organization_id,q.id); return; end if; update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=p_actor_user_id where id=i.id and state in ('active','used'); update public.supplier_evidence_requests set version=version+1,updated_at=clock_timestamp() where id=q.id; insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_invitation_revoked','supplier_evidence_invitation',i.id::text,jsonb_build_object('requestId',q.id)); return query select 'revoked',public.m9_02_request_json(p_organization_id,q.id); end $$;

create or replace function public.close_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.supplier_evidence_requests%rowtype;
begin if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true) then return query select 'forbidden',null::jsonb; return; end if; if p_idempotency_key is null then return query select 'invalid_request',null::jsonb; return; end if; select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=p_request_id for update; if not found then return query select 'not_found',null::jsonb; return; end if; if q.version<>p_expected_version or q.state in ('closed','revoked') then return query select 'conflict',public.m9_02_request_json(p_organization_id,q.id); return; end if; update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=p_actor_user_id where organization_id=p_organization_id and request_id=q.id and state in ('active','used'); update public.supplier_evidence_requests set state='closed',closed_at=clock_timestamp(),closed_by_user_id=p_actor_user_id,version=version+1,updated_at=clock_timestamp() where id=q.id; insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_request_closed','supplier_evidence_request',q.id::text,'{}'); return query select 'closed',public.m9_02_request_json(p_organization_id,q.id); end $$;

create or replace function public.list_supplier_evidence_requests_atomic(p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_limit integer,p_cursor uuid default null)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;
begin if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,false) then return query select 'forbidden',null::jsonb; return; end if; if p_limit not between 1 and 100 or (p_supplier_id is not null and not exists(select 1 from public.supplier_organizations s where s.organization_id=p_organization_id and s.id=p_supplier_id)) then return query select 'invalid_request',null::jsonb; return; end if; select coalesce(jsonb_agg(public.m9_02_request_summary_json(p_organization_id,x.id) order by x.id),'[]'::jsonb) into v_items from (select q.id from public.supplier_evidence_requests q where q.organization_id=p_organization_id and (p_supplier_id is null or q.supplier_id=p_supplier_id) and (p_cursor is null or q.id>p_cursor) order by q.id limit p_limit) x; return query select 'found',jsonb_build_object('requests',v_items,'nextCursor',case when jsonb_array_length(v_items)=p_limit then v_items->(p_limit-1)->>'id' else null end); end $$;
create or replace function public.get_supplier_evidence_request_atomic(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$ begin if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,false) then return query select 'forbidden',null::jsonb; return; end if; if not exists(select 1 from public.supplier_evidence_requests where organization_id=p_organization_id and id=p_request_id) then return query select 'not_found',null::jsonb; return; end if; return query select 'found',public.m9_02_request_json(p_organization_id,p_request_id); end $$;

create or replace function public.redeem_supplier_evidence_invitation_atomic(p_invitation_token_hash text,p_session_token_hash text,p_session_expires_at timestamptz)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.supplier_evidence_invitations%rowtype; q public.supplier_evidence_requests%rowtype;
 begin if p_invitation_token_hash !~ '^[a-f0-9]{64}$' or p_session_token_hash !~ '^[a-f0-9]{64}$' or p_session_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '30 minutes' then return query select 'not_found',null::jsonb; return; end if; select * into i from public.supplier_evidence_invitations where token_hash=p_invitation_token_hash for update; if not found then return query select 'not_found',null::jsonb; return; end if; select * into q from public.supplier_evidence_requests where organization_id=i.organization_id and id=i.request_id for share; if not found or q.state<>'open' then return query select 'not_found',null::jsonb; return; end if; if i.state='active' and i.expires_at>clock_timestamp() then update public.supplier_evidence_invitations set state='used',used_at=clock_timestamp(),session_token_hash=p_session_token_hash,session_expires_at=p_session_expires_at where id=i.id; elsif i.state='used' and i.session_token_hash=p_session_token_hash and i.session_expires_at>clock_timestamp() then null; else if i.state='active' then update public.supplier_evidence_invitations set state='expired' where id=i.id; end if; return query select 'not_found',null::jsonb; return; end if; return query select 'created',jsonb_build_object('expiresAt',to_char(p_session_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'request',public.m9_02_portal_json(i.organization_id,i.id)); end $$;

create or replace function public.m9_02_portal_json(p_organization_id uuid,p_invitation_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('requestReference','request-'||left(replace(i.request_id::text,'-',''),12),'title',r.portal_title,'instructions',nullif(r.instructions,''),'disclosureContent',r.disclosure_payload->>'content','dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'instructions',x.instructions,'documentClass',x.document_class,'position',x.ordinal-1) order by x.ordinal) from public.supplier_evidence_request_items x where x.organization_id=i.organization_id and x.revision_id=i.revision_id),'[]'::jsonb),
   'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'checklistItemId',s.request_item_id,'state',s.state,'fileName',s.original_filename,'mediaType',s.declared_media_type,'byteSize',s.declared_size_bytes,'sha256',s.declared_sha256,'rejectionReason',s.supplier_visible_reason,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by s.created_at) from public.supplier_evidence_submissions s where s.organization_id=i.organization_id and s.invitation_id=i.id),'[]'::jsonb))
 from public.supplier_evidence_invitations i join public.supplier_evidence_request_revisions r on r.organization_id=i.organization_id and r.id=i.revision_id where i.organization_id=p_organization_id and i.id=p_invitation_id
$$;
create or replace function public.get_supplier_evidence_portal_request_atomic(p_session_token_hash text) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$ declare i public.supplier_evidence_invitations%rowtype; q public.supplier_evidence_requests%rowtype; begin if p_session_token_hash !~ '^[a-f0-9]{64}$' then return query select 'not_found',null::jsonb; return; end if; select * into i from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share; if not found then return query select 'not_found',null::jsonb; return; end if; select * into q from public.supplier_evidence_requests where organization_id=i.organization_id and id=i.request_id and state='open'; if not found then return query select 'not_found',null::jsonb; return; end if; return query select 'found',public.m9_02_portal_json(i.organization_id,i.id); end $$;

-- This is intentionally a service-to-service handoff. The API uses it to
-- inspect a private object after upload; the browser contract never receives
-- a storage key, declared hash, or organization identifier.
create or replace function public.get_supplier_evidence_submission_upload_atomic(p_session_token_hash text,p_version_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare i public.supplier_evidence_invitations%rowtype; s public.supplier_evidence_submissions%rowtype; v public.evidence_document_versions%rowtype;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' then return query select 'not_found',null::jsonb; return; end if;
 select * into i from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select s.* into s from public.supplier_evidence_submissions s join public.supplier_evidence_requests q on q.organization_id=s.organization_id and q.id=s.request_id and q.state='open' where s.organization_id=i.organization_id and s.invitation_id=i.id and s.evidence_version_id=p_version_id and s.state='uploading';
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into v from public.evidence_document_versions where organization_id=i.organization_id and id=s.evidence_version_id and processing_state='uploading' and upload_expires_at>clock_timestamp();
 if not found then return query select 'conflict',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('versionId',v.id,'objectBucket',v.object_bucket,'objectKey',v.object_key,'declaredByteSize',v.declared_size_bytes,'fileName',v.original_filename,'expiresAt',v.upload_expires_at);
end $$;

create or replace function public.reserve_supplier_evidence_submission_atomic(p_session_token_hash text,p_request_item_id uuid,p_original_filename text,p_declared_size_bytes bigint,p_declared_media_type text,p_declared_sha256 text,p_object_key text,p_upload_expires_at timestamptz,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.supplier_evidence_invitations%rowtype; q public.supplier_evidence_requests%rowtype; it public.supplier_evidence_request_items%rowtype; s public.supplier_evidence_submissions%rowtype; r record;
begin if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_original_filename is null or p_original_filename<>btrim(p_original_filename) or char_length(p_original_filename) not between 1 and 255 or p_original_filename~'[\\/[:cntrl:]]' or p_declared_size_bytes not between 1 and 52428800 or p_declared_media_type not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain') or p_declared_sha256 !~ '^[a-f0-9]{64}$' or p_object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$' or p_upload_expires_at not between clock_timestamp()+interval '1 minute' and clock_timestamp()+interval '30 minutes' then return query select 'not_found',null::jsonb; return; end if; select * into i from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share; select * into q from public.supplier_evidence_requests where organization_id=i.organization_id and id=i.request_id and state='open' for share; select * into it from public.supplier_evidence_request_items where organization_id=i.organization_id and id=p_request_item_id and revision_id=i.revision_id; if i.id is null or q.id is null or it.id is null then return query select 'not_found',null::jsonb; return; end if; select * into s from public.supplier_evidence_submissions where organization_id=i.organization_id and request_id=q.id and idempotency_key=p_idempotency_key for update; if found then return query select case when s.request_digest=p_request_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('submission',jsonb_build_object('id',s.id,'checklistItemId',s.request_item_id,'state',s.state,'fileName',s.original_filename,'mediaType',s.declared_media_type,'byteSize',s.declared_size_bytes,'sha256',s.declared_sha256,'rejectionReason',s.supplier_visible_reason,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'versionId',s.evidence_version_id,'objectKey',(select object_key from public.evidence_document_versions where organization_id=s.organization_id and id=s.evidence_version_id)); return; end if; select * into r from public.reserve_evidence_document_upload_atomic(i.organization_id,q.internal_owner_user_id,it.title,it.document_class,q.internal_owner_user_id,array[q.product_id],null,null,p_original_filename,p_declared_size_bytes,p_object_key,least(p_upload_expires_at,i.session_expires_at),p_idempotency_key,p_request_digest); if r.outcome not in ('reserved','replayed') then return query select r.outcome,r.result; return; end if; insert into public.supplier_evidence_submissions(organization_id,request_id,revision_id,request_item_id,invitation_id,evidence_document_id,evidence_version_id,original_filename,declared_media_type,declared_size_bytes,declared_sha256,idempotency_key,request_digest) values(i.organization_id,q.id,i.revision_id,it.id,i.id,(r.result->>'documentId')::uuid,(r.result->>'versionId')::uuid,p_original_filename,p_declared_media_type,p_declared_size_bytes,p_declared_sha256,p_idempotency_key,p_request_digest) returning * into s; insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(i.organization_id,'supplier.evidence_submission_reserved','supplier_evidence_submission',s.id::text,jsonb_build_object('requestId',q.id,'requestItemId',it.id)); return query select 'reserved',jsonb_build_object('submission',jsonb_build_object('id',s.id,'checklistItemId',s.request_item_id,'state',s.state,'fileName',s.original_filename,'mediaType',s.declared_media_type,'byteSize',s.declared_size_bytes,'sha256',s.declared_sha256,'rejectionReason',s.supplier_visible_reason,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'versionId',s.evidence_version_id,'objectKey',p_object_key,'expiresAt',least(p_upload_expires_at,i.session_expires_at)); end $$;

create or replace function public.finalize_supplier_evidence_submission_atomic(p_session_token_hash text,p_version_id uuid,p_actual_size bigint,p_media_type text,p_sha256 text,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.supplier_evidence_invitations%rowtype; s public.supplier_evidence_submissions%rowtype; r record;
begin if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then return query select 'not_found',null::jsonb; return; end if; select * into i from public.supplier_evidence_invitations where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share; select s.* into s from public.supplier_evidence_submissions s join public.supplier_evidence_requests q on q.organization_id=s.organization_id and q.id=s.request_id and q.state='open' where s.organization_id=i.organization_id and s.invitation_id=i.id and s.evidence_version_id=p_version_id and s.idempotency_key=p_idempotency_key for update; if i.id is null or s.id is null then return query select 'not_found',null::jsonb; return; end if; select * into r from public.finalize_evidence_document_upload_atomic(i.organization_id,(select internal_owner_user_id from public.supplier_evidence_requests where organization_id=i.organization_id and id=s.request_id),p_version_id,p_actual_size,p_media_type,p_sha256,p_idempotency_key,p_request_digest); update public.supplier_evidence_submissions set state=case when r.outcome in ('scan_pending','replayed') then 'scan_pending' when r.outcome='failed' then 'failed' else state end,supplier_visible_reason=case when r.outcome='failed' then 'Upload could not be verified. Select the file again and retry.' else supplier_visible_reason end,updated_at=clock_timestamp() where id=s.id; return query select case when r.outcome='scan_pending' then 'queued' when r.outcome='failed' then 'rejected' else r.outcome end,jsonb_build_object('submission',jsonb_build_object('id',s.id,'checklistItemId',s.request_item_id,'state',case when r.outcome in ('scan_pending','replayed') then 'scan_pending' when r.outcome='failed' then 'failed' else s.state end,'fileName',s.original_filename,'mediaType',s.declared_media_type,'byteSize',s.declared_size_bytes,'sha256',s.declared_sha256,'rejectionReason',case when r.outcome='failed' then 'Upload could not be verified. Select the file again and retry.' else s.supplier_visible_reason end,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))); end $$;

create or replace function public.m9_02_sync_submission_scan() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if old.processing_state is distinct from new.processing_state and new.processing_state in ('clean','quarantined','failed') then update public.supplier_evidence_submissions set state=case new.processing_state when 'clean' then 'submitted_pending_review' when 'quarantined' then 'rejected' else 'failed' end,supplier_visible_reason=case new.processing_state when 'quarantined' then 'The uploaded file was rejected by security screening.' when 'failed' then 'The uploaded file could not be processed. Select the file again and retry.' else null end,updated_at=clock_timestamp() where organization_id=new.organization_id and evidence_version_id=new.id and state in ('uploading','scan_pending'); end if; return new; end $$;
create trigger m9_02_sync_supplier_submission_scan after update of processing_state on public.evidence_document_versions for each row execute function public.m9_02_sync_submission_scan();

alter table public.supplier_evidence_requests enable row level security; alter table public.supplier_evidence_request_revisions enable row level security; alter table public.supplier_evidence_request_items enable row level security; alter table public.supplier_evidence_invitations enable row level security; alter table public.supplier_evidence_submissions enable row level security; alter table public.supplier_evidence_request_commands enable row level security;
revoke all on table public.supplier_evidence_requests,public.supplier_evidence_request_revisions,public.supplier_evidence_request_items,public.supplier_evidence_invitations,public.supplier_evidence_submissions,public.supplier_evidence_request_commands from public,anon,authenticated;
grant select,insert,update on table public.supplier_evidence_requests,public.supplier_evidence_request_revisions,public.supplier_evidence_request_items,public.supplier_evidence_invitations,public.supplier_evidence_submissions,public.supplier_evidence_request_commands to service_role;
alter function public.m9_02_internal_can(uuid,uuid,boolean) owner to postgres; alter function public.m9_02_revision_json(uuid,uuid,boolean) owner to postgres; alter function public.m9_02_invitation_json(uuid,uuid) owner to postgres; alter function public.m9_02_request_summary_json(uuid,uuid) owner to postgres; alter function public.m9_02_request_json(uuid,uuid) owner to postgres; alter function public.m9_02_validate_draft(uuid,uuid,jsonb) owner to postgres; alter function public.m9_02_current_draft(uuid,uuid) owner to postgres; alter function public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb) owner to postgres; alter function public.m9_02_insert_revision(uuid,uuid,uuid,jsonb) owner to postgres; alter function public.create_supplier_evidence_request_atomic(uuid,uuid,jsonb,uuid) owner to postgres; alter function public.revise_supplier_evidence_request_atomic(uuid,uuid,uuid,jsonb,integer,text,uuid) owner to postgres; alter function public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text) owner to postgres; alter function public.issue_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,text,text,timestamptz,uuid) owner to postgres; alter function public.reissue_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,text,text,timestamptz,uuid) owner to postgres; alter function public.revoke_supplier_evidence_invitation_atomic(uuid,uuid,uuid,uuid,integer,uuid) owner to postgres; alter function public.close_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,uuid) owner to postgres; alter function public.list_supplier_evidence_requests_atomic(uuid,uuid,uuid,integer,uuid) owner to postgres; alter function public.get_supplier_evidence_request_atomic(uuid,uuid,uuid) owner to postgres; alter function public.redeem_supplier_evidence_invitation_atomic(text,text,timestamptz) owner to postgres; alter function public.m9_02_portal_json(uuid,uuid) owner to postgres; alter function public.get_supplier_evidence_portal_request_atomic(text) owner to postgres; alter function public.get_supplier_evidence_submission_upload_atomic(text,uuid) owner to postgres; alter function public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text) owner to postgres; alter function public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text) owner to postgres; alter function public.m9_02_sync_submission_scan() owner to postgres;
revoke all on function public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb),public.create_supplier_evidence_request_atomic(uuid,uuid,jsonb,uuid),public.revise_supplier_evidence_request_atomic(uuid,uuid,uuid,jsonb,integer,text,uuid),public.issue_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,text,text,timestamptz,uuid),public.reissue_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,text,text,timestamptz,uuid),public.revoke_supplier_evidence_invitation_atomic(uuid,uuid,uuid,uuid,integer,uuid),public.close_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,uuid),public.list_supplier_evidence_requests_atomic(uuid,uuid,uuid,integer,uuid),public.get_supplier_evidence_request_atomic(uuid,uuid,uuid),public.redeem_supplier_evidence_invitation_atomic(text,text,timestamptz),public.get_supplier_evidence_portal_request_atomic(text),public.get_supplier_evidence_submission_upload_atomic(text,uuid),public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text),public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb),public.create_supplier_evidence_request_atomic(uuid,uuid,jsonb,uuid),public.revise_supplier_evidence_request_atomic(uuid,uuid,uuid,jsonb,integer,text,uuid),public.issue_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,text,text,timestamptz,uuid),public.reissue_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,text,text,timestamptz,uuid),public.revoke_supplier_evidence_invitation_atomic(uuid,uuid,uuid,uuid,integer,uuid),public.close_supplier_evidence_request_atomic(uuid,uuid,uuid,integer,uuid),public.list_supplier_evidence_requests_atomic(uuid,uuid,uuid,integer,uuid),public.get_supplier_evidence_request_atomic(uuid,uuid,uuid),public.redeem_supplier_evidence_invitation_atomic(text,text,timestamptz),public.get_supplier_evidence_portal_request_atomic(text),public.get_supplier_evidence_submission_upload_atomic(text,uuid),public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text),public.finalize_supplier_evidence_submission_atomic(text,uuid,bigint,text,text,uuid,text) to service_role;
notify pgrst,'reload schema';
