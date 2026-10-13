-- The display projection follows an already authorized tenant deletion. This
-- grants no deletion authority and leaves source retention/audit gates intact.
alter table public.organization_usage_meters
 drop constraint organization_usage_meters_organization_id_fkey;
alter table public.organization_usage_meters
 add constraint organization_usage_meters_organization_id_fkey
 foreign key(organization_id) references public.organizations(id) on delete cascade;
-- FK cascades can remove the meter before a source DELETE trigger runs. Late
-- maintenance must not recreate the projection after its parent has gone.
do $$
declare definition text;anchor text:='perform public.m15_01_lock(p_organization_id);';
begin
 definition:=pg_get_functiondef('public.m15_02_rebuild_meter(uuid,boolean)'::regprocedure);
 if strpos(definition,anchor)=0 then raise exception 'm15_02_rebuild_lock_anchor_missing';end if;
 definition:=replace(definition,anchor,anchor||E'\n if not exists(select 1 from public.organizations where id=p_organization_id) then return;end if;');
 execute definition;
end $$;
notify pgrst,'reload schema';
