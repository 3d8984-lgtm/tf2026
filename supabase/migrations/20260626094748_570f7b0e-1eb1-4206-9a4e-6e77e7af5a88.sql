
DO $$
DECLARE r record;
  new_using text;
  new_check text;
  stmt text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE (qual ~ '(^|[^.[:alnum:]_])is_approved\(' OR qual ~ '(^|[^.[:alnum:]_])is_admin\('
        OR with_check ~ '(^|[^.[:alnum:]_])is_approved\(' OR with_check ~ '(^|[^.[:alnum:]_])is_admin\(')
  LOOP
    new_using := r.qual;
    new_check := r.with_check;
    IF new_using IS NOT NULL THEN
      new_using := regexp_replace(new_using, '(^|[^.[:alnum:]_])is_approved\(', '\1app_private.is_approved(', 'g');
      new_using := regexp_replace(new_using, '(^|[^.[:alnum:]_])is_admin\(',    '\1app_private.is_admin(',    'g');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '(^|[^.[:alnum:]_])is_approved\(', '\1app_private.is_approved(', 'g');
      new_check := regexp_replace(new_check, '(^|[^.[:alnum:]_])is_admin\(',    '\1app_private.is_admin(',    'g');
    END IF;

    stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF new_using IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_using);
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

-- Now revoke external execute on the public-schema helpers (PostgREST exposes public only)
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid)    FROM PUBLIC, anon, authenticated;
