-- Future-start evidence is a distinct actionable gap, not generic unavailable.
alter table public.framework_coverage_rows
  drop constraint framework_coverage_rows_status_check,
  add constraint framework_coverage_rows_status_check
    check(status in ('structural','excluded','evidence_backed','no_mapping',
      'unimplemented','missing_evidence','expired_evidence',
      'not_yet_valid_evidence','quarantined_evidence','unavailable_evidence'));

do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.m10_recalculate_coverage_scope(uuid,uuid,uuid,text,text)'::regprocedure)
  into v_definition;
  if position($text$coalesce(bool_or(v.validity_ends_on<v_today and v.processing_state='clean'),false) expired,$text$ in v_definition)=0
    or position('bool_or(expired) expired,bool_or(quarantined) quarantined,' in v_definition)=0
    or position($text$when coalesce(g.expired,false) then 'expired_evidence'$text$ in v_definition)=0 then
    raise exception 'M10 coverage validity anchor missing';
  end if;
  v_definition:=replace(v_definition,
    $text$coalesce(bool_or(v.validity_ends_on<v_today and v.processing_state='clean'),false) expired,$text$,
    $text$coalesce(bool_or(v.validity_ends_on<v_today and v.processing_state='clean'),false) expired,$text$||chr(10)||
    $text$      coalesce(bool_or(v.validity_starts_on>v_today and v.processing_state='clean'),false) future,$text$);
  v_definition:=replace(v_definition,
    'bool_or(expired) expired,bool_or(quarantined) quarantined,',
    'bool_or(expired) expired,bool_or(future) future,bool_or(quarantined) quarantined,');
  v_definition:=replace(v_definition,
    $text$when coalesce(g.expired,false) then 'expired_evidence'$text$,
    $text$when coalesce(g.future,false) then 'not_yet_valid_evidence'$text$||chr(10)||
    $text$      when coalesce(g.expired,false) then 'expired_evidence'$text$);
  execute v_definition;
end $$;
