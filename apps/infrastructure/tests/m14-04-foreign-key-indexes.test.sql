begin;
do $$
declare missing text;
begin
 select string_agg(c.conname, ', ' order by c.conname) into missing
 from pg_constraint c
 where c.contype='f' and c.conrelid in
 ('public.report_definitions'::regclass,'public.report_runs'::regclass,'public.report_run_recipients'::regclass)
 and not exists (
  select 1 from pg_index i where i.indrelid=c.conrelid
  and i.indisvalid and i.indisready and i.indpred is null
  and array(select key.attnum from unnest(i.indkey) with ordinality key(attnum,position)
            where key.position<=cardinality(c.conkey) order by key.position)=c.conkey
 );
 if missing is not null then raise exception 'report foreign keys missing leading indexes: %',missing;end if;
end $$;
rollback;
