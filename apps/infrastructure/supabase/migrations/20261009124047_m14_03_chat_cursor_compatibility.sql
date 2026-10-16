-- PostgreSQL ARE repetition bounds stop at 255. Preserve the native 512-character
-- cursor contract using a separate length check so actual second pages work.
-- CREATE OR REPLACE preserves the original function's search_path and grants.
do $chat_cursor$ declare v_definition text;begin
 v_definition:=pg_get_functiondef('public.m12_05_list_chat_deliveries_atomic(uuid,uuid,text,text,uuid,text,integer)'::regprocedure);
 if position('p_cursor !~ ''^[A-Za-z0-9_-]{1,512}$''' in v_definition)=0 then raise exception 'chat_cursor_projection_baseline_changed';end if;
 v_definition:=replace(v_definition,'p_cursor !~ ''^[A-Za-z0-9_-]{1,512}$''','(char_length(p_cursor) not between 1 and 512 or p_cursor !~ ''^[A-Za-z0-9_-]+$'')');
 -- PostgreSQL base64 wraps long output at 76 columns; URL-safe cursors do not.
 if position('encode(convert_to((v_result->''nextCursor'')::text,''UTF8''),''base64'')' in v_definition)=0 then raise exception 'chat_cursor_encoder_baseline_changed';end if;
 v_definition:=replace(v_definition,'encode(convert_to((v_result->''nextCursor'')::text,''UTF8''),''base64'')',
 'replace(encode(convert_to((v_result->''nextCursor'')::text,''UTF8''),''base64''),chr(10),'''')');
 execute v_definition;
end $chat_cursor$;
notify pgrst,'reload schema';
