// Shipping group = same recipient name + phone + address + zip.
// Only light normalization — never fuzzy-match different addresses.
export function normText(s: unknown) {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normPhone(s: unknown) {
  return String(s ?? "").replace(/[\s\-()]/g, "").trim();
}

export function shippingGroupKey(r: {
  name?: unknown;
  phone?: unknown;
  address?: unknown;
  zip?: unknown;
}) {
  return [normText(r.name), normPhone(r.phone), normText(r.address), normText(r.zip)].join("|");
}
