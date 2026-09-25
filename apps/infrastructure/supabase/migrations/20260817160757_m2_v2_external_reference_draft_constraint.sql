alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_distribution_check,
  add constraint product_security_update_artifact_distribution_check check (
    (distribution_kind = 'authenticated_download' and object_key is not null
      and distribution_reference is null
      and jsonb_array_length(published_external_references) = 0)
    or (distribution_kind = 'external_reference' and object_key is null and (
      (publication_status = 'draft' and (
        (distribution_reference is null and jsonb_array_length(published_external_references) = 0)
        or (
          distribution_reference is not null
          and distribution_reference ~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$'
          and distribution_reference !~* '(signature|token|x-amz-)'
          and jsonb_array_length(published_external_references) > 0
          and public.m2_v2_valid_published_external_references(published_external_references)
        )
      ))
      or (publication_status in ('published', 'replaced', 'withdrawn')
        and distribution_reference is not null
        and distribution_reference ~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$'
        and distribution_reference !~* '(signature|token|x-amz-)'
        and jsonb_array_length(published_external_references) > 0
        and public.m2_v2_valid_published_external_references(published_external_references))
    ))
  );
