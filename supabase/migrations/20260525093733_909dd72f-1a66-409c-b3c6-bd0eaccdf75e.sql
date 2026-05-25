insert into storage.buckets (id, name, public)
values ('design-formats', 'design-formats', true)
on conflict (id) do nothing;

create policy "Public read design-formats"
  on storage.objects for select
  using (bucket_id = 'design-formats');

create policy "Admins insert design-formats"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'design-formats' and app_private.is_admin(auth.uid()));

create policy "Admins update design-formats"
  on storage.objects for update to authenticated
  using (bucket_id = 'design-formats' and app_private.is_admin(auth.uid()))
  with check (bucket_id = 'design-formats' and app_private.is_admin(auth.uid()));

create policy "Admins delete design-formats"
  on storage.objects for delete to authenticated
  using (bucket_id = 'design-formats' and app_private.is_admin(auth.uid()));