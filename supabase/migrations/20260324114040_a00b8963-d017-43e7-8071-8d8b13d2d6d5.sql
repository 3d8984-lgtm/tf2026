ALTER TABLE public.profiles ADD COLUMN phone text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, approved, role, name, phone)
  VALUES (NEW.id, NEW.email, false, 'worker', NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'phone');
  RETURN NEW;
END;
$$;