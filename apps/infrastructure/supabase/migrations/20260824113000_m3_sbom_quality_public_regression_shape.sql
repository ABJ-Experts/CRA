-- `materialDimensionIds` is an internal comparison helper.  Public reports
-- expose only the versioned contract fields, including changedDimensions.
update public.sbom_quality_reports
set regression_summary = regression_summary - 'materialDimensionIds'
where regression_summary ? 'materialDimensionIds';
