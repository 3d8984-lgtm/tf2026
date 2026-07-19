import { useCallback, useEffect, useState } from "react";

export type OrderShippingStatus = "pending" | "hold" | "completed";

export type FactoryKey =
  | "silicon"
  | "heat-transfer"
  | "hologram"
  | "nfc-card"
  | "logo"
  | "tshirt-order";

const LS_KEY = "order-shipping-status/v1";
const EVENT = "order-shipping-status:changed";

type Store = Record<string, OrderShippingStatus>; // key = `${factory}::${orderNo}`

function readStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

function keyOf(f: FactoryKey, orderNo: string) {
  return `${f}::${orderNo}`;
}

export function getOrderStatus(f: FactoryKey, orderNo: string): OrderShippingStatus {
  return readStore()[keyOf(f, orderNo)] ?? "pending";
}

export function setOrderStatus(f: FactoryKey, orderNo: string, status: OrderShippingStatus) {
  const s = readStore();
  s[keyOf(f, orderNo)] = status;
  writeStore(s);
}

const PO_CARDS_LS = "outsource-po-cards/v1";
const PO_CARDS_EVENT = "outsource-po-cards:changed";

export function markOrderCompleted(
  f: FactoryKey,
  orderNo: string,
  meta?: { quantity?: number; expectedShipAt?: string },
) {
  setOrderStatus(f, orderNo, "completed");
  if (!orderNo) return;
  try {
    const raw = localStorage.getItem(PO_CARDS_LS);
    const s: Record<string, any> = raw ? JSON.parse(raw) : {};
    const k = `${f}::${orderNo}`;
    const today = new Date().toISOString().slice(0, 10);
    const existing = s[k];
    s[k] = {
      factory: f,
      orderNo,
      quantity: meta?.quantity ?? existing?.quantity,
      orderedAt: existing?.orderedAt ?? today,
      expectedShipAt: meta?.expectedShipAt ?? existing?.expectedShipAt,
      column: existing?.column ?? "ordered",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    localStorage.setItem(PO_CARDS_LS, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(PO_CARDS_EVENT));
  } catch {}
}

export function useOrderStatus(f: FactoryKey, orderNo: string) {
  const [status, setStatusState] = useState<OrderShippingStatus>(() => getOrderStatus(f, orderNo));

  useEffect(() => {
    const sync = () => setStatusState(getOrderStatus(f, orderNo));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [f, orderNo]);

  const update = useCallback(
    (next: OrderShippingStatus) => {
      setOrderStatus(f, orderNo, next);
      setStatusState(next);
    },
    [f, orderNo]
  );

  return [status, update] as const;
}
