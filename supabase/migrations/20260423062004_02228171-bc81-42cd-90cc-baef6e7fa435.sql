
-- Drop if exists to avoid conflicts
DROP TRIGGER IF EXISTS trg_auto_create_order_related ON public.orders;

-- Create the trigger
CREATE TRIGGER trg_auto_create_order_related
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_order_related();
