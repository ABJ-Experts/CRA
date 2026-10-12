-- Retired before publication: the initial local compatibility experiment
-- added global object-name uniqueness for an older Storage runtime. That
-- restriction conflicts with native versioned storage and is not deployable.
-- Keep this version as a harmless history marker for fresh installations;
-- 20261012054548 removes the experiment from local stacks that applied it.
-- Storage runtimes must match their existing platform schema instead.
do $$ begin
  raise notice 'Legacy Storage compatibility index retired; preserve native versioning';
end $$;
