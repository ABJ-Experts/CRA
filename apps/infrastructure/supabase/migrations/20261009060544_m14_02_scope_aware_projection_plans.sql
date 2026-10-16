-- Measured on committed/VACUUM ANALYZE histories with 1m revisions/998
-- findings and 10k revisions/10k findings. These parameter-sensitive statements
-- need the current metric, tenant/product scope and pinned bounds at planning
-- time; a cached generic plan otherwise misestimates the recursive identity
-- stream and repeatedly joins broad intermediate rows. Keep ordered historical
-- identity seeks: a universal DISTINCT scan regressed deep revision histories.
-- Settings apply only to these two read functions, never the database globally.
-- Dataset facts, visibility, authorization and metric policy are unchanged.
alter function public.get_dashboard_trends(uuid,uuid,jsonb,jsonb) set plan_cache_mode=force_custom_plan;
alter function public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb) set plan_cache_mode=force_custom_plan;
alter function public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb) set jit=off;
