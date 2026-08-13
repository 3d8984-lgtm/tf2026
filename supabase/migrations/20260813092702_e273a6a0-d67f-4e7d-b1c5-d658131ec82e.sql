
CREATE OR REPLACE FUNCTION app_private.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.profiles
       WHERE user_id = _user_id AND role = 'admin' AND approved = true
     )
$$;

CREATE OR REPLACE FUNCTION app_private.is_approved(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.profiles
       WHERE user_id = _user_id AND approved = true
     )
$$;

-- ownership helper for tshirt PO attachments
CREATE OR REPLACE FUNCTION app_private.owns_tshirt_po_attachment(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tshirt_purchase_order_attachments a
    JOIN public.tshirt_purchase_orders p ON p.id = a.po_id
    WHERE a.file_path = _name
      AND p.created_by = auth.uid()
  )
$$;

DROP POLICY IF EXISTS tshirt_po_att_read ON storage.objects;
DROP POLICY IF EXISTS tshirt_po_att_update ON storage.objects;
DROP POLICY IF EXISTS tshirt_po_att_delete ON storage.objects;

CREATE POLICY tshirt_po_att_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'tshirt-po-attachments'
  AND (
    app_private.is_admin(auth.uid())
    OR owner = auth.uid()
    OR app_private.owns_tshirt_po_attachment(name)
  )
);

CREATE POLICY tshirt_po_att_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tshirt-po-attachments'
  AND (
    app_private.is_admin(auth.uid())
    OR owner = auth.uid()
    OR app_private.owns_tshirt_po_attachment(name)
  )
)
WITH CHECK (
  bucket_id = 'tshirt-po-attachments'
  AND (
    app_private.is_admin(auth.uid())
    OR owner = auth.uid()
    OR app_private.owns_tshirt_po_attachment(name)
  )
);

CREATE POLICY tshirt_po_att_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tshirt-po-attachments'
  AND (
    app_private.is_admin(auth.uid())
    OR owner = auth.uid()
    OR app_private.owns_tshirt_po_attachment(name)
  )
);

DROP POLICY IF EXISTS silicon_examples_update ON storage.objects;
DROP POLICY IF EXISTS silicon_examples_delete ON storage.objects;

CREATE POLICY silicon_examples_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'silicon-examples'
  AND (owner = auth.uid() OR app_private.is_admin(auth.uid()))
)
WITH CHECK (
  bucket_id = 'silicon-examples'
  AND (owner = auth.uid() OR app_private.is_admin(auth.uid()))
);

CREATE POLICY silicon_examples_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'silicon-examples'
  AND (owner = auth.uid() OR app_private.is_admin(auth.uid()))
);
