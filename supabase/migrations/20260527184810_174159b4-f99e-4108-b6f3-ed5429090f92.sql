
-- Create app_private.is_approved mirroring public.is_approved
CREATE OR REPLACE FUNCTION app_private.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND approved = true
  )
$$;

REVOKE EXECUTE ON FUNCTION app_private.is_approved(uuid) FROM PUBLIC, anon, authenticated;

-- Switch all policies referencing public.is_approved to app_private.is_approved
DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  cmd_kw text;
  using_clause text;
  check_clause text;
  roles_clause text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%is_approved(%' OR with_check ILIKE '%is_approved(%')
  LOOP
    new_qual := regexp_replace(coalesce(r.qual, ''), 'is_approved\(', 'app_private.is_approved(', 'g');
    new_check := regexp_replace(coalesce(r.with_check, ''), 'is_approved\(', 'app_private.is_approved(', 'g');

    cmd_kw := CASE r.cmd
      WHEN 'SELECT' THEN 'FOR SELECT'
      WHEN 'INSERT' THEN 'FOR INSERT'
      WHEN 'UPDATE' THEN 'FOR UPDATE'
      WHEN 'DELETE' THEN 'FOR DELETE'
      WHEN 'ALL' THEN 'FOR ALL'
    END;

    roles_clause := 'TO ' || array_to_string(r.roles, ', ');
    using_clause := CASE WHEN r.qual IS NOT NULL THEN ' USING (' || new_qual || ')' ELSE '' END;
    check_clause := CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || new_check || ')' ELSE '' END;

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON %I.%I %s %s%s%s',
      r.policyname, r.schemaname, r.tablename, cmd_kw, roles_clause, using_clause, check_clause);
  END LOOP;
END $$;

-- Now safe to revoke from public.is_approved again
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
