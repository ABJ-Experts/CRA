-- Reserved forward migration.  Function bodies are corrected in the next
-- migration because Supabase disallows ALTER FUNCTION plpgsql settings.
notify pgrst,'reload schema';
