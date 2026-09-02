CREATE TABLE IF NOT EXISTS public.barcode_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  kind text NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  scanned_value text NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  position integer,
  verdict text NOT NULL,
  expected_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, order_id, event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.barcode_scan_events TO authenticated;
GRANT ALL ON public.barcode_scan_events TO service_role;

ALTER TABLE public.barcode_scan_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved users can read barcode scan events"
  ON public.barcode_scan_events FOR SELECT TO authenticated
  USING (app_private.is_approved(auth.uid()));
CREATE POLICY "approved users can insert barcode scan events"
  ON public.barcode_scan_events FOR INSERT TO authenticated
  WITH CHECK (app_private.is_approved(auth.uid()));
CREATE POLICY "approved users can update barcode scan events"
  ON public.barcode_scan_events FOR UPDATE TO authenticated
  USING (app_private.is_approved(auth.uid())) WITH CHECK (app_private.is_approved(auth.uid()));
CREATE POLICY "approved users can delete barcode scan events"
  ON public.barcode_scan_events FOR DELETE TO authenticated
  USING (app_private.is_approved(auth.uid()));

CREATE OR REPLACE FUNCTION public.verify_barcode_scan(
  _kind text,
  _order_id uuid,
  _event_id text,
  _value text,
  _scanned_at timestamptz DEFAULT now()
)
RETURNS TABLE(item_position integer, out_verdict text, out_expected text, duplicate_event boolean, cursor_pos integer, is_halted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text;
  _cursor integer := 0;
  _target record;
  _hit record;
  _pos integer;
  _verdict text;
  _expected text;
  _existing record;
BEGIN
  IF NOT app_private.is_approved(auth.uid()) THEN
    RAISE EXCEPTION 'not approved';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_kind || ':' || _order_id::text, 0));

  SELECT e.position, e.verdict, e.expected_value INTO _existing
  FROM public.barcode_scan_events e
  WHERE e.kind = _kind AND e.order_id = _order_id AND e.event_id = _event_id;

  IF FOUND THEN
    RETURN QUERY SELECT _existing.position, _existing.verdict, _existing.expected_value, true,
      NULL::integer,
      EXISTS (SELECT 1 FROM public.barcode_print_items i
              WHERE i.kind = _kind AND i.order_id = _order_id
                AND (i.status = 'error' OR (i.verdict IS NOT NULL AND i.verdict <> 'ok')));
    RETURN;
  END IF;

  _norm := upper(btrim(coalesce(_value, '')));

  -- 진행 커서 = 1번부터 연속으로 정상 처리된 마지막 순번
  SELECT coalesce(max(p.position), 0) INTO _cursor
  FROM (
    SELECT i.position, row_number() OVER (ORDER BY i.position) AS rn
    FROM public.barcode_print_items i
    WHERE i.kind = _kind AND i.order_id = _order_id
      AND i.verdict = 'ok' AND i.scanned_at IS NOT NULL
  ) p
  WHERE p.position = p.rn;

  SELECT i.* INTO _target FROM public.barcode_print_items i
  WHERE i.kind = _kind AND i.order_id = _order_id AND i.position = _cursor + 1;

  -- 1) 이미 정상 처리된 값이면 중복
  SELECT i.* INTO _hit FROM public.barcode_print_items i
  WHERE i.kind = _kind AND i.order_id = _order_id AND i.verdict = 'ok'
    AND (upper(btrim(coalesce(i.expected_value, i.code))) = _norm OR upper(btrim(coalesce(i.scanned_value, ''))) = _norm)
  ORDER BY i.position LIMIT 1;

  IF FOUND THEN
    _verdict := 'duplicate';
    _pos := _hit.position;
    _expected := coalesce(_hit.expected_value, _hit.code);
  ELSIF _target.position IS NOT NULL AND upper(btrim(coalesce(_target.expected_value, _target.code))) = _norm THEN
    _verdict := 'ok';
    _pos := _target.position;
    _expected := coalesce(_target.expected_value, _target.code);
  ELSE
    SELECT i.* INTO _hit FROM public.barcode_print_items i
    WHERE i.kind = _kind AND i.order_id = _order_id
      AND upper(btrim(coalesce(i.expected_value, i.code))) = _norm
    ORDER BY i.position LIMIT 1;
    IF FOUND THEN
      _verdict := 'order';
      _pos := _hit.position;
      _expected := coalesce(_hit.expected_value, _hit.code);
    ELSE
      _verdict := 'mismatch';
      _pos := NULL;
      _expected := CASE WHEN _target.position IS NOT NULL THEN coalesce(_target.expected_value, _target.code) ELSE NULL END;
    END IF;
  END IF;

  IF _verdict = 'ok' THEN
    UPDATE public.barcode_print_items i
    SET status = 'queued', dispatch_status = 'queued', verdict = 'ok',
        scanned_value = _value, scanned_at = _scanned_at, scan_sequence = i.position,
        expected_value = coalesce(i.expected_value, i.code),
        printed_at = NULL, test_mode = false,
        gateway_job_id = NULL, dispatch_started_at = NULL, gateway_received_at = NULL,
        response_code = NULL, retry_count = 0, error_code = NULL, error_detail = NULL
    WHERE i.kind = _kind AND i.order_id = _order_id AND i.position = _pos;
  ELSIF _pos IS NOT NULL THEN
    -- 이미 정상 처리된 행은 뒤늦은 오류 판정으로 덮어쓰지 않는다
    UPDATE public.barcode_print_items i
    SET verdict = _verdict, scanned_value = _value, scanned_at = _scanned_at,
        expected_value = coalesce(i.expected_value, i.code)
    WHERE i.kind = _kind AND i.order_id = _order_id AND i.position = _pos
      AND coalesce(i.verdict, '') <> 'ok';
  END IF;

  INSERT INTO public.barcode_scan_events (event_id, kind, order_id, scanned_value, scanned_at, position, verdict, expected_value)
  VALUES (_event_id, _kind, _order_id, _value, _scanned_at, _pos, _verdict, _expected);

  RETURN QUERY SELECT _pos, _verdict, _expected, false,
    CASE WHEN _verdict = 'ok' THEN _pos ELSE _cursor END,
    EXISTS (SELECT 1 FROM public.barcode_print_items i
            WHERE i.kind = _kind AND i.order_id = _order_id
              AND (i.status = 'error' OR (i.verdict IS NOT NULL AND i.verdict <> 'ok')));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_barcode_scan(text, uuid, text, text, timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_barcode_scan(text, uuid, text, text, timestamptz) TO authenticated;