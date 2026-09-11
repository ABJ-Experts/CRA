-- Internal serializers are callable only through organization-scoped RPCs.
revoke all on function public.m2_release_json(uuid, uuid)
  from public, anon, authenticated;
