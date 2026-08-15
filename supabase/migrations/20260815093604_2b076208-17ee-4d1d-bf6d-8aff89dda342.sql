CREATE POLICY "Users can insert only their own basic profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND coalesce(role, 'worker') = 'worker'
  AND coalesce(approved, false) = false
);