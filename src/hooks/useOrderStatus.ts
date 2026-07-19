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

export function markOrderCompleted(f: FactoryKey, orderNo: string) {
  setOrderStatus(f, orderNo, "completed");
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
