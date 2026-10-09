-- Normalize a recognized pre-123816 projection variant without rewriting its
-- recorded migration or source evidence. Canonical deployments already have
-- these source labels and baseline bounds; they assert the postcondition only.
-- Negative durations remain exclusions, never mean values or invented history.
do $migration$
declare definition text;changed text;old_anchor text;canonical_anchor text;old_count integer;canonical_count integer;filter_count integer;
begin
 definition:=pg_get_functiondef('public.get_dashboard_trends(uuid,uuid,jsonb,jsonb)'::regprocedure);
 old_anchor:='count(*)filter(where value<0)excluded_count';
 canonical_anchor:='count(*)filter(where value<0 and d.at>=baseline)excluded_count';
 old_count:=(length(definition)-length(replace(definition,old_anchor,'')))/length(old_anchor);
 canonical_count:=(length(definition)-length(replace(definition,canonical_anchor,'')))/length(canonical_anchor);
 if old_count not in(0,2)or canonical_count<>2-old_count then raise exception 'M14-02 unrecognized negative aggregate variant old %, canonical %',old_count,canonical_count;end if;
 changed:=replace(definition,old_anchor,canonical_anchor);
 if changed<>definition then execute changed;end if;
 definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 old_anchor:=$anchor$case when metric='triage'then'first_triage'when metric='remediation'then'applied_remediation'else'observation'end kind$anchor$;
 canonical_anchor:=$anchor$case when extract(epoch from(case metric when'triage'then(f.payload->>'triagedAt')::timestamptz else(f.payload->>'fixedAt')::timestamptz end-(f.payload->>'firstDetectedAt')::timestamptz))<0 then 'excluded_negative_'||metric when metric='triage'then'first_triage'when metric='remediation'then'applied_remediation'else'observation'end kind$anchor$;
 -- The short old expression is also the suffix of the canonical expression.
 canonical_count:=(length(definition)-length(replace(definition,canonical_anchor,'')))/length(canonical_anchor);
 changed:=replace(definition,canonical_anchor,'__M14_CANONICAL_NEGATIVE_SOURCE__');
 old_count:=(length(changed)-length(replace(changed,old_anchor,'')))/length(old_anchor);
 if old_count not in(0,2)or canonical_count<>2-old_count then raise exception 'M14-02 unrecognized negative source variant old %, canonical %',old_count,canonical_count;end if;
 changed:=replace(changed,old_anchor,canonical_anchor);
 changed:=replace(changed,'__M14_CANONICAL_NEGATIVE_SOURCE__',canonical_anchor);
 old_anchor:=$anchor$and extract(epoch from(case metric when'triage'then(f.payload->>'triagedAt')::timestamptz else(f.payload->>'fixedAt')::timestamptz end-(f.payload->>'firstDetectedAt')::timestamptz))>=0$anchor$;
 filter_count:=(length(changed)-length(replace(changed,old_anchor,'')))/length(old_anchor);
 if filter_count<>old_count then raise exception 'M14-02 inconsistent legacy negative filter count %, expected %',filter_count,old_count;end if;
 changed:=replace(changed,old_anchor,'');
 if changed<>definition then execute changed;end if;
end $migration$;
