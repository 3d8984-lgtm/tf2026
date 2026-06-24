import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useQrMasterData() {
  const { data: tshirtQR } = useQuery({
    queryKey: ["qr_tshirt_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("qr_tshirt_master").select("*");
      if (error) throw error;
      const map: Record<string, { product: string; color: string; size: string }> = {};
      for (const r of data ?? []) {
        map[r.qr_value] = { product: r.product_code ?? "", color: r.color, size: r.size };
      }
      return map;
    },
  });

  const { data: siliconQR } = useQuery({
    queryKey: ["qr_silicon_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("qr_silicon_master").select("*");
      if (error) throw error;
      const map: Record<string, { product: string; design: string }> = {};
      for (const r of data ?? []) {
        map[r.qr_value] = { product: r.product_code ?? "", design: r.serial_number };
      }
      return map;
    },
  });

  const { data: designQR } = useQuery({
    queryKey: ["qr_design_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("qr_design_master").select("*");
      if (error) throw error;
      const map: Record<string, { product: string; design: string }> = {};
      for (const r of data ?? []) {
        map[r.qr_value] = { product: r.design_name ?? r.design_code ?? "", design: r.design_code ?? "" };
      }
      return map;
    },
  });

  const { data: holoQR } = useQuery({
    queryKey: ["qr_hologram_master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("qr_hologram_master").select("*");
      if (error) throw error;
      const map: Record<string, { product: string; design: string; used: boolean }> = {};
      for (const r of data ?? []) {
        map[r.qr_value] = { product: r.serial_number ?? "", design: r.hologram_type ?? r.serial_number ?? "", used: false };
      }
      return map;
    },
  });

  return {
    tshirtQR: tshirtQR ?? {},
    siliconQR: siliconQR ?? {},
    designQR: designQR ?? {},
    holoQR: holoQR ?? {},
  };
}
