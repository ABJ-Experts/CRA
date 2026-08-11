-- The worker registry deliberately exports invitations after memberships.
-- Keep snapshot source IDs and the static registry in exact agreement so an
-- export cannot silently omit this existing tenant-scoped table.
update public.organization_export_sources
   set sort_order = sort_order + 1
 where sort_order >= 4;

insert into public.organization_export_sources (source_id, enabled, sort_order)
values ('invitations', true, 4)
on conflict (source_id) do update
  set enabled = excluded.enabled,
      sort_order = excluded.sort_order;
