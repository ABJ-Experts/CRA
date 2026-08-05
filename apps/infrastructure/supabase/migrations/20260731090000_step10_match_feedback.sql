-- Step 10 — structured false-positive feedback on findings (FR-MATCH-004).
--
-- "When an analyst marks a match as a false positive, the structured reason is
-- stored and counted. Rates by method, ecosystem and feed are reportable."
--
-- The reason is a CHECK-constrained enumeration rather than free text, for the
-- same reason §8.3 constrains vex_justification: this feeds a quality metric
-- that gets compared against the golden dataset's own false-positive rate, and
-- free text cannot be aggregated.
--
-- ADR-014 expand-then-contract: all three columns are nullable and additive, so
-- the previous release still reads this schema.

alter table finding
  add column if not exists false_positive_reason text,
  add column if not exists false_positive_at     timestamptz,
  add column if not exists false_positive_by     uuid references user_account(id);

alter table finding
  drop constraint if exists finding_false_positive_reason_check;

alter table finding
  add constraint finding_false_positive_reason_check check (
    false_positive_reason is null or false_positive_reason in (
      'wrong_version_range',
      'wrong_package',
      'cpe_too_broad',
      'advisory_withdrawn',
      'bad_sbom_data',
      'other'
    )
  );

-- A reason without a timestamp (or the reverse) is a half-written record, and
-- the metric would silently under-count. Keep them together.
alter table finding
  drop constraint if exists finding_false_positive_complete_check;

alter table finding
  add constraint finding_false_positive_complete_check check (
    (false_positive_reason is null and false_positive_at is null)
    or (false_positive_reason is not null and false_positive_at is not null)
  );

-- The rates query filters on "is a false positive" and groups by method; a
-- partial index keeps it off a full scan as the finding table grows.
create index if not exists finding_false_positive_idx
  on finding (organisation_id, match_method)
  where false_positive_reason is not null;
