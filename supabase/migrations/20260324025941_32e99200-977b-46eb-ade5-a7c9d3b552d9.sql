
-- Allow authenticated users to insert orders
CREATE POLICY "Authenticated users can insert orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update orders
CREATE POLICY "Authenticated users can update orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to insert production_tracking
CREATE POLICY "Authenticated users can insert tracking"
ON public.production_tracking
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update production_tracking
CREATE POLICY "Authenticated users can update tracking"
ON public.production_tracking
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
