
-- Allow authenticated users to insert shipments
CREATE POLICY "Authenticated users can insert shipments"
ON public.shipments
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update shipments
CREATE POLICY "Authenticated users can update shipments"
ON public.shipments
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
