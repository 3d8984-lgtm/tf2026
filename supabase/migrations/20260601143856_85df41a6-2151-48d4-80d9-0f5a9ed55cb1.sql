DO $$ BEGIN
  -- INSERT
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Approved upload hologram-pdf') THEN
    CREATE POLICY "Approved upload hologram-pdf" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'hologram-pdf' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
  END IF;
  -- UPDATE (for upsert)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Approved update hologram-pdf') THEN
    CREATE POLICY "Approved update hologram-pdf" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'hologram-pdf' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())))
      WITH CHECK (bucket_id = 'hologram-pdf' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
  END IF;
  -- DELETE
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Approved delete hologram-pdf') THEN
    CREATE POLICY "Approved delete hologram-pdf" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'hologram-pdf' AND (public.is_approved(auth.uid()) OR public.is_admin(auth.uid())));
  END IF;
END $$;