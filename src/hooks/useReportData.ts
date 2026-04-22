import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfDay, endOfDay, format } from "date-fns";

export function useProductionReport(from: Date, to: Date) {
  return useQuery({
    queryKey: ["report-production", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_tracking")
        .select("stage, completed_count, completed_at")
        .gte("completed_at", startOfDay(from).toISOString())
        .lte("completed_at", endOfDay(to).toISOString())
        .not("completed_at", "is", null);
      if (error) throw error;

      // Group by date and stage
      const byDate: Record<string, Record<string, number>> = {};
      (data || []).forEach((row) => {
        const d = format(new Date(row.completed_at!), "MM-dd");
        if (!byDate[d]) byDate[d] = {};
        byDate[d][row.stage] = (byDate[d][row.stage] || 0) + row.completed_count;
      });

      const chartData = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, stages]) => ({
          date,
          tshirt: stages["tshirt"] || 0,
          card: stages["card"] || 0,
          set: stages["set"] || 0,
          weight: stages["weight"] || 0,
          courier: stages["courier"] || 0,
          invoice: stages["invoice"] || 0,
          done: stages["done"] || 0,
        }));

      // Totals
      const totals = { tshirt: 0, set: 0, ship: 0 };
      (data || []).forEach((row) => {
        if (row.stage === "tshirt") totals.tshirt += row.completed_count;
        if (row.stage === "set") totals.set += row.completed_count;
        if (row.stage === "courier" || row.stage === "invoice" || row.stage === "done")
          totals.ship += row.completed_count;
      });

      return { chartData, totals };
    },
  });
}

export function useMachineReport(from: Date, to: Date) {
  return useQuery({
    queryKey: ["report-machine", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_tracking")
        .select("machine_id, machine_status, completed_count, started_at, completed_at")
        .gte("created_at", startOfDay(from).toISOString())
        .lte("created_at", endOfDay(to).toISOString())
        .not("machine_id", "is", null);
      if (error) throw error;

      const byMachine: Record<string, { total: number; running: number; error: number }> = {};
      (data || []).forEach((row) => {
        const mid = row.machine_id!;
        if (!byMachine[mid]) byMachine[mid] = { total: 0, running: 0, error: 0 };
        byMachine[mid].total += 1;
        if (row.machine_status === "running") byMachine[mid].running += 1;
        if (row.machine_status === "error") byMachine[mid].error += 1;
      });

      return Object.entries(byMachine).map(([name, v]) => ({
        name,
        uptime: v.total > 0 ? Math.round((v.running / v.total) * 100) : 0,
        downtime: v.total > 0 ? Math.round(((v.total - v.running) / v.total) * 100) : 0,
      }));
    },
  });
}

export function useDefectReport(from: Date, to: Date) {
  return useQuery({
    queryKey: ["report-defect", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("inspect_result, inspect_qr_match, inspect_weight, created_at")
        .gte("created_at", startOfDay(from).toISOString())
        .lte("created_at", endOfDay(to).toISOString());
      if (error) throw error;

      const byDate: Record<string, { qrMismatch: number; weightFail: number; pending: number }> = {};
      let totalQr = 0, totalWeight = 0;

      (data || []).forEach((row) => {
        const d = format(new Date(row.created_at), "MM-dd");
        if (!byDate[d]) byDate[d] = { qrMismatch: 0, weightFail: 0, pending: 0 };
        if (row.inspect_result === "mismatch") { byDate[d].qrMismatch += 1; totalQr += 1; }
        if (row.inspect_result === "weight_fail") { byDate[d].weightFail += 1; totalWeight += 1; }
      });

      const chartData = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v }));

      return { chartData, totals: { qrMismatch: totalQr, weightFail: totalWeight } };
    },
  });
}
