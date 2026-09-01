import { describe, expect, it } from "vitest";
import { isPfPrintAccepted, pfErrorCode } from "./pf-printer";

describe("PF printer response contract", () => {
  it("accepts only HTTP success with accepted=true and a job id", () => {
    expect(isPfPrintAccepted(true, { accepted: true, id: "2088c3c8", printed: null })).toBe(true);
    expect(isPfPrintAccepted(true, { accepted: true })).toBe(false);
    expect(isPfPrintAccepted(true, { accepted: false, id: "x" })).toBe(false);
    expect(isPfPrintAccepted(true, { offline: true })).toBe(false);
    expect(isPfPrintAccepted(true, { accepted: true, id: "x", error: "failed" })).toBe(false);
    expect(isPfPrintAccepted(false, { accepted: true, id: "x" })).toBe(false);
  });

  it("uses structured error codes instead of message matching", () => {
    expect(pfErrorCode({ error_code: "QUEUE_CANCELLED" }, 409)).toBe("QUEUE_CANCELLED");
    expect(pfErrorCode({}, 504)).toBe("PRINTER_RESPONSE_TIMEOUT");
    expect(pfErrorCode({}, 503)).toBe("PRINTER_SERIAL_DISCONNECTED");
    expect(pfErrorCode({}, 409)).toBe("PRINTER_NAK");
  });
});