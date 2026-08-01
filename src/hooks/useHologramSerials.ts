import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Maps qr_value -> hologram sticker serial number for the given QR values.
 */
export function useHologramSerials(qrValues: string[]) {
  const keys = Array.from(new Set(qrValues.filter(Boolean))).sort();
  return useQuery({
    enabled: keys.length > 0,
    queryKey: ["hologram_serials", keys],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qr_hologram_master")
        .select("qr_value, serial_number, hologram_type")
        .in("qr_value", keys);
      if (error) throw error;
      const map: Record<string, { serial: string; type: string }> = {};
      for (const r of data ?? []) {
        map[r.qr_value] = { serial: r.serial_number ?? "", type: r.hologram_type ?? "" };
      }
      return map;
    },
  });
}
