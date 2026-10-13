-- Trusted source fixtures bypass only incumbent licence admission while inserted.
-- No licence state/artifact is created; all trigger/constraint changes roll back.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 check: %',label;end if;end $$;
alter table public.invitations disable trigger m15_invitation_growth;
alter table public.invitations drop constraint invitations_email_lower;
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;email text;before_count bigint;first uuid:=gen_random_uuid();second uuid:=gen_random_uuid();member_match uuid:=gen_random_uuid();r jsonb;v bigint;
begin
 select id,u.email into a,email from public.users u where u.email='owner@cra.test';
 select reserved_invitations into before_count from public.organization_usage_meters where organization_id=o;
 insert into public.invitations(id,organization_id,invited_by,email,token_hash,expires_at) values
 (first,o,a,'m15-02-case@example.test',repeat('1',64),clock_timestamp()+interval '1 hour'),
 (second,o,a,'M15-02-CASE@example.test',repeat('2',64),clock_timestamp()+interval '1 hour'),
 (member_match,o,a,upper(email),repeat('3',64),clock_timestamp()+interval '1 hour');
 perform pg_temp.check('case variants reserve one seat and active email none',(select reserved_invitations=before_count+1 from public.organization_usage_meters where organization_id=o));
 update public.invitations set expires_at=clock_timestamp()+interval '20 milliseconds' where id in (first,second);
 perform pg_sleep(0.03);
 r:=public.m15_02_read_usage(o,a,null);
 perform pg_temp.check('due expiry refreshes distinct reservations',(r->'components'->>'reservedInvitations')::bigint=before_count);
 select meter_version into v from public.organization_usage_meters where organization_id=o;
 perform public.m15_02_read_usage(o,a,null);
 perform pg_temp.check('hot reads do not recount when checkpoint not due',(select meter_version=v from public.organization_usage_meters where organization_id=o));
 update public.users set email='M15-02-CASE@example.test' where id=a;
 perform pg_temp.check('global active email change updates reservation matching',(select reserved_invitations=before_count+1 from public.organization_usage_meters where organization_id=o));
end $$;
alter table public.invitations enable trigger m15_invitation_growth;
rollback;
