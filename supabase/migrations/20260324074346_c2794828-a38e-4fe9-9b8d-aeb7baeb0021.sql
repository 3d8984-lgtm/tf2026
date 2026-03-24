CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, approved, role)
  VALUES (NEW.id, NEW.email, false, 'worker');
  RETURN NEW;
END;
$function$