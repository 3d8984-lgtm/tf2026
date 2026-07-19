import { useEffect, useState, useCallback } from "react";
import type { FactoryKey } from "@/hooks/useOrderStatus";

const LS_KEY = "outsource-expected-ship/v1";
const EVENT = "outsource-expected-ship:changed";

type Store = Record<string, string>; // `${factory}::${orderNo}` -> yyyy-mm-dd

function readStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch {}
}

function k(f: FactoryKey, orderNo: string) { return `${f}::${orderNo}`; }

export function getExpectedShipAt(f: FactoryKey, orderNo: string): string {
  if (!orderNo) return "";
  return readStore()[k(f, orderNo)] ?? "";
}

export function setExpectedShipAt(f: FactoryKey, orderNo: string, value: string) {
  if (!orderNo) return;
  const s = readStore();
  const key = k(f, orderNo);
  if (value) s[key] = value; else delete s[key];
  writeStore(s);
}

export function useExpectedShipAt(f: FactoryKey, orderNo: string) {
  const [value, setValue] = useState<string>(() => getExpectedShipAt(f, orderNo));
  useEffect(() => {
    const sync = () => setValue(getExpectedShipAt(f, orderNo));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [f, orderNo]);
  const update = useCallback((v: string) => {
    setExpectedShipAt(f, orderNo, v);
    setValue(v);
  }, [f, orderNo]);
  return [value, update] as const;
}
