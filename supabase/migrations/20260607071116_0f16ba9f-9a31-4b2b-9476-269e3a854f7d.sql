
ALTER FUNCTION public.generate_tshirt_po_number() SECURITY INVOKER;
ALTER FUNCTION public.apply_tshirt_po_receipt() SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.generate_tshirt_po_number() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_tshirt_po_receipt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tshirt_po_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_tshirt_po_receipt() TO authenticated, service_role;
