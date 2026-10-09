-- A predecessor must ultimately point to its successor, but a normal CHECK is
-- immediate and cannot represent the safe retire-then-insert transaction used by
-- the active-period unique index. A deferred constraint trigger verifies the
-- committed row instead.

alter table public.product_support_periods
  drop constraint if exists product_support_periods_check1;

alter table public.product_support_periods
  add constraint product_support_periods_supersession_shape_check
  check (
    (superseded_at is null and superseded_by_id is null)
    or superseded_at is not null
  );

alter table public.product_support_periods
  add constraint product_support_periods_no_self_supersession_check
  check (superseded_by_id is null or superseded_by_id <> id);

create or replace function public.m2_assert_support_period_supersession_link()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_period public.product_support_periods%rowtype;
begin
  select * into v_period from public.product_support_periods where id = new.id;
  if found and v_period.superseded_at is not null and v_period.superseded_by_id is null then
    raise exception 'superseded support period requires a successor link'
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists product_support_period_supersession_link_trigger on public.product_support_periods;
create constraint trigger product_support_period_supersession_link_trigger
after insert or update on public.product_support_periods
deferrable initially deferred
for each row execute function public.m2_assert_support_period_supersession_link();

alter function public.m2_assert_support_period_supersession_link() owner to postgres;
revoke all on function public.m2_assert_support_period_supersession_link() from public, anon, authenticated;
