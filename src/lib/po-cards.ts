import { useEffect, useState, useCallback } from "react";
import type { FactoryKey } from "@/hooks/useOrderStatus";

const LS_KEY = "outsource-po-cards/v1";
const EVENT = "outsource-po-cards:changed";

export type PoColumn = "ordered" | "started" | "produced" | "shipped" | "received";

export interface PoCard {
  factory: FactoryKey;
  orderNo: string;           // 작업지시번호
  quantity?: number;
  orderedAt: string;         // yyyy-mm-dd (발주일)
  expectedShipAt?: string;   // yyyy-mm-dd (예상 발송일)
  column: PoColumn;
  createdAt: string;         // ISO
}

function keyOf(f: FactoryKey, orderNo: string) {
  return `${f}::${orderNo}`;
}

function readAll(): Record<string, PoCard> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(s: Record<string, PoCard>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch {}
}

export function recordPoCard(
  factory: FactoryKey,
  orderNo: string,
  meta?: { quantity?: number; expectedShipAt?: string },
) {
  if (!orderNo) return;
  const s = readAll();
  const k = keyOf(factory, orderNo);
  const today = new Date().toISOString().slice(0, 10);
  const existing = s[k];
  s[k] = {
    factory,
    orderNo,
    quantity: meta?.quantity ?? existing?.quantity,
    orderedAt: existing?.orderedAt ?? today,
    expectedShipAt: meta?.expectedShipAt ?? existing?.expectedShipAt,
    column: existing?.column ?? "ordered",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  writeAll(s);
}

export function listPoCards(): PoCard[] {
  return Object.values(readAll());
}

export function updatePoCard(factory: FactoryKey, orderNo: string, patch: Partial<PoCard>) {
  const s = readAll();
  const k = keyOf(factory, orderNo);
  if (!s[k]) return;
  s[k] = { ...s[k], ...patch };
  writeAll(s);
}

export function removePoCard(factory: FactoryKey, orderNo: string) {
  const s = readAll();
  delete s[keyOf(factory, orderNo)];
  writeAll(s);
}

export function usePoCards() {
  const [cards, setCards] = useState<PoCard[]>(() => listPoCards());
  useEffect(() => {
    const sync = () => setCards(listPoCards());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const refresh = useCallback(() => setCards(listPoCards()), []);
  return { cards, refresh };
}
