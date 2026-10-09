-- Restore existing migration contracts after a reconstructed local stack.
-- No account backfill, table data changes, or wider service/browser grants.
revoke truncate, trigger, references on public.sbom_documents,
  public.sbom_document_sources, public.sbom_components,
  public.sbom_component_identities, public.sbom_component_dependencies,
  public.sbom_raw_objects, public.sbom_sources
  from service_role;

-- Reuse the existing hardened SECURITY DEFINER functions and their pinned paths.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();
