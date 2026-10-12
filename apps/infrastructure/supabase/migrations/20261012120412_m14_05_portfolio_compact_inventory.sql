-- Compact canonical identity scalars and count inventory exclusions in one pass.
-- Count distinct products/releases directly; scope selected-identity release deduplication
-- to detail. Canonical byte ordering and policy revision reject pre-rollout continuations.
-- Drive source finding associations from the authorized finding set, not each inventory row.
-- Empty source evidence skips sparse matching joins; detail-only identity lookup stays lazy.
create or replace function public.get_portfolio_projection(p_org uuid,p_actor uuid,p_endpoint text,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set jit=off as $$
declare sb boolean; fi boolean; rd boolean; feed boolean; lim integer; archived boolean; product uuid; entity uuid;
 v jsonb; rev text; pos jsonb; result jsonb; rows jsonb; n integer;
begin
 if not public.m14_actor_can(p_org,p_actor,'can_view_dashboards')or not public.m14_actor_can(p_org,p_actor,'can_view_products')then return jsonb_build_object('outcome','not_found');end if;
 if p_endpoint not in('products','concentration','detail')or jsonb_typeof(p_filters)<>'object'then return jsonb_build_object('outcome','invalid_request');end if;
 begin
 lim:=coalesce((p_filters->>'limit')::integer,20);archived:=coalesce((p_filters->>'includeArchived')::boolean,false);
 product:=(p_filters->>'productId')::uuid;entity:=(p_filters->>'legalEntityId')::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('outcome','invalid_request');end;
 if lim not between 1 and 100 then return jsonb_build_object('outcome','invalid_request');end if;
 if product is not null and not exists(select 1 from public.products where organization_id=p_org and id=product and(archived or archived_at is null))then return jsonb_build_object('outcome','not_found');end if;
 if entity is not null and not exists(select 1 from public.organization_legal_entities where organization_id=p_org and id=entity and deleted_at is null)then return jsonb_build_object('outcome','not_found');end if;
 sb:=public.m14_actor_can(p_org,p_actor,'can_view_sboms')and coalesce((p_filters#>>'{sourceAccess,sbomCoverage}')::boolean,true);
 fi:=public.m14_actor_can(p_org,p_actor,'can_view_findings')and coalesce((p_filters#>>'{sourceAccess,findings}')::boolean,true);
 rd:=public.m14_actor_can(p_org,p_actor,'can_view_technical_files')and coalesce((p_filters#>>'{sourceAccess,readiness}')::boolean,true);
 feed:=fi and coalesce((p_filters#>>'{sourceAccess,feeds}')::boolean,true);
 if p_endpoint='detail'and not sb then return jsonb_build_object('outcome','forbidden');end if;
 with scoped_products as materialized(
 select p.*,le.display_name entity_name from public.products p left join public.organization_legal_entities le on le.organization_id=p_org and le.id=p.legal_entity_id and le.deleted_at is null
 where p.organization_id=p_org and(archived or p.archived_at is null)and(product is null or p.id=product)and(entity is null or p.legal_entity_id=entity)),
 releases as materialized(select r.*from public.product_releases r join scoped_products p on p.id=r.product_id
 where r.organization_id=p_org and(archived or r.archived_at is null)and r.placed_on_market_at is not null and r.lifecycle not in('development','withdrawn')),
 valid_documents as materialized(
 select distinct r.id release_id,r.product_id,d.id document_id,d.source_id canonical_source_id,s.id source_id,s.supersedes_source_id,to_jsonb(s) source_revision,to_jsonb(d) document_revision,to_jsonb(j) job_revision,to_jsonb(l) link_revision
 from releases r join public.sbom_document_sources l on sb and l.organization_id=p_org and l.release_id=r.id
 join public.sbom_sources s on s.organization_id=p_org and s.id=l.source_id and s.release_id=r.id and s.product_id=r.product_id
 join public.sbom_documents d on d.organization_id=p_org and d.id=l.document_id
 join public.sbom_ingest_jobs j on j.organization_id=p_org and j.id=d.ingest_job_id and j.source_id=d.source_id and j.release_id=r.id
 join public.sbom_sources canonical on canonical.organization_id=p_org and canonical.id=d.source_id and canonical.status='verified'and canonical.verified_at is not null and canonical.raw_object_id=d.raw_object_id and canonical.release_id=s.release_id and canonical.product_id=s.product_id
 where s.status='verified'and s.verified_at is not null and d.state='completed'and d.completed_at is not null and d.validation_status in('valid','valid_with_warnings')and j.status='completed'and j.completed_at is not null and j.validation_status in('valid','valid_with_warnings')and j.validation_completed_at is not null and l.raw_object_id=s.raw_object_id and d.raw_object_id=s.raw_object_id and d.source_id=coalesce(s.deduplicated_from_source_id,s.id)),
 supersession_targets as materialized(select distinct release_id,supersedes_source_id from valid_documents where supersedes_source_id is not null),
 superseded_documents as materialized(select distinct previous.release_id,previous.document_id from valid_documents previous join supersession_targets newer on newer.release_id=previous.release_id and newer.supersedes_source_id=previous.source_id),
 current_documents as materialized(select distinct d.release_id,d.product_id,d.document_id from valid_documents d where not exists(select 1 from superseded_documents previous where previous.release_id=d.release_id and previous.document_id=d.document_id)),
 raw_components as materialized(select d.release_id,d.product_id,c.id,c.document_id,nullif(c.canonical_purl,'')canonical_purl,nullif(c.normalized_version,'')normalized_version from current_documents d join public.sbom_components c on c.organization_id=p_org and c.document_id=d.document_id),
 identity_values as materialized(select distinct canonical_purl,normalized_version from raw_components),
 parsed_identities as materialized(select canonical_purl,normalized_version,public.m14_05_package_identity(canonical_purl,normalized_version)identity from identity_values),
 decoded_identities as materialized(select canonical_purl,normalized_version,(identity->>'packageIdentity')collate"C"package,(identity->>'version')collate"C"version,identity->>'reason'reason from parsed_identities),
 components as materialized(select c.release_id,c.product_id,c.id,c.document_id,i.package,i.version,i.reason from raw_components c join decoded_identities i on coalesce(i.canonical_purl,'')=coalesce(c.canonical_purl,'')and coalesce(i.normalized_version,'')=coalesce(c.normalized_version,'')),
 inventory_stats as materialized(select count(*)total,count(*)filter(where reason is null)rankable,jsonb_build_object('missingPurl',count(*)filter(where reason='missingPurl'),'missingVersion',count(*)filter(where reason='missingVersion'),'invalidPurl',count(*)filter(where reason='invalidPurl'),'versionConflict',count(*)filter(where reason='versionConflict'))excluded from components),

 source_ids as materialized(select distinct f.vulnerability_id from public.vulnerability_findings f join releases r on fi and r.id=f.release_id where f.organization_id=p_org),
 numbered_ids as(select vulnerability_id,row_number()over(order by vulnerability_id)rn from source_ids),
 source_batches as(select array_agg(vulnerability_id)ids from numbered_ids group by (rn-1)/250),
 source_cvss as materialized(select c.*from source_batches b cross join lateral public.m4_03_cvss_rows(b.ids)c),
 preferred_cvss as materialized(select distinct on(vulnerability_id)vulnerability_id,(value->>'baseScore')::numeric score from source_cvss order by vulnerability_id,case version when'4.0'then 4 when'3.1'then 3 when'3.0'then 2 when'2.0'then 1 else 0 end desc,source_updated_at desc nulls last,promoted_at desc),
 evaluated_releases as materialized(select distinct d.release_id from current_documents d join public.vulnerability_match_jobs j on fi and j.organization_id=p_org and j.document_id=d.document_id and j.release_id=d.release_id and j.status='completed'and j.completed_at is not null),
 finding_source as materialized(
 select f.*,public.m5_cvss_score_severity(cv.score)severity,exists(select 1 from public.vulnerability_finding_suppressions s where s.organization_id=p_org and s.finding_id=f.id and s.is_current and s.ended_at is null and s.expires_at>statement_timestamp())suppressed,r.product_id
 from public.vulnerability_findings f join releases r on fi and r.id=f.release_id left join preferred_cvss cv on cv.vulnerability_id=f.vulnerability_id where f.organization_id=p_org and public.m5_finding_is_open(p_org,f.id)),
 facts as materialized(select f.id,f.release_id,f.product_id,jsonb_build_object('id',f.id,'severity',f.severity,'suppressed',f.suppressed)fact from finding_source f),
 linked_occurrences as materialized(select o.document_id,o.component_id,o.release_id,f.fact from facts f
 join public.vulnerability_finding_component_occurrences l on l.organization_id=p_org and l.finding_id=f.id and l.state='active'
 join public.vulnerability_component_occurrences o on o.organization_id=p_org and o.id=l.occurrence_id and o.release_id=f.release_id
 join current_documents d on d.document_id=o.document_id and d.release_id=o.release_id where fi),
 component_facts as materialized(select distinct c.product_id,c.release_id,c.package,c.version,o.fact
 from linked_occurrences o join components c on c.document_id=o.document_id and c.id=o.component_id and c.release_id=o.release_id
 where c.reason is null and exists(select 1 from facts)),
 ranked as materialized(select package,version,count(distinct product_id)product_count,count(distinct release_id)release_count from components where reason is null group by package,version having count(distinct product_id)>=2),
 revision_items as(
 select 'p'||p.id::text key,public.m14_05_revision_hash(to_jsonb(p)::text) value from scoped_products p
 union all select 'r'||r.id::text,public.m14_05_revision_hash(to_jsonb(r)::text)from releases r
 union all select 'd'||d.source_id::text,public.m14_05_revision_hash((d.source_revision||d.document_revision||d.job_revision||d.link_revision)::text)from valid_documents d
 union all select 'f'||f.id::text,public.m14_05_revision_hash(to_jsonb(f)::text)from finding_source f
 union all select 'support'||s.id::text,public.m14_05_revision_hash(to_jsonb(s)::text)from public.product_support_periods s join scoped_products p on p.id=s.product_id where s.organization_id=p_org
 union all select 'class'||c.id::text,public.m14_05_revision_hash(to_jsonb(c)::text)from public.product_classification_runs c join scoped_products p on p.id=c.product_id where c.organization_id=p_org
 union all select 'o'||o.id::text,public.m14_05_revision_hash(to_jsonb(o)::text)from public.vulnerability_component_occurrences o join releases r on fi and r.id=o.release_id where o.organization_id=p_org
 union all select 'l'||l.finding_id::text||l.occurrence_id::text,public.m14_05_revision_hash(to_jsonb(l)::text)from public.vulnerability_finding_component_occurrences l join public.vulnerability_findings f on fi and f.organization_id=p_org and f.id=l.finding_id join releases r on r.id=f.release_id where l.organization_id=p_org
 union all select 's'||s.id::text,public.m14_05_revision_hash(to_jsonb(s)::text||coalesce((s.expires_at>statement_timestamp())::text,''))from public.vulnerability_finding_suppressions s join public.vulnerability_findings f on fi and f.organization_id=p_org and f.id=s.finding_id join releases r on r.id=f.release_id where s.organization_id=p_org
 union all select 'file'||t.id::text,public.m14_05_revision_hash(to_jsonb(t)::text)from public.technical_files t join scoped_products p on rd and p.id=t.product_id where t.organization_id=p_org
 union all select 'section'||s.id::text,public.m14_05_revision_hash(to_jsonb(s)::text)from public.technical_file_sections s join public.technical_files t on rd and t.organization_id=p_org and t.id=s.technical_file_id join scoped_products p on p.id=t.product_id where s.organization_id=p_org
 union all select 'src'||x.id::text,public.m14_05_revision_hash(to_jsonb(x)::text)from public.technical_file_section_sources x join public.technical_file_sections s on rd and s.organization_id=p_org and s.id=x.section_id join public.technical_files t on t.organization_id=p_org and t.id=s.technical_file_id join scoped_products p on p.id=t.product_id where x.organization_id=p_org
 union all select 'cvss'||c.vulnerability_id::text,public.m14_05_revision_hash(to_jsonb(c)::text)from source_cvss c
 union all select 'match'||j.id::text,public.m14_05_revision_hash(to_jsonb(j)::text)from public.vulnerability_match_jobs j join current_documents d on fi and d.document_id=j.document_id and d.release_id=j.release_id where j.organization_id=p_org
 union all select 'undo'||u.id::text,public.m14_05_revision_hash(to_jsonb(u)::text)from public.vulnerability_finding_assessment_bulk_operation_targets u join public.vulnerability_findings f on fi and f.organization_id=p_org and f.id=u.finding_id join releases r on r.id=f.release_id where u.organization_id=p_org
 union all select 'a'||a.id::text,public.m14_05_revision_hash(to_jsonb(a)::text)from public.vulnerability_finding_assessments a join public.vulnerability_findings f on fi and f.organization_id=p_org and f.id=a.finding_id join releases r on r.id=f.release_id where a.organization_id=p_org
 ),
 revision as(select public.m14_05_revision_hash(coalesce(string_agg(key||value,''order by key,value),'')||coalesce((select string_agg(public.m14_05_revision_hash(to_jsonb(fc)::text),''order by feed_key)from public.vulnerability_feed_configs fc where feed),'')||jsonb_build_array(sb,fi,rd,feed)::text||'m14_05_projection_policy_v2')id from revision_items),
 product_page as materialized(select p.*from scoped_products p where p_endpoint='products'and(p_filters->'position'is null or p.id>(p_filters#>>'{position,id}')::uuid)order by p.id limit lim+1),
 ranked_page as materialized(select r.*from ranked r where p_endpoint='concentration'and(p_filters->'position'is null or(-r.product_count,-r.release_count,r.package,r.version)>(-(p_filters#>>'{position,productCount}')::bigint,-(p_filters#>>'{position,releaseCount}')::bigint,(select x.package from ranked x where public.m14_05_identity_digest(x.package,x.version)=p_filters#>>'{position,identityDigest}'),(select x.version from ranked x where public.m14_05_identity_digest(x.package,x.version)=p_filters#>>'{position,identityDigest}')))order by r.product_count desc,r.release_count desc,r.package,r.version limit lim+1),
 selected_component as materialized(select r.*from ranked r where p_endpoint='detail'and public.m14_05_identity_digest(r.package,r.version)=p_filters#>>'{component,identityDigest}'),
 selected_memberships as materialized(select distinct m.release_id from components m join selected_component x on x.package=m.package and x.version=m.version where m.reason is null),
 detail_page as materialized(select r.*from releases r join(select distinct release_id from selected_memberships)m on m.release_id=r.id where p_filters->'position'is null or r.id>(p_filters#>>'{position,id}')::uuid order by r.id limit lim+1),
 product_rows as(
 select p.id key,jsonb_build_object('productId',p.id,'productName',p.name,'archived',p.archived_at is not null,'legalEntityId',case when p.entity_name is null then null else p.legal_entity_id end,'legalEntityName',p.entity_name,
 'classification',(select classification::text from public.product_classification_runs where organization_id=p_org and product_id=p.id order by revision desc,id desc limit 1),
 'support',jsonb_build_object('state',case when support.id is null then'missing'when support.support_starts_at>statement_timestamp()then'not_started'when support.support_ends_at<=statement_timestamp()then'ended'else'active'end,'startsAt',case when support.id is null then null else public.m6_utc_second_z(support.support_starts_at)end,'endsAt',case when support.id is null then null else public.m6_utc_second_z(support.support_ends_at)end),
 'sbomCoverage',case when sb then public.m14_section('available',jsonb_build_object('eligibleReleases',(select count(*)from releases r where r.product_id=p.id),'coveredReleases',(select count(distinct release_id)from current_documents d where d.product_id=p.id),'percent',(select round(100.0*(select count(distinct release_id)from current_documents d where d.product_id=p.id)/nullif(count(*),0),2)from releases r where r.product_id=p.id)))else public.m14_section('restricted')end,
 'findings',case when fi then public.m14_05_finding_summary((select jsonb_agg(fact)from facts f where f.product_id=p.id))else public.m14_section('restricted')end,
 'readiness',case when rd then public.m14_05_readiness(p_org,p_actor,p.id,p.name)else public.m14_section('restricted')end)row
 from product_page p left join lateral public.m2_active_support_period(p_org,p.id,null)support on true),
 concentration_rows as(select x.*,jsonb_build_object('packageIdentity',x.package,'version',x.version,'componentRef','pending','productCount',x.product_count,'releaseCount',x.release_count,'findings',case when fi then public.m14_05_finding_summary((select jsonb_agg(fact)from component_facts f where f.package=x.package and f.version=x.version))else public.m14_section('restricted')end)row from ranked_page x),
 detail_rows as(select r.id key,jsonb_build_object('productId',p.id,'productName',p.name,'archived',p.archived_at is not null,'legalEntityId',case when p.entity_name is null then null else p.legal_entity_id end,'legalEntityName',p.entity_name,'releaseId',r.id,'releaseVersion',r.release_version,'releaseArchived',r.archived_at is not null,'findings',case when fi then public.m14_05_finding_summary((select jsonb_agg(fact)from component_facts f where f.release_id=r.id and(f.package,f.version)in(select package,version from selected_component)))else public.m14_section('restricted')end)row
 from detail_page r join scoped_products p on p.id=r.product_id),
 page as(select *from(
 select key::text key,row,row_number()over(order by key)rn,jsonb_build_object('id',key)position from product_rows where p_endpoint='products'and(p_filters->'position'is null or key>(p_filters#>>'{position,id}')::uuid)
 union all select key::text,row,row_number()over(order by key),jsonb_build_object('id',key)from detail_rows where p_endpoint='detail'and(p_filters->'position'is null or key>(p_filters#>>'{position,id}')::uuid)
 union all select package||version,row,row_number()over(order by product_count desc,release_count desc,package,version),jsonb_build_object('productCount',product_count,'releaseCount',release_count,'identityDigest',public.m14_05_identity_digest(package,version))from concentration_rows where p_endpoint='concentration'and(p_filters->'position'is null or(-product_count,-release_count,package,version)>(-(p_filters#>>'{position,productCount}')::bigint,-(p_filters#>>'{position,releaseCount}')::bigint,(select r.package from ranked r where public.m14_05_identity_digest(r.package,r.version)=p_filters#>>'{position,identityDigest}'),(select r.version from ranked r where public.m14_05_identity_digest(r.package,r.version)=p_filters#>>'{position,identityDigest}')))
 )x order by rn limit lim+1)
 select jsonb_build_object('revision',(select id from revision),'rows',coalesce((select jsonb_agg(row order by rn)from page where rn<=lim),'[]'::jsonb),'count',(select count(*)from page),'position',(select position from page where rn=lim),
 'component',case when p_endpoint='detail'then(select jsonb_build_object('packageIdentity',package,'version',version,'componentRef','pending','productCount',product_count,'releaseCount',release_count)from selected_component)else null end,
 'coverage',case when not sb then public.m14_section('restricted')else public.m14_section('available',jsonb_build_object('eligibleReleases',(select count(*)from releases),'coveredReleases',(select count(distinct release_id)from current_documents),'missingReleases',(select count(*)from releases)-(select count(distinct release_id)from current_documents),'percent',(select round(100.0*(select count(distinct release_id)from current_documents)/nullif(count(*),0),2)from releases),'totalComponents',(select total from inventory_stats),'rankableComponents',(select rankable from inventory_stats),'excludedIdentity',(select excluded from inventory_stats)))end,
 'matchingCoverage',case when not fi or not sb then public.m14_section('restricted')else public.m14_section('available',jsonb_build_object('eligibleReleases',(select count(*)from releases),'evaluatedReleases',(select count(*)from evaluated_releases),'pendingReleases',(select count(*)from releases)-(select count(*)from evaluated_releases)))end)into v;
 rev:=v->>'revision';
 if p_filters->>'expectedRevision'is not null and p_filters->>'expectedRevision'<>rev then return jsonb_build_object('outcome','scope_changed');end if;
 if p_endpoint='detail'and v->'component'='null'::jsonb then return jsonb_build_object('outcome','not_found');end if;
 rows:=v->'rows';n:=(v->>'count')::integer;pos:=case when n>lim then v->'position'else null end;
 result:=jsonb_build_object('organizationId',p_org,'serverNow',public.m6_utc_second_z(statement_timestamp()),'generatedAt',public.m6_utc_second_z(statement_timestamp()),'scope',jsonb_build_object('legalEntityId',entity,'productId',product,'includeArchived',archived),'coverage',v->'coverage','matchingCoverage',v->'matchingCoverage','feedFreshness',case when feed then public.m4_dashboard_feed_freshness(p_org,p_actor)else public.m14_section('restricted')end);
 result:=result||jsonb_build_object(case p_endpoint when'products'then'products'when'concentration'then'concentration'else'affectedReleases'end,case when p_endpoint='concentration'and not sb then public.m14_section('restricted')else public.m14_section(case when jsonb_array_length(rows)=0 then'empty'else'available'end,jsonb_build_object('rows',rows,'nextCursor',null))end);
 if p_endpoint='detail'then result:=result||jsonb_build_object('component',v->'component');end if;
 return jsonb_build_object('outcome','found','result',result,'revision',rev,'nextPosition',pos);
end$$;

revoke all on function public.get_portfolio_projection(uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.get_portfolio_projection(uuid,uuid,text,jsonb)to service_role;
