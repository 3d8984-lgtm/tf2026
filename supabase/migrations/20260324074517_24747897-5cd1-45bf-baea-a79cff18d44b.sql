
-- Create a security definer function to check role without RLS recursion
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id
      AND role = 'admin'
      AND approved = true
  )
$$;

-- Drop old recursive policies
DROP POLICY IF EXISTS "Admin can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update profiles" ON public.profiles;

-- Recreate with security definer function
CREATE POLICY "Admin can read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "Admin can update profiles"
ON public.profiles FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()));
