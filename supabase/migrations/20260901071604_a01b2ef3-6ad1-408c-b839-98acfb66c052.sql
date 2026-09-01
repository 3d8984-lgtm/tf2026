ALTER TABLE public.barcode_print_items
  DROP CONSTRAINT IF EXISTS barcode_print_items_dispatch_status_check;
ALTER TABLE public.barcode_print_items
  ADD CONSTRAINT barcode_print_items_dispatch_status_check
  CHECK (dispatch_status IN ('queued','dispatching','uncertain','accepted','waiting_for_print','printing','printed','error'));