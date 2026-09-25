-- M5-07 correction: keyset note pagination must use the last ordered row,
-- not a lexicographic max of encoded cursor strings.

create or replace function public.list_finding_triage_notes(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_cursor text,p_limit integer default 50
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_after_created timestamptz; v_after_id uuid; v_rows jsonb; v_cursor text; v_has_more boolean;
begin
 if p_cursor is not null then
   begin select split_part(convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8'),'|',1)::timestamptz,
     split_part(convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8'),'|',2)::uuid into v_after_created,v_after_id;
   exception when others then return query select 'invalid_request'::text,null::jsonb; return; end;
 end if;
 if p_limit not between 1 and 100 or p_organization_id is null or p_actor_user_id is null or p_finding_id is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') or not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active') then return query select 'not_found'::text,null::jsonb; return; end if;
 with page as (
   select id,created_at
   from public.vulnerability_finding_notes
   where organization_id=p_organization_id and finding_id=p_finding_id
     and (p_cursor is null or (created_at,id)<(v_after_created,v_after_id))
   order by created_at desc,id desc
   limit p_limit+1
 ), visible as (
   select id,created_at from page order by created_at desc,id desc limit p_limit
 ), last_visible as (
   select id,created_at from visible order by created_at asc,id asc limit 1
 )
 select
   coalesce(jsonb_agg(public.m5_note_json(p_organization_id,visible.id) order by visible.created_at desc,visible.id desc),'[]'::jsonb),
   exists(select 1 from page offset p_limit),
   (select translate(trim(trailing '=' from replace(replace(encode(convert_to(last_visible.created_at::text||'|'||last_visible.id::text,'utf8'),'base64'),chr(10),''),chr(13),'')),'+/','-_') from last_visible)
 into v_rows,v_has_more,v_cursor
 from visible;
 return query select 'found'::text,jsonb_build_object('notes',v_rows,'nextCursor',case when v_has_more then v_cursor else null end);
end $$;

alter function public.list_finding_triage_notes(uuid,uuid,uuid,text,integer) owner to postgres;
revoke all on function public.list_finding_triage_notes(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_finding_triage_notes(uuid,uuid,uuid,text,integer) to service_role;
