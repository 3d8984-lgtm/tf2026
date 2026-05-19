import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileSpreadsheet, CheckCircle2, XCircle, Download, FileUp, Info, Image, QrCode,
  Globe, RefreshCw, ArrowDownToLine, Clock, AlertCircle, CircleAlert, Save, Loader2, Trash2,
  Link, Unlink
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLang } from "@/contexts/LangContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";
import { downloadEmbeddedTemplate } from "@/lib/file-upload-template";

interface ImageFileEntry { file: File; orderFolder?: string; }

export default function FileUpload() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "api");
  useEffect(() => { const t = searchParams.get("tab"); if (t) setTab(t); }, [searchParams]);
  // Prevent browser from navigating when file is dropped outside drop zones
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingDesign, setIsDraggingDesign] = useState(false);
  const [isDraggingTwincode, setIsDraggingTwincode] = useState(false);
  const [apiSyncing, setApiSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const designFileInputRef = useRef<HTMLInputElement>(null);
  const designFolderInputRef = useRef<HTMLInputElement>(null);
  const twincodeFileInputRef = useRef<HTMLInputElement>(null);
  const twincodeFolderInputRef = useRef<HTMLInputElement>(null);
  
  const currentFileRef = useRef<File | null>(null);
  // Files with optional folder-based order matching
  type ImageFileEntry = { file: File; orderFolder?: string };
  const [designFiles, setDesignFiles] = useState<ImageFileEntry[]>([]);
  const [twincodeFiles, setTwincodeFiles] = useState<ImageFileEntry[]>([]);

  const normalizeOrderFolder = (folderName: string) => folderName.replace(/_/g, "-");

  const fileToEntry = (file: File, relativePath?: string): ImageFileEntry => {
    const relPath = relativePath || ((file as any).webkitRelativePath as string | undefined);
    let orderFolder: string | undefined;
    if (relPath) {
      const parts = relPath.split("/").filter(Boolean);
      if (parts.length >= 2) {
        orderFolder = normalizeOrderFolder(parts[parts.length - 2]);
      }
    }
    return { file, orderFolder };
  };

  const filesToEntries = (files: File[]): ImageFileEntry[] => files.map((file) => fileToEntry(file));

  const readDroppedEntry = async (entry: any, parentPath = ""): Promise<ImageFileEntry[]> => {
    if (!entry) return [];

    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
      if (!file || !file.type.startsWith("image/")) return [];
      return [fileToEntry(file, `${parentPath}${file.name}`)];
    }

    if (!entry.isDirectory) return [];

    const reader = entry.createReader();
    const children: any[] = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    const nested = await Promise.all(children.map((child) => readDroppedEntry(child, `${parentPath}${entry.name}/`)));
    return nested.flat();
  };

  const extractDroppedImageEntries = async (dataTransfer: DataTransfer): Promise<ImageFileEntry[]> => {
    const items = Array.from(dataTransfer.items || []);

    if (items.length) {
      const nested = await Promise.all(
        items.map(async (item) => {
          const entry = (item as any).webkitGetAsEntry?.();
          if (entry) return readDroppedEntry(entry);

          const file = item.getAsFile();
          return file && file.type.startsWith("image/") ? [fileToEntry(file)] : [];
        })
      );

      const droppedEntries = nested.flat();
      if (droppedEntries.length > 0) return droppedEntries;
    }

    return filesToEntries(Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/")));
  };
  const [uploadResult, setUploadResult] = useState<null | {
    fileName: string;
    total: number;
    success: number;
    error: number;
    columnResults: { col: string; category: string; label: string; filled: number; empty: number; error: number }[];
  }>(null);
  const [parsedRows, setParsedRows] = useState<any[][]>([]);
  const [saving, setSaving] = useState(false);
  const [logoUploadingId, setLogoUploadingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [unlinkedIds, setUnlinkedIds] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [appliedFolders, setAppliedFolders] = useState<Set<string>>(new Set());
  const [applyingFolders, setApplyingFolders] = useState(false);
  const queryClient = useQueryClient();

  // Apply folders to orders: upload images to storage and update upload_history counts
  const applyFoldersToOrders = async (
    folders: string[],
    designByFolder: Map<string, ImageFileEntry[]>,
    twincodeByFolder: Map<string, ImageFileEntry[]>,
  ): Promise<boolean> => {
    if (folders.length === 0) return false;
    setApplyingFolders(true);
    try {
      // Find orders matching these external_order_id and their upload_history_id
      const { data: orderRows, error: ordErr } = await (supabase
        .from("orders")
        .select("external_order_id,upload_history_id") as any)
        .in("external_order_id", folders);
      if (ordErr) throw ordErr;

      // Group additions per upload_history_id
      const historyAdds = new Map<string, { design: number; twincode: number }>();
      let designUploaded = 0;
      let twincodeUploaded = 0;

      for (const folder of folders) {
        const designEntries = designByFolder.get(folder) || [];
        const twincodeEntries = twincodeByFolder.get(folder) || [];

        // Upload design images
        for (const entry of designEntries) {
          const nameWithoutExt = entry.file.name.replace(/\.[^.]+$/, "");
          const ext = entry.file.name.split(".").pop() || "png";
          const storagePath = `${folder}/${nameWithoutExt}.${ext}`;
          const { error: upErr } = await supabase.storage.from("design-images").upload(storagePath, entry.file, { upsert: true });
          if (!upErr) designUploaded++;
        }
        // Upload twincode images
        for (const entry of twincodeEntries) {
          const nameWithoutExt = entry.file.name.replace(/\.[^.]+$/, "");
          const ext = entry.file.name.split(".").pop() || "png";
          const storagePath = `${folder}/${nameWithoutExt}.${ext}`;
          const { error: upErr } = await supabase.storage.from("twincode-images").upload(storagePath, entry.file, { upsert: true });
          if (!upErr) twincodeUploaded++;
        }

        // Track per-history counts
        const order = (orderRows || []).find((o: any) => o.external_order_id === folder);
        const historyId = order?.upload_history_id;
        if (historyId) {
          const cur = historyAdds.get(historyId) || { design: 0, twincode: 0 };
          cur.design += designEntries.length;
          cur.twincode += twincodeEntries.length;
          historyAdds.set(historyId, cur);
        }
      }

      // Overwrite upload_history counts with the latest values (no accumulation)
      for (const [historyId, add] of historyAdds.entries()) {
        await (supabase.from("upload_history").update({
          design_image_count: add.design,
          twincode_image_count: add.twincode,
        } as any) as any).eq("id", historyId);
      }

      queryClient.invalidateQueries({ queryKey: ["upload_history"] });
      toast({
        title: isKo
          ? `${folders.length}건 적용 완료`
          : `已应用 ${folders.length} 条`,
        description: isKo
          ? `디자인 ${designUploaded}장, 트윈코드 ${twincodeUploaded}장 업로드됨`
          : `设计 ${designUploaded} 张, TwinCode ${twincodeUploaded} 张已上传`,
      });
      return true;
    } catch (err) {
      console.error("Apply folders error:", err);
      toast({ title: isKo ? "적용 실패" : "应用失败", variant: "destructive" });
      return false;
    } finally {
      setApplyingFolders(false);
    }
  };

  // Save a single category (design or twincode) to storage and update history counts
  // Track per-category so design and twincode uploads can run independently in parallel
  const [savingCategories, setSavingCategories] = useState<Set<"design" | "twincode">>(new Set());
  const [saveProgressMap, setSaveProgressMap] = useState<Record<"design" | "twincode", { done: number; total: number }>>({
    design: { done: 0, total: 0 },
    twincode: { done: 0, total: 0 },
  });
  const saveImagesByCategory = async (category: "design" | "twincode") => {
    const entries = category === "design" ? designFiles : twincodeFiles;
    if (entries.length === 0) {
      toast({ title: isKo ? "업로드할 이미지가 없습니다" : "没有可上传的图片", variant: "destructive" });
      return;
    }
    if (savingCategories.has(category)) return;
    setSavingCategories(prev => {
      const next = new Set(prev);
      next.add(category);
      return next;
    });
    setSaveProgressMap(prev => ({ ...prev, [category]: { done: 0, total: entries.length } }));
    try {
      const bucket = category === "design" ? "design-images" : "twincode-images";

      // Group by folder
      const byFolder = new Map<string, ImageFileEntry[]>();
      const noFolder: ImageFileEntry[] = [];
      entries.forEach(e => {
        if (e.orderFolder) {
          const arr = byFolder.get(e.orderFolder) || [];
          arr.push(e);
          byFolder.set(e.orderFolder, arr);
        } else {
          noFolder.push(e);
        }
      });

      // Lookup upload_history_id for matched folders
      const folders = [...byFolder.keys()];
      let orderRows: any[] = [];
      if (folders.length > 0) {
        const { data } = await (supabase
          .from("orders")
          .select("external_order_id,upload_history_id") as any)
          .in("external_order_id", folders);
        orderRows = data || [];
      }
      const matchedFolders = new Set(orderRows.map((o: any) => o.external_order_id));
      const unmatchedFolders = folders.filter(f => !matchedFolders.has(f));

      // Build full upload task list
      type Task = { folder: string | null; entry: ImageFileEntry; storagePath: string };
      const tasks: Task[] = [];
      for (const [folder, items] of byFolder.entries()) {
        for (const entry of items) {
          const nameWithoutExt = entry.file.name.replace(/\.[^.]+$/, "");
          const ext = entry.file.name.split(".").pop() || "png";
          tasks.push({ folder, entry, storagePath: `${folder}/${nameWithoutExt}.${ext}` });
        }
      }
      const ts = Date.now();
      noFolder.forEach((entry, idx) => {
        const nameWithoutExt = entry.file.name.replace(/\.[^.]+$/, "");
        const ext = entry.file.name.split(".").pop() || "png";
        tasks.push({ folder: null, entry, storagePath: `_unassigned/${ts}-${idx}-${nameWithoutExt}.${ext}` });
      });

      // Parallel upload with concurrency limit
      const CONCURRENCY = 8;
      let uploaded = 0;
      let failed = 0;
      let completed = 0;
      const folderSuccessCounts = new Map<string, number>();

      const runTask = async (task: Task) => {
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(task.storagePath, task.entry.file, { upsert: true });
        if (upErr) {
          failed++;
        } else {
          uploaded++;
          if (task.folder) {
            folderSuccessCounts.set(task.folder, (folderSuccessCounts.get(task.folder) || 0) + 1);
          }
        }
        completed++;
        setSaveProgressMap(prev => ({ ...prev, [category]: { done: completed, total: tasks.length } }));
      };

      // Worker pool
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
        while (cursor < tasks.length) {
          const idx = cursor++;
          await runTask(tasks[idx]);
        }
      });
      await Promise.all(workers);

      // Aggregate per upload_history
      const historyAdds = new Map<string, number>();
      for (const [folder, count] of folderSuccessCounts.entries()) {
        const order = orderRows.find(o => o.external_order_id === folder);
        const historyId = order?.upload_history_id;
        if (historyId) {
          historyAdds.set(historyId, (historyAdds.get(historyId) || 0) + count);
        }
      }

      // Overwrite upload_history count with the latest value (no accumulation)
      const countCol = category === "design" ? "design_image_count" : "twincode_image_count";
      await Promise.all(
        [...historyAdds.entries()].map(async ([historyId, add]) => {
          await (supabase.from("upload_history").update({ [countCol]: add } as any) as any).eq("id", historyId);
        })
      );

      queryClient.invalidateQueries({ queryKey: ["upload_history"] });

      // Mark applied folders as applied (so apply button reflects state)
      if (folders.length > 0) {
        setAppliedFolders(prev => {
          const next = new Set(prev);
          folders.forEach(f => next.add(f));
          return next;
        });
      }

      // Clear the saved files from the picker
      if (category === "design") setDesignFiles([]);
      else setTwincodeFiles([]);

      const matchedCount = orderRows.length > 0
        ? [...byFolder.entries()].filter(([f]) => matchedFolders.has(f)).reduce((a, [, items]) => a + items.length, 0)
        : 0;
      const unmatchedFolderCount = [...byFolder.entries()].filter(([f]) => !matchedFolders.has(f)).reduce((a, [, items]) => a + items.length, 0);
      const totalUnmatched = unmatchedFolderCount + noFolder.length;
      const noOrdersHint = folders.length > 0 && orderRows.length === 0;

      toast({
        title: isKo
          ? `${uploaded}장 저장 완료${failed > 0 ? `, ${failed}장 실패` : ""}`
          : `${uploaded} 张已保存${failed > 0 ? `, ${failed} 张失败` : ""}`,
        description: isKo
          ? `매칭 ${matchedCount}장 · 미매칭 ${totalUnmatched}장${noOrdersHint ? " · ⚠️ 폴더명과 일치하는 주문이 없습니다. 먼저 주문 데이터를 가져오세요." : unmatchedFolders.length > 0 ? ` (미일치 폴더: ${unmatchedFolders.slice(0, 3).join(", ")}${unmatchedFolders.length > 3 ? "..." : ""})` : ""}`
          : `匹配 ${matchedCount} 张 · 未匹配 ${totalUnmatched} 张${noOrdersHint ? " · ⚠️ 无匹配订单，请先导入订单数据" : unmatchedFolders.length > 0 ? ` (未匹配文件夹: ${unmatchedFolders.slice(0, 3).join(", ")}${unmatchedFolders.length > 3 ? "..." : ""})` : ""}`,
        variant: failed > 0 || noOrdersHint ? "destructive" : "default",
      });
    } catch (err) {
      console.error("Save images error:", err);
      toast({ title: isKo ? "저장 실패" : "保存失败", variant: "destructive" });
    } finally {
      setSavingCategories(prev => {
        const next = new Set(prev);
        next.delete(category);
        return next;
      });
      setSaveProgressMap(prev => ({ ...prev, [category]: { done: 0, total: 0 } }));
    }
  };


  // Logo upload handler for history entries
  const handleHistoryLogoUpload = async (historyId: string, file: File, oldLogoPath: string | null) => {
    setLogoUploadingId(historyId);
    try {
      // Delete old logo if exists
      if (oldLogoPath) {
        await supabase.storage.from("order-logos").remove([oldLogoPath]);
      }
      const ext = file.name.split(".").pop() || "png";
      const logoPath = `history/${Date.now()}-${historyId}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("order-logos").upload(logoPath, file);
      if (uploadErr) {
        toast({ title: isKo ? "로고 업로드 실패" : "Logo上传失败", variant: "destructive" });
        return;
      }
      await supabase.from("upload_history").update({ logo_path: logoPath }).eq("id", historyId);
      queryClient.invalidateQueries({ queryKey: ["upload_history"] });
      toast({ title: isKo ? "로고 업로드 완료" : "Logo上传完成" });
    } catch (err) {
      console.error("Logo upload error:", err);
      toast({ title: isKo ? "로고 업로드 실패" : "Logo上传失败", variant: "destructive" });
    } finally {
      setLogoUploadingId(null);
    }
  };

  const isSafeStoragePath = (path: string | null | undefined) => !!path && /^[A-Za-z0-9._/-]+$/.test(path);
  const handleLinkWork = async (historyId: string) => {
    setLinkingId(historyId);
    try {
      // Check if orders already linked to this history
      const { data: linkedOrders } = await (supabase
        .from("orders")
        .select("id") as any)
        .eq("upload_history_id", historyId);

      if (linkedOrders && linkedOrders.length > 0) {
        // Orders exist – ensure production_tracking & shipments exist for each
        let createdTracking = 0;
        let createdShipments = 0;
        const stages = ["tshirt", "card", "set", "weight", "courier", "invoice", "done"];

        for (const order of linkedOrders) {
          // Check existing tracking
          const { data: existingTracking } = await supabase
            .from("production_tracking")
            .select("stage")
            .eq("order_id", order.id);
          const existingStages = new Set((existingTracking || []).map((t: any) => t.stage));
          const missingStages = stages.filter(s => !existingStages.has(s));
          if (missingStages.length > 0) {
            const rows = missingStages.map(stage => ({
              order_id: order.id,
              stage: stage as any,
              completed_count: 0,
            }));
            await supabase.from("production_tracking").insert(rows);
            createdTracking += missingStages.length;
          }

          // Check existing shipment
          const { data: existingShipment } = await supabase
            .from("shipments")
            .select("id")
            .eq("order_id", order.id);
          if (!existingShipment || existingShipment.length === 0) {
            await supabase.from("shipments").insert({
              order_id: order.id,
              carrier: "4px",
              status: "pending" as any,
              inspect_result: "pending" as any,
            });
            createdShipments++;
          }
        }

        queryClient.invalidateQueries({ queryKey: ["production_tracking"] });
        queryClient.invalidateQueries({ queryKey: ["shipments"] });
        toast({
          title: isKo ? `작업 연동 완료 (${linkedOrders.length}건)` : `作业关联完成 (${linkedOrders.length}条)`,
          description: isKo
            ? `생산추적 ${createdTracking}건, 배송 ${createdShipments}건 생성됨`
            : `生产跟踪 ${createdTracking}条, 配送 ${createdShipments}条 已创建`,
        });
      } else {
        toast({ title: isKo ? "연동할 주문이 없습니다. 먼저 데이터를 저장하세요." : "没有可关联的订单，请先保存数据", variant: "destructive" });
      }
    } catch (err) {
      console.error("Link error:", err);
      toast({ title: isKo ? "연동 실패" : "关联失败", variant: "destructive" });
    } finally {
      setLinkingId(null);
    }
  };

  // 연동 삭제: Remove all orders (and cascading tracking/shipments) for this upload
  const handleUnlinkWork = async (historyId: string) => {
    setUnlinkingId(historyId);
    try {
      const { data: linkedOrders, error: fetchErr } = await (supabase
        .from("orders")
        .select("id") as any)
        .eq("upload_history_id", historyId);
      if (fetchErr) throw fetchErr;
      if (!linkedOrders || linkedOrders.length === 0) {
        setUnlinkedIds(prev => new Set(prev).add(historyId));
        toast({ title: isKo ? "연동된 데이터가 없습니다" : "没有关联数据" });
        return;
      }
      const orderIds = linkedOrders.map(o => o.id);
      // Delete orders (production_tracking and shipments cascade)
      const { error: delErr } = await supabase.from("orders").delete().in("id", orderIds);
      if (delErr) throw delErr;

      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order_stats"] });
      queryClient.invalidateQueries({ queryKey: ["production_tracking"] });
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      setUnlinkedIds(prev => new Set(prev).add(historyId));
      toast({
        title: isKo ? `${linkedOrders.length}건 연동 삭제 완료` : `已删除${linkedOrders.length}条关联数据`,
        description: isKo ? "주문, 생산 추적, 배송 데이터가 모두 삭제되었습니다" : "订单、生产跟踪、配送数据已全部删除",
      });
    } catch (err) {
      console.error("Unlink error:", err);
      toast({ title: isKo ? "연동 삭제 실패" : "删除关联失败", variant: "destructive" });
    } finally {
      setUnlinkingId(null);
    }
  };



  // Remove all design/twincode images stored under folders matching the orders linked to this history,
  // and also delete the linked orders along with their production_tracking and shipments records.
  // Returns a summary of which folders existed and how many files were removed/failed per bucket.
  type ImageRemovalSummary = {
    foldersChecked: number;
    foldersExisting: number;
    design: { removed: number; failed: number };
    twincode: { removed: number; failed: number };
    ordersDeleted: number;
    trackingDeleted: number;
    shipmentsDeleted: number;
    errors: string[];
  };
  const removeOrderImagesForHistory = async (historyId: string): Promise<ImageRemovalSummary> => {
    const summary: ImageRemovalSummary = {
      foldersChecked: 0,
      foldersExisting: 0,
      design: { removed: 0, failed: 0 },
      twincode: { removed: 0, failed: 0 },
      ordersDeleted: 0,
      trackingDeleted: 0,
      shipmentsDeleted: 0,
      errors: [],
    };
    try {
      const { data: linkedOrders } = await (supabase
        .from("orders")
        .select("id, external_order_id") as any)
        .eq("upload_history_id", historyId);
      const orderIds = (linkedOrders || [])
        .map((o: any) => o?.id)
        .filter((id: any): id is string => typeof id === "string" && id.length > 0);
      const folders = (linkedOrders || [])
        .map((o: any) => o?.external_order_id)
        .filter((f: any): f is string => typeof f === "string" && f.length > 0);
      summary.foldersChecked = folders.length;

      // Track which folders exist in at least one bucket
      const existingFolders = new Set<string>();

      const bucketKeys = [
        { bucket: "design-images", key: "design" as const },
        { bucket: "twincode-images", key: "twincode" as const },
      ];

      if (folders.length > 0) {
        for (const { bucket, key } of bucketKeys) {
          for (const folder of folders) {
            const { data: files, error: listErr } = await supabase.storage
              .from(bucket)
              .list(folder, { limit: 1000 });
            if (listErr) {
              summary.errors.push(`${bucket}/${folder}: ${listErr.message}`);
              continue;
            }
            if (files && files.length > 0) {
              existingFolders.add(folder);
              const paths = files.map((f) => `${folder}/${f.name}`);
              const { data: removed, error: rmErr } = await supabase.storage
                .from(bucket)
                .remove(paths);
              if (rmErr) {
                summary[key].failed += paths.length;
                summary.errors.push(`${bucket}/${folder}: ${rmErr.message}`);
              } else {
                const removedCount = removed?.length ?? paths.length;
                summary[key].removed += removedCount;
                summary[key].failed += Math.max(0, paths.length - removedCount);
              }
            }
          }
        }
      }
      summary.foldersExisting = existingFolders.size;

      // Cascade-delete linked DB records so other menus don't show stale data:
      // production_tracking & shipments first (they reference orders), then orders.
      if (orderIds.length > 0) {
        const { data: trkDel, error: trkErr } = await supabase
          .from("production_tracking")
          .delete()
          .in("order_id", orderIds)
          .select("id");
        if (trkErr) {
          summary.errors.push(`production_tracking: ${trkErr.message}`);
        } else {
          summary.trackingDeleted = trkDel?.length ?? 0;
        }

        const { data: shpDel, error: shpErr } = await supabase
          .from("shipments")
          .delete()
          .in("order_id", orderIds)
          .select("id");
        if (shpErr) {
          summary.errors.push(`shipments: ${shpErr.message}`);
        } else {
          summary.shipmentsDeleted = shpDel?.length ?? 0;
        }

        const { data: ordDel, error: ordErr } = await supabase
          .from("orders")
          .delete()
          .in("id", orderIds)
          .select("id");
        if (ordErr) {
          summary.errors.push(`orders: ${ordErr.message}`);
        } else {
          summary.ordersDeleted = ordDel?.length ?? 0;
        }
      }
    } catch (err: any) {
      console.error("removeOrderImagesForHistory error:", err);
      summary.errors.push(err?.message || String(err));
    }
    return summary;
  };

  // Build a localized toast description from the removal summary
  const formatRemovalSummary = (s: ImageRemovalSummary) => {
    if (isKo) {
      const dataPart = `주문 ${s.ordersDeleted} · 공정 ${s.trackingDeleted} · 배송 ${s.shipmentsDeleted}`;
      if (s.foldersChecked === 0) {
        const base = `연결된 주문 폴더 없음 · ${dataPart}`;
        return s.errors.length > 0 ? `${base} · 오류 ${s.errors.length}건` : base;
      }
      const base = `폴더 ${s.foldersExisting}/${s.foldersChecked}개 · 디자인 ${s.design.removed}${s.design.failed ? `(실패 ${s.design.failed})` : ""} · 트윈코드 ${s.twincode.removed}${s.twincode.failed ? `(실패 ${s.twincode.failed})` : ""} · ${dataPart}`;
      return s.errors.length > 0 ? `${base} · 오류 ${s.errors.length}건` : base;
    }
    const dataPart = `订单 ${s.ordersDeleted} · 工序 ${s.trackingDeleted} · 配送 ${s.shipmentsDeleted}`;
    if (s.foldersChecked === 0) {
      const base = `无关联订单文件夹 · ${dataPart}`;
      return s.errors.length > 0 ? `${base} · 错误 ${s.errors.length}` : base;
    }
    const base = `文件夹 ${s.foldersExisting}/${s.foldersChecked} · 设计 ${s.design.removed}${s.design.failed ? `(失败 ${s.design.failed})` : ""} · 双码 ${s.twincode.removed}${s.twincode.failed ? `(失败 ${s.twincode.failed})` : ""} · ${dataPart}`;
    return s.errors.length > 0 ? `${base} · 错误 ${s.errors.length}` : base;
  };


  // Detect API connection status: WEBHOOK_SECRET configured AND
  // a real external order event (order_create/order_update, status=processed)
  // received within the last 24 hours.
  const { data: webhookSecretStatus } = useQuery({
    queryKey: ["webhook_secret_status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("webhook-status");
      if (error) return { secret_configured: false };
      return data as { secret_configured: boolean };
    },
    refetchInterval: 60000,
  });

  const { data: lastWebhook } = useQuery({
    queryKey: ["last_webhook_log_real"],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_logs")
        .select("created_at,status,event_type,source")
        .in("event_type", ["order_create", "order_update"])
        .eq("status", "processed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { created_at: string; status: string; event_type: string; source: string } | null;
    },
    refetchInterval: 30000,
  });
  const lastWebhookAt = lastWebhook?.created_at ? new Date(lastWebhook.created_at) : null;
  const hasRecentReceipt = !!lastWebhookAt && (Date.now() - lastWebhookAt.getTime() < 24 * 60 * 60 * 1000);
  const isApiConnected = !!webhookSecretStatus?.secret_configured && hasRecentReceipt;

  // Fetch upload history from DB and reconcile image counts with actual storage files
  const { data: allUploadHistory = [] } = useQuery({
    queryKey: ["upload_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) return rows;

      // For each upload_history row, look up its orders' folders and count files in storage
      const historyIds = rows.map((r: any) => r.id);
      const { data: orderRows } = await (supabase
        .from("orders")
        .select("external_order_id,upload_history_id,recipient_name,source_data") as any)
        .in("upload_history_id", historyIds);

      const foldersByHistory = new Map<string, string[]>();
      const twinkersByHistory = new Map<string, string[]>();
      (orderRows || []).forEach((o: any) => {
        const arr = foldersByHistory.get(o.upload_history_id) || [];
        arr.push(o.external_order_id);
        foldersByHistory.set(o.upload_history_id, arr);

        // Collect unique twinker names per history.
        // File upload: source_data.items[*].twinker. Webhook: order.twinker / recipient_name.
        const tArr = twinkersByHistory.get(o.upload_history_id) || [];
        const items = (o.source_data && (o.source_data as any).items) || [];
        if (Array.isArray(items) && items.length) {
          items.forEach((it: any) => {
            const t = (it?.twinker || "").toString().trim();
            if (t && !tArr.includes(t)) tArr.push(t);
          });
        }
        const fromOrder = (o.source_data?.order?.twinker || o.source_data?.twinker || "").toString().trim();
        if (fromOrder && !tArr.includes(fromOrder)) tArr.push(fromOrder);
        if (!tArr.length && o.recipient_name) {
          const rn = String(o.recipient_name).trim();
          if (rn && rn !== "N/A") tArr.push(rn);
        }
        twinkersByHistory.set(o.upload_history_id, tArr);
      });

      // Count files per history by listing each folder in both buckets
      const reconciled = await Promise.all(rows.map(async (r: any) => {
        const folders = foldersByHistory.get(r.id) || [];
        const twinkers = twinkersByHistory.get(r.id) || [];
        if (folders.length === 0) return { ...r, twinkers };

        const [designCounts, twincodeCounts] = await Promise.all([
          Promise.all(folders.map(async (f) => {
            const { data: files } = await supabase.storage.from("design-images").list(f, { limit: 1000 });
            return files?.length || 0;
          })),
          Promise.all(folders.map(async (f) => {
            const { data: files } = await supabase.storage.from("twincode-images").list(f, { limit: 1000 });
            return files?.length || 0;
          })),
        ]);
        const designTotal = designCounts.reduce((a, b) => a + b, 0);
        const twincodeTotal = twincodeCounts.reduce((a, b) => a + b, 0);

        // Persist back if different
        if (designTotal !== r.design_image_count || twincodeTotal !== r.twincode_image_count) {
          await (supabase.from("upload_history").update({
            design_image_count: designTotal,
            twincode_image_count: twincodeTotal,
          } as any) as any).eq("id", r.id);
        }
        return { ...r, design_image_count: designTotal, twincode_image_count: twincodeTotal, twinkers };
      }));

      return reconciled;
    },
  });

  // Split history by source
  const uploadHistory = allUploadHistory.filter((h: any) => (h.source || 'file') === 'file');
  const apiHistory = allUploadHistory.filter((h: any) => (h.source) === 'api');

  // Column spec for file upload (24 fields, matches API ingest)
  const CAT_ORDER = isKo ? "주문 정보" : "订单信息";
  const CAT_CARD = isKo ? "트윈코드/카드 디자인" : "TwinCode/卡片设计";
  const CAT_TSHIRT = isKo ? "티셔츠 정보" : "T恤信息";
  const CAT_SHIP = isKo ? "배송 정보" : "配送信息";
  const columnSpec = [
    { col: "A", category: CAT_ORDER, key: "work_order_no", label: isKo ? "작업번호" : "作业编号", desc: isKo ? "고유 작업번호" : "唯一作业编号" },
    { col: "B", category: CAT_ORDER, key: "order_serial_no", label: isKo ? "주문일련번호" : "订单流水号", desc: isKo ? "주문 식별 일련번호" : "订单识别流水号" },
    { col: "C", category: CAT_ORDER, key: "twinker_name", label: isKo ? "트윈커명" : "Twinker名", desc: isKo ? "트윈커(주문자) 이름" : "Twinker(下单人)名称" },

    { col: "D", category: CAT_CARD, key: "twincode_svg_url", label: isKo ? "트윈코드 SVG (링크)" : "TwinCode SVG (链接)", desc: isKo ? "트윈코드 SVG 다운로드 URL" : "TwinCode SVG下载URL" },
    { col: "E", category: CAT_CARD, key: "design_png_url", label: isKo ? "디자인 PNG (링크)" : "设计 PNG (链接)", desc: isKo ? "디자인 PNG 이미지 URL" : "设计PNG图片URL" },
    { col: "F", category: CAT_CARD, key: "cp_value", label: isKo ? "CP값" : "CP值", desc: isKo ? "CP 식별 값" : "CP识别值" },
    { col: "G", category: CAT_CARD, key: "sequence_no", label: isKo ? "순번번호" : "序号", desc: isKo ? "발행 순번" : "发行序号" },
    { col: "H", category: CAT_CARD, key: "twincode_png_url", label: isKo ? "트윈코드 PNG (링크)" : "TwinCode PNG (链接)", desc: isKo ? "트윈코드 PNG 이미지 URL" : "TwinCode PNG URL" },
    { col: "I", category: CAT_CARD, key: "dm_barcode_png_url", label: isKo ? "DM 바코드 PNG (링크)" : "DM条码 PNG (链接)", desc: isKo ? "DM 바코드 이미지 URL" : "DM条码图片URL" },
    { col: "J", category: CAT_CARD, key: "edition", label: isKo ? "EDITION 값" : "EDITION值", desc: isKo ? "에디션 번호" : "版本号" },
    { col: "K", category: CAT_CARD, key: "minted_on", label: isKo ? "Minted on 값" : "Minted on值", desc: isKo ? "발행일(Minted on)" : "发行日期" },
    { col: "L", category: CAT_CARD, key: "grade", label: isKo ? "등급 값" : "等级值", desc: isKo ? "카드 등급" : "卡片等级" },
    { col: "M", category: CAT_CARD, key: "sign_png_url", label: isKo ? "싸인 PNG (링크)" : "签名 PNG (链接)", desc: isKo ? "사인 이미지 URL" : "签名图片URL" },
    { col: "N", category: CAT_CARD, key: "card_front_png_url", label: isKo ? "카드 앞면 디자인 PNG (링크)" : "卡片正面设计 PNG (链接)", desc: isKo ? "카드 앞면 이미지 URL" : "卡片正面图片URL" },
    { col: "O", category: CAT_CARD, key: "card_back_png_url", label: isKo ? "카드 뒷면 디자인 PNG (링크)" : "卡片背面设计 PNG (链接)", desc: isKo ? "카드 뒷면 이미지 URL" : "卡片背面图片URL" },
    { col: "P", category: CAT_CARD, key: "logo_png_url", label: isKo ? "LOGO PNG (링크)" : "LOGO PNG (链接)", desc: isKo ? "로고 이미지 URL" : "LOGO图片URL" },

    { col: "Q", category: CAT_TSHIRT, key: "tshirt_type", label: isKo ? "티셔츠 종류" : "T恤种类", desc: isKo ? "티셔츠 제품 유형" : "T恤产品类型" },
    { col: "R", category: CAT_TSHIRT, key: "tshirt_color", label: isKo ? "티셔츠 컬러" : "T恤颜色", desc: isKo ? "티셔츠 색상" : "T恤颜色" },
    { col: "S", category: CAT_TSHIRT, key: "tshirt_size", label: isKo ? "티셔츠 사이즈" : "T恤尺码", desc: isKo ? "티셔츠 사이즈" : "T恤尺码" },

    { col: "T", category: CAT_SHIP, key: "country_code", label: isKo ? "국가기호" : "国家代码", desc: isKo ? "배송 국가 코드" : "配送国家代码" },
    { col: "U", category: CAT_SHIP, key: "recipient", label: isKo ? "수취인명" : "收件人", desc: isKo ? "택배 수취인 이름" : "快递收件人姓名" },
    { col: "V", category: CAT_SHIP, key: "phone", label: isKo ? "연락처" : "联系方式", desc: isKo ? "수취인 연락처" : "收件人联系方式" },
    { col: "W", category: CAT_SHIP, key: "address", label: isKo ? "주소" : "地址", desc: isKo ? "배송지 주소" : "配送地址" },
    { col: "X", category: CAT_SHIP, key: "zipcode", label: isKo ? "우편번호" : "邮编", desc: isKo ? "배송지 우편번호" : "配送地邮编" },
  ];

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return;
    }
    setSaved(false);
    setDesignFiles([]);
    setTwincodeFiles([]);
    currentFileRef.current = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const dataRows = rows.slice(2);
        const totalRows = dataRows.length;

        const colResults = columnSpec.map((spec, idx) => {
          let filled = 0, empty = 0;
          dataRows.forEach((row) => {
            const val = row[idx];
            if (val === undefined || val === null || String(val).trim() === "") {
              empty++;
            } else {
              filled++;
            }
          });
          return { col: spec.col, category: spec.category, label: spec.label, filled, empty, error: 0 };
        });

        setParsedRows(dataRows);
        setUploadResult({
          fileName: file.name,
          total: totalRows,
          success: totalRows,
          error: 0,
          columnResults: colResults,
        });
      } catch (err) {
        console.error("Failed to parse xlsx:", err);
      }
    };
    reader.readAsArrayBuffer(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKo]);

  const handleSaveToDb = async () => {
    if (!parsedRows.length) return;
    setSaving(true);
    try {
      // Map Excel rows to orders table
      // A(0): work_order_no → external_order_id
      // B(1): order_no → product_code
      // C(2): project_deadline → project_completed_at
      // D(3): twinker (recipient_name fallback)
      // E(4): tshirt_serial, F(5): tshirt_type, G(6): tshirt_color, H(7): tshirt_size
      // I(8): silicon_qr, J(9): design_qr, K(10): hologram_qr
      // L(11): card_serial, M(12): card_grade, N(13): card_barcode
      // O(14): country_code, P(15): recipient, Q(16): phone, R(17): address, S(18): zipcode

      // Group rows by external_order_id (work order no) since multiple rows can share the same order
      const orderMap = new Map<string, {
        external_order_id: string;
        product_code: string;
        design_code: string | null;
        quantity: number;
        recipient_name: string;
        recipient_phone: string | null;
        shipping_address: string;
        shipping_city: string | null;
        shipping_state: string | null;
        shipping_zip: string | null;
        shipping_country: string;
        project_completed_at: string | null;
        source_data: Json;
        logo_url?: string | null;
      }>();

      for (const row of parsedRows) {
        const str = (idx: number) => String(row[idx] ?? "").trim();
        const extId = str(0);
        if (!extId) continue;

        // Parse date
        let projectDate: string | null = null;
        const rawDate = row[2];
        if (rawDate) {
          if (typeof rawDate === "number") {
            const d = XLSX.SSF.parse_date_code(rawDate);
            if (d) projectDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
          } else {
            projectDate = String(rawDate).trim() || null;
          }
        }

        const itemData = {
          twinker: str(3),
          tshirt_serial: str(4),
          tshirt_type: str(5),
          tshirt_color: str(6),
          tshirt_size: str(7),
          silicon_qr: str(8),
          design_qr: str(9),
          hologram_qr: str(10),
          card_serial: str(11),
          card_grade: str(12),
          card_barcode: str(13),
        };

        if (orderMap.has(extId)) {
          const existing = orderMap.get(extId)!;
          existing.quantity += 1;
          // Append item to items array in source_data
          ((existing.source_data as { items: Record<string, string>[] }).items).push(itemData);
        } else {
          // Twinker (D, idx=3) preferred for recipient_name; fall back to recipient (P, idx=15)
          const twinkerName = str(3);
          const recipientName = str(15);
          orderMap.set(extId, {
            external_order_id: extId,
            product_code: str(1) || extId,
            design_code: str(9) || null,
            quantity: 1,
            recipient_name: twinkerName || recipientName || "N/A",
            recipient_phone: str(16) || null,
            shipping_address: str(17) || "N/A",
            shipping_city: null,
            shipping_state: null,
            shipping_zip: str(18) || null,
            shipping_country: str(14) || "US",
            project_completed_at: projectDate,
            source_data: { items: [itemData] },
          });
        }
      }

      const orders = Array.from(orderMap.values());

      if (!orders.length) {
        toast({ title: isKo ? "저장할 데이터가 없습니다" : "没有可保存的数据", variant: "destructive" });
        setSaving(false);
        return;
      }

      // Upsert in batches of 50 (handles duplicate external_order_id)
      let successCount = 0;
      let errorCount = 0;
      for (let i = 0; i < orders.length; i += 50) {
        const batch = orders.slice(i, i + 50);
        const { error } = await supabase.from("orders").upsert(batch as any, { onConflict: "external_order_id" });
        if (error) {
          console.error("Upsert error:", error);
          errorCount += batch.length;
        } else {
          successCount += batch.length;
        }
      }

      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order_stats"] });

      // Save file to storage
      const file = currentFileRef.current;
      let filePath: string | null = null;
      let fileUploadFailed = false;
      if (file) {
        const ts = Date.now();
        const ext = file.name.split(".").pop() || "xlsx";
        const storagePath = `${ts}.${ext}`;
        const { error: storageError } = await supabase.storage.from("upload-files").upload(storagePath, file);
        if (storageError) {
          console.error("Storage upload error:", storageError);
          fileUploadFailed = true;
        } else {
          filePath = storagePath;
        }
      }

      const { data: sessionData } = await supabase.auth.getUser();
      const userEmail = sessionData?.user?.email || null;
      const userId = sessionData?.user?.id || null;

      // Create upload_history record first to get its ID
      const { data: historyRow, error: historyErr } = await supabase.from("upload_history").insert({
        file_name: uploadResult?.fileName || file?.name || "unknown",
        row_count: parsedRows.length,
        success_count: successCount,
        error_count: errorCount,
        user_email: userEmail,
        user_id: userId,
        file_path: filePath,
        design_image_count: designFiles.length,
        twincode_image_count: twincodeFiles.length,
      } as any).select("id").single();

      const historyId = historyRow?.id || null;

      // Update orders with upload_history_id
      if (historyId) {
        const extIds = orders.map(o => o.external_order_id);
        await supabase.from("orders").update({ upload_history_id: historyId } as any).in("external_order_id", extIds);

        // Upload design images to storage - use orderFolder if available, else historyId
        if (designFiles.length > 0) {
          for (const entry of designFiles) {
            const nameWithoutExt = entry.file.name.replace(/\.[^.]+$/, "");
            const ext = entry.file.name.split(".").pop() || "png";
            const folder = entry.orderFolder || historyId;
            const storagePath = `${folder}/${nameWithoutExt}.${ext}`;
            await supabase.storage.from("design-images").upload(storagePath, entry.file, { upsert: true });
          }
        }

        // Upload twincode images to storage - use orderFolder if available, else historyId
        if (twincodeFiles.length > 0) {
          for (const entry of twincodeFiles) {
            const nameWithoutExt = entry.file.name.replace(/\.[^.]+$/, "");
            const ext = entry.file.name.split(".").pop() || "png";
            const folder = entry.orderFolder || historyId;
            const storagePath = `${folder}/${nameWithoutExt}.${ext}`;
            await supabase.storage.from("twincode-images").upload(storagePath, entry.file, { upsert: true });
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["upload_history"] });

      if (errorCount > 0) {
        toast({
          title: isKo ? `주문 ${successCount}건 저장, ${errorCount}건 오류` : `${successCount}条订单已保存, ${errorCount}条异常`,
          description: isKo ? `총 ${parsedRows.length}행 처리` : `共处理${parsedRows.length}行`,
          variant: "destructive",
        });
      } else if (fileUploadFailed) {
        toast({
          title: isKo ? `주문 ${successCount}건 저장 완료` : `${successCount}条订单保存成功`,
          description: isKo ? "파일 원본 저장에는 실패했습니다. 이력 다운로드는 사용할 수 없습니다." : "原始文件保存失败，历史下载不可用。",
          variant: "destructive",
        });
      } else {
        toast({
          title: isKo ? `주문 ${successCount}건 저장 완료` : `${successCount}条订单保存成功`,
          description: isKo ? `${parsedRows.length}행 → ${successCount}건 주문 등록` : `${parsedRows.length}行 → ${successCount}条订单注册`,
        });
      }
    } catch (err) {
      console.error("Save error:", err);
      toast({ title: isKo ? "저장 중 오류 발생" : "保存时发生错误", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const categoryBadges = [
    { label: isKo ? "주문확인" : "订单确认", cols: "A~C" },
    { label: isKo ? "티셔츠 작업용" : "T恤作业用", cols: "D~J" },
    { label: isKo ? "카드 포장용" : "卡片包装用", cols: "K~M" },
    { label: isKo ? "택배송장정보" : "快递面单信息", cols: "N~R" },
  ];

  const handleDownloadTemplate = () => {
    downloadEmbeddedTemplate(isKo ? "템플릿.xlsx" : "模板.xlsx");
  };

  const handleApiSync = () => {
    setApiSyncing(true);
    setTimeout(() => setApiSyncing(false), 2000);
  };

  

  return (
    <div>
      <PageHeader
        title={isKo ? "주문 데이터 가져오기" : "订单数据导入"}
        description={isKo ? "API 연동 또는 엑셀 파일로 주문 데이터를 가져옵니다" : "通过API连接或Excel文件导入订单数据"}
      />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="api" className="gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              {isKo ? "API 연동" : "API连接"}
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1.5">
              <FileUp className="w-3.5 h-3.5" />
              {isKo ? "파일 업로드" : "文件上传"}
            </TabsTrigger>
          </TabsList>

          {/* ═══ API Tab ═══ */}
          <TabsContent value="api" className="space-y-6">
            {/* API connection status */}
            <div className="kpi-card section-enter">
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                  <Globe className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">
                      {isKo ? "TWINMETA 사이트 API 연동" : "TWINMETA站点 API连接"}
                    </h3>
                    <span className={`status-badge ${isApiConnected ? "status-running" : "status-stopped"}`}>
                      {isApiConnected
                        ? (isKo ? "연결됨" : "已连接")
                        : (isKo ? "대기 중" : "等待中")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {isKo
                      ? "Webhook을 통해 TWINMETA 사이트에서 실시간으로 주문 데이터를 수신합니다. 수동 동기화 버튼으로 누락 건을 확인할 수 있습니다."
                      : "通过Webhook从TWINMETA站点实时接收订单数据。可通过手动同步按钮检查遗漏订单。"}
                  </p>
                  <div className="flex items-center gap-3">
                    <Button size="sm" className="gap-1.5" onClick={handleApiSync} disabled={apiSyncing}>
                      <RefreshCw className={`w-3.5 h-3.5 ${apiSyncing ? "animate-spin" : ""}`} />
                      {apiSyncing
                        ? (isKo ? "동기화 중..." : "同步中...")
                        : (isKo ? "수동 동기화" : "手动同步")}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {isKo ? "마지막 수신: " : "最后接收: "}
                      {lastWebhookAt ? lastWebhookAt.toLocaleString() : (isKo ? "기록 없음" : "无记录")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* API sync stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: isKo ? "오늘 수신" : "今日接收", value: "0", icon: ArrowDownToLine, color: "text-primary" },
                { label: isKo ? "신규 등록" : "新增注册", value: "0", icon: CheckCircle2, color: "text-emerald-500" },
                { label: isKo ? "업데이트" : "已更新", value: "0", icon: RefreshCw, color: "text-blue-500" },
                { label: isKo ? "오류" : "异常", value: "0", icon: AlertCircle, color: "text-muted-foreground" },
              ].map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                    <Icon className={`w-5 h-5 mx-auto mb-2 ${s.color}`} />
                    <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  </div>
                );
              })}
            </div>

            {/* API sync history - same format as file upload history */}
            <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
              <h3 className="text-sm font-medium mb-4">
                {isKo ? "연동 이력" : "联动记录"}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">{isKo ? "주문번호" : "订单号"}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{isKo ? "트윈커" : "Twinker"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "로고" : "Logo"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "데이터 행" : "数据行"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "디자인" : "设计"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "트윈코드" : "TwinCode"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "결과" : "结果"}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{isKo ? "결과일시" : "结果时间"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "작업연동" : "作业关联"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "관리" : "操作"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!apiHistory.length ? (
                      <tr>
                        <td colSpan={10} className="py-6 text-center text-muted-foreground text-sm">
                          {isKo ? "API 연동 이력이 없습니다" : "暂无API联动记录"}
                        </td>
                      </tr>
                    ) : (
                      apiHistory.map((h: any) => {
                        const extOrderId = h.file_name?.replace("API-", "") || "-";
                        const twinkers: string[] = (h as any).twinkers || [];
                        const twinkerLabel = twinkers.length ? (twinkers.length > 2 ? `${twinkers.slice(0, 2).join(", ")} +${twinkers.length - 2}` : twinkers.join(", ")) : "-";
                        return (
                          <tr key={h.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-primary/70 shrink-0" />
                                {extOrderId}
                              </div>
                            </td>
                            <td className="py-2.5 text-muted-foreground" title={twinkers.join(", ")}>{twinkerLabel}</td>
                            <td className="py-2.5 text-center">
                              {h.logo_path ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <img
                                    src={supabase.storage.from("order-logos").getPublicUrl(h.logo_path).data.publicUrl}
                                    alt="logo"
                                    className="w-8 h-8 rounded object-contain border border-border"
                                  />
                                  <label className="cursor-pointer">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleHistoryLogoUpload(h.id, file, h.logo_path);
                                        e.target.value = "";
                                      }}
                                    />
                                    <span className="text-xs text-primary hover:underline">
                                      {logoUploadingId === h.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                                      ) : (
                                        isKo ? "변경" : "更换"
                                      )}
                                    </span>
                                  </label>
                                </div>
                              ) : (
                                <label className="cursor-pointer inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleHistoryLogoUpload(h.id, file, null);
                                      e.target.value = "";
                                    }}
                                  />
                                  {logoUploadingId === h.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Image className="w-3.5 h-3.5" />
                                      {isKo ? "로고 업로드" : "上传Logo"}
                                    </>
                                  )}
                                </label>
                              )}
                            </td>
                            <td className="py-2.5 text-right tabular-nums">{h.row_count.toLocaleString()}</td>
                            <td className="py-2.5 text-center tabular-nums">{(h as any).design_image_count || 0}</td>
                            <td className="py-2.5 text-center tabular-nums">{(h as any).twincode_image_count || 0}</td>
                            <td className="py-2.5 text-center">
                              {h.error_count === 0
                                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                                : <XCircle className="w-4 h-4 text-destructive mx-auto" />}
                            </td>
                            <td className="py-2.5 text-muted-foreground">{new Date(h.created_at).toLocaleString()}</td>
                            <td className="py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 gap-1 text-xs"
                                  disabled={linkingId === h.id || unlinkedIds.has(h.id)}
                                  onClick={() => handleLinkWork(h.id)}
                                >
                                  {linkingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                                  {isKo ? "작업연동" : "关联"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                                  disabled={unlinkingId === h.id || unlinkedIds.has(h.id)}
                                  onClick={() => handleUnlinkWork(h.id)}
                                >
                                  {unlinkingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                                  {isKo ? "연동삭제" : "删除关联"}
                                </Button>
                              </div>
                            </td>
                            <td className="py-2.5 text-center">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                                      onClick={async () => {
                                        const summary = await removeOrderImagesForHistory(h.id);
                                        if (h.file_path) {
                                          await supabase.storage.from("upload-files").remove([h.file_path]);
                                        }
                                        if (h.logo_path) {
                                          await supabase.storage.from("order-logos").remove([h.logo_path]);
                                        }
                                        await supabase.from("upload_history").delete().eq("id", h.id);
                                        queryClient.invalidateQueries({ queryKey: ["upload_history"] });
                                        queryClient.invalidateQueries({ queryKey: ["orders"] });
                                        queryClient.invalidateQueries({ queryKey: ["production_tracking"] });
                                        queryClient.invalidateQueries({ queryKey: ["shipments"] });
                                        queryClient.invalidateQueries({ queryKey: ["order_stats"] });
                                        const hasFailures = summary.design.failed + summary.twincode.failed + summary.errors.length > 0;
                                        toast({
                                          title: isKo ? "삭제 완료" : "已删除",
                                          description: formatRemovalSummary(summary),
                                          variant: hasFailures ? "destructive" : "default",
                                        });
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      {isKo ? "삭제" : "删除"}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isKo ? "이력 삭제" : "删除记录"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ═══ File Upload Tab ═══ */}
          <TabsContent value="file" className="space-y-6">
            {/* Column guide */}
            <div className="kpi-card section-enter flex items-start gap-4">
              <div className="p-2.5 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                <Info className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold mb-1">
                  {isKo ? "엑셀 템플릿 구조 안내" : "Excel模板结构说明"}
                </h3>
                <p className="text-xs text-muted-foreground mb-1">
                  {isKo
                    ? "시트1: 1행(카테고리) / 2행(항목명) / 3행부터 데이터 입력"
                    : "工作表1: 第1行(类别) / 第2行(字段名) / 第3行起输入数据"}
                </p>
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                  <Image className="w-3.5 h-3.5" />
                  {isKo
                    ? "시트2: A열(로고 이미지 목록) / B열(로고 이미지 파일)"
                    : "工作表2: A列(Logo图片列表) / B列(Logo图片文件)"}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {categoryBadges.map((g) => (
                    <span key={g.cols} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-muted/30 text-foreground">
                      <span className="font-mono text-[10px] opacity-70">{g.cols}</span>
                      {g.label}
                    </span>
                  ))}
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground w-10">{isKo ? "열" : "列"}</th>
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "항목명" : "字段名"}</th>
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground w-10">{isKo ? "열" : "列"}</th>
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "항목명" : "字段名"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.ceil(columnSpec.length / 2) }).map((_, i) => {
                        const left = columnSpec[i * 2];
                        const right = columnSpec[i * 2 + 1];
                        return (
                          <tr key={i} className="border-t border-border/40">
                            <td className="px-2.5 py-1.5 font-mono font-semibold text-primary">{left.col}</td>
                            <td className="px-2.5 py-1.5">
                              <span className="inline-flex items-center gap-1">
                                {left.label}
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <CircleAlert className="w-3.5 h-3.5 text-muted-foreground cursor-help shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[200px] text-xs">
                                      {left.desc}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </span>
                            </td>
                            {right ? (
                              <>
                                <td className="px-2.5 py-1.5 font-mono font-semibold text-primary">{right.col}</td>
                                <td className="px-2.5 py-1.5">
                                  <span className="inline-flex items-center gap-1">
                                    {right.label}
                                    <TooltipProvider delayDuration={200}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <CircleAlert className="w-3.5 h-3.5 text-muted-foreground cursor-help shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[200px] text-xs">
                                          {right.desc}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </span>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-2.5 py-1.5" />
                                <td className="px-2.5 py-1.5" />
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownloadTemplate}>
                    <Download className="w-3.5 h-3.5" />
                    {isKo ? "템플릿 다운로드" : "下载模板"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Three upload zones in a grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 section-enter" style={{ animationDelay: "60ms" }}>
              {/* 1. Excel upload */}
              <div className="kpi-card">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processFile(file);
                    e.target.value = "";
                  }}
                />
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-primary" />
                  {isKo ? "① 엑셀 파일" : "① Excel文件"}
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {isKo ? "주문 데이터가 포함된 엑셀 파일 (.xlsx)" : "包含订单数据的Excel文件 (.xlsx)"}
                </p>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer ${
                    isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40"
                  }`}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                    setIsDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setIsDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) processFile(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs font-medium">{isKo ? "드래그 또는 클릭" : "拖拽或点击"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">.xlsx, .xls</p>
                </div>
                {uploadResult && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="truncate font-medium">{uploadResult.fileName}</span>
                    <span className="text-muted-foreground">({uploadResult.total}{isKo ? "행" : "行"})</span>
                  </div>
                )}
              </div>

              {/* 2. Design image upload */}
              <div className="kpi-card">
                <input
                  ref={designFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/"));
                    if (files.length) setDesignFiles(prev => [...prev, ...filesToEntries(files)]);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={designFolderInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/"));
                    if (files.length) setDesignFiles(prev => [...prev, ...filesToEntries(files)]);
                    e.target.value = "";
                  }}
                  {...{ webkitdirectory: "", directory: "" } as any}
                />
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Image className="w-4 h-4 text-primary" />
                  {isKo ? "② 디자인 이미지" : "② 设计图片"}
                  <span className="text-[10px] text-muted-foreground font-normal">{isKo ? "(선택)" : "(可选)"}</span>
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {isKo ? "폴더명 = 주문번호로 매칭 (우선), 파일명 = 디자인코드 (보조)" : "文件夹名 = 订单号匹配 (优先), 文件名 = 设计代码 (辅助)"}
                </p>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer ${
                    isDraggingDesign ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40"
                  }`}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingDesign(true); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                    setIsDraggingDesign(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setIsDraggingDesign(false);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingDesign(false);
                    const droppedEntries = await extractDroppedImageEntries(e.dataTransfer);
                    if (droppedEntries.length) setDesignFiles(prev => [...prev, ...droppedEntries]);
                  }}
                  onClick={() => designFileInputRef.current?.click()}
                >
                  <Image className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs font-medium">{isKo ? "드래그 또는 클릭" : "拖拽或点击"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{isKo ? "여러 파일 가능" : "可多选"}</p>
                </div>
                <div className="mt-2 text-center">
                  <Button type="button" variant="outline" size="sm" className="text-[10px] h-6 px-2 gap-1" onClick={() => designFolderInputRef.current?.click()}>
                    <FileUp className="w-3 h-3" />
                    {isKo ? "폴더 업로드" : "文件夹上传"}
                  </Button>
                </div>
                {designFiles.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <p className="text-xs font-medium">{designFiles.length}{isKo ? "개 선택" : "张已选"}</p>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="h-6 px-2 text-[10px] gap-1"
                          disabled={savingCategories.has("design")}
                          onClick={() => saveImagesByCategory("design")}
                        >
                          {savingCategories.has("design")
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Save className="w-3 h-3" />}
                          {savingCategories.has("design")
                            ? (isKo ? `저장 중 ${saveProgressMap.design.done}/${saveProgressMap.design.total}` : `保存中 ${saveProgressMap.design.done}/${saveProgressMap.design.total}`)
                            : (isKo ? "저장" : "保存")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] gap-1 text-destructive hover:text-destructive"
                          disabled={savingCategories.has("design")}
                          onClick={() => {
                            setDesignFiles([]);
                            toast({ title: isKo ? "디자인 이미지 전체 삭제됨" : "已清空设计图片" });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                          {isKo ? "전체 삭제" : "全部删除"}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-[304px] overflow-y-auto pr-1">
                      {designFiles.map((f, i) => (
                        <div key={i} className="relative group">
                          <div className="w-12 h-12 rounded border border-border overflow-hidden bg-muted/30">
                            <img src={URL.createObjectURL(f.file)} alt={f.file.name} className="w-full h-full object-contain" />
                          </div>
                          <p className="text-[9px] text-center text-muted-foreground truncate w-12">{f.file.name.replace(/\.[^.]+$/, "")}</p>
                          {f.orderFolder && (
                            <p className="text-[8px] text-center text-primary truncate w-12">📁{f.orderFolder}</p>
                          )}
                          <button
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); setDesignFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Twincode image upload */}
              <div className="kpi-card">
                <input
                  ref={twincodeFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/"));
                    if (files.length) setTwincodeFiles(prev => [...prev, ...filesToEntries(files)]);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={twincodeFolderInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/"));
                    if (files.length) setTwincodeFiles(prev => [...prev, ...filesToEntries(files)]);
                    e.target.value = "";
                  }}
                  {...{ webkitdirectory: "", directory: "" } as any}
                />
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-primary" />
                  {isKo ? "③ 트윈코드 이미지" : "③ TwinCode图片"}
                  <span className="text-[10px] text-muted-foreground font-normal">{isKo ? "(선택)" : "(可选)"}</span>
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {isKo ? "폴더명 = 주문번호로 매칭 (우선), 파일명 = QR값 (보조)" : "文件夹名 = 订单号匹配 (优先), 文件名 = QR值 (辅助)"}
                </p>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer ${
                    isDraggingTwincode ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40"
                  }`}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingTwincode(true); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                    setIsDraggingTwincode(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setIsDraggingTwincode(false);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingTwincode(false);
                    const droppedEntries = await extractDroppedImageEntries(e.dataTransfer);
                    if (droppedEntries.length) setTwincodeFiles(prev => [...prev, ...droppedEntries]);
                  }}
                  onClick={() => twincodeFileInputRef.current?.click()}
                >
                  <QrCode className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs font-medium">{isKo ? "드래그 또는 클릭" : "拖拽或点击"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{isKo ? "여러 파일 가능" : "可多选"}</p>
                </div>
                <div className="mt-2 text-center">
                  <Button type="button" variant="outline" size="sm" className="text-[10px] h-6 px-2 gap-1" onClick={() => twincodeFolderInputRef.current?.click()}>
                    <FileUp className="w-3 h-3" />
                    {isKo ? "폴더 업로드" : "文件夹上传"}
                  </Button>
                </div>
                {twincodeFiles.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <p className="text-xs font-medium">{twincodeFiles.length}{isKo ? "개 선택" : "张已选"}</p>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="h-6 px-2 text-[10px] gap-1"
                          disabled={savingCategories.has("twincode")}
                          onClick={() => saveImagesByCategory("twincode")}
                        >
                          {savingCategories.has("twincode")
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Save className="w-3 h-3" />}
                          {savingCategories.has("twincode")
                            ? (isKo ? `저장 중 ${saveProgressMap.twincode.done}/${saveProgressMap.twincode.total}` : `保存中 ${saveProgressMap.twincode.done}/${saveProgressMap.twincode.total}`)
                            : (isKo ? "저장" : "保存")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] gap-1 text-destructive hover:text-destructive"
                          disabled={savingCategories.has("twincode")}
                          onClick={() => {
                            setTwincodeFiles([]);
                            toast({ title: isKo ? "트윈코드 이미지 전체 삭제됨" : "已清空TwinCode图片" });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                          {isKo ? "전체 삭제" : "全部删除"}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-[304px] overflow-y-auto pr-1">
                      {twincodeFiles.map((f, i) => (
                        <div key={i} className="relative group">
                          <div className="w-12 h-12 rounded border border-border overflow-hidden bg-muted/30">
                            <img src={URL.createObjectURL(f.file)} alt={f.file.name} className="w-full h-full object-contain" />
                          </div>
                          <p className="text-[9px] text-center text-muted-foreground truncate w-12">{f.file.name.replace(/\.[^.]+$/, "")}</p>
                          {f.orderFolder && (
                            <p className="text-[8px] text-center text-primary truncate w-12">📁{f.orderFolder}</p>
                          )}
                          <button
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); setTwincodeFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Folder-Order Matching Summary */}
            {(designFiles.length > 0 || twincodeFiles.length > 0) && (
              <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <FileUp className="w-4 h-4 text-primary" />
                  {isKo ? "폴더-주문 매칭 결과" : "文件夹-订单匹配结果"}
                </h3>
                {!uploadResult && (
                  <div className="mb-3 p-2.5 rounded-md bg-muted/40 border border-border/40 text-xs text-muted-foreground flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                    <span>{isKo ? "엑셀 파일을 먼저 업로드하면 주문번호와 자동 매칭됩니다." : "请先上传Excel文件以自动匹配订单号。"}</span>
                  </div>
                )}
                {(designFiles.length > 0 || twincodeFiles.length > 0) &&
                  !designFiles.some(f => f.orderFolder) && !twincodeFiles.some(f => f.orderFolder) && (
                  <div className="mb-3 p-2.5 rounded-md bg-muted/40 border border-border/40 text-xs text-muted-foreground flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                    <span>{isKo ? "폴더 정보가 없습니다. '폴더 업로드' 버튼을 사용하거나 폴더 자체를 드래그하세요. (폴더명 = 주문번호)" : "无文件夹信息。请使用'文件夹上传'按钮或直接拖拽文件夹。(文件夹名 = 订单号)"}</span>
                  </div>
                )}
                {(() => {
                  // Collect unique order IDs from parsed data
                  const orderIds = new Set<string>();
                  parsedRows.forEach(row => {
                    const extId = String(row[0] ?? "").trim();
                    if (extId) orderIds.add(extId);
                  });

                  // Group images by folder
                  const designByFolder = new Map<string, ImageFileEntry[]>();
                  designFiles.filter(f => f.orderFolder).forEach(f => {
                    const arr = designByFolder.get(f.orderFolder!) || [];
                    arr.push(f);
                    designByFolder.set(f.orderFolder!, arr);
                  });
                  const twincodeByFolder = new Map<string, ImageFileEntry[]>();
                  twincodeFiles.filter(f => f.orderFolder).forEach(f => {
                    const arr = twincodeByFolder.get(f.orderFolder!) || [];
                    arr.push(f);
                    twincodeByFolder.set(f.orderFolder!, arr);
                  });

                  const allFolders = new Set([...designByFolder.keys(), ...twincodeByFolder.keys()]);
                  const matched = [...allFolders].filter(f => orderIds.has(f));
                  const unmatched = [...allFolders].filter(f => !orderIds.has(f));

                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 text-xs">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            {isKo ? `매칭됨: ${matched.length}건` : `已匹配: ${matched.length}条`}
                          </span>
                          {unmatched.length > 0 && (
                            <span className="flex items-center gap-1 text-destructive">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {isKo ? `미매칭: ${unmatched.length}건` : `未匹配: ${unmatched.length}条`}
                            </span>
                          )}
                          {appliedFolders.size > 0 && (
                            <span className="flex items-center gap-1 text-primary">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {isKo ? `적용됨: ${appliedFolders.size}건` : `已应用: ${appliedFolders.size}条`}
                            </span>
                          )}
                        </div>
                        {matched.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-7"
                            disabled={applyingFolders}
                            onClick={async () => {
                              const next = new Set(appliedFolders);
                              const allApplied = matched.every(f => next.has(f));
                              if (allApplied) {
                                matched.forEach(f => next.delete(f));
                                setAppliedFolders(next);
                                toast({ title: isKo ? "전체 적용 해제됨" : "已取消全部应用" });
                              } else {
                                const toApply = matched.filter(f => !next.has(f));
                                const ok = await applyFoldersToOrders(toApply, designByFolder, twincodeByFolder);
                                if (ok) {
                                  toApply.forEach(f => next.add(f));
                                  setAppliedFolders(next);
                                }
                              }
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {matched.every(f => appliedFolders.has(f))
                              ? (isKo ? "전체 해제" : "全部取消")
                              : (isKo ? "전체 주문에 적용" : "应用到全部订单")}
                          </Button>
                        )}
                      </div>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/40">
                              <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "폴더명 (주문번호)" : "文件夹名 (订单号)"}</th>
                              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">{isKo ? "디자인" : "设计"}</th>
                              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">{isKo ? "트윈코드" : "TwinCode"}</th>
                              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">{isKo ? "상태" : "状态"}</th>
                              <th className="px-3 py-1.5 text-center font-medium text-muted-foreground">{isKo ? "적용" : "应用"}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...matched, ...unmatched].map(folder => {
                              const isMatched = orderIds.has(folder);
                              const isApplied = appliedFolders.has(folder);
                              return (
                                <tr key={folder} className="border-t border-border/40">
                                  <td className="px-3 py-1.5 font-medium">{folder}</td>
                                  <td className="px-3 py-1.5 text-center tabular-nums">{designByFolder.get(folder)?.length || 0}</td>
                                  <td className="px-3 py-1.5 text-center tabular-nums">{twincodeByFolder.get(folder)?.length || 0}</td>
                                  <td className="px-3 py-1.5 text-center">
                                    {isMatched
                                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                                      : <span className="text-destructive text-[10px]">{isKo ? "주문 없음" : "无订单"}</span>
                                    }
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    {isMatched ? (
                                      <Button
                                        size="sm"
                                        variant={isApplied ? "default" : "outline"}
                                        className="h-6 px-2 text-[10px] gap-1"
                                        disabled={applyingFolders}
                                        onClick={async () => {
                                          const next = new Set(appliedFolders);
                                          if (isApplied) {
                                            next.delete(folder);
                                            setAppliedFolders(next);
                                            toast({ title: isKo ? `${folder} 적용 해제됨` : `${folder} 已取消应用` });
                                          } else {
                                            const ok = await applyFoldersToOrders([folder], designByFolder, twincodeByFolder);
                                            if (ok) {
                                              next.add(folder);
                                              setAppliedFolders(next);
                                            }
                                          }
                                        }}
                                      >
                                        {isApplied ? (
                                          <>
                                            <CheckCircle2 className="w-3 h-3" />
                                            {isKo ? "적용됨" : "已应用"}
                                          </>
                                        ) : (
                                          isKo ? "적용" : "应用"
                                        )}
                                      </Button>
                                    ) : (
                                      <span className="text-muted-foreground text-[10px]">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            {uploadResult && (
              <div className="kpi-card section-enter">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-primary" />
                    <div>
                      <h3 className="text-sm font-semibold">{uploadResult.fileName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {isKo ? `총 ${uploadResult.total.toLocaleString()}행` : `共${uploadResult.total.toLocaleString()}行`}
                        {uploadResult.error > 0 && (
                          <span className="text-destructive ml-2">
                            {isKo ? `오류 ${uploadResult.error}건` : `异常${uploadResult.error}条`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {uploadResult.error > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5">
                      <Download className="w-3.5 h-3.5" />
                      {isKo ? "오류 행 다운로드" : "下载异常行"}
                    </Button>
                  )}
                  {!saved && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={handleSaveToDb}
                        disabled={saving || !parsedRows.length}
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {saving
                          ? (isKo ? "저장 중..." : "保存中...")
                          : (isKo ? `${parsedRows.length}건 저장` : `保存${parsedRows.length}条`)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5"
                        onClick={() => {
                          setUploadResult(null);
                          setParsedRows([]);
                          setSaved(false);
                          toast({
                            title: isKo ? "취소되었습니다" : "已取消",
                            description: isKo ? "업로드한 데이터를 삭제했습니다." : "已删除上传的数据。",
                          });
                        }}
                        disabled={saving}
                      >
                        <Trash2 className="w-4 h-4" />
                        {isKo ? "삭제" : "删除"}
                      </Button>
                    </div>
                  )}
                  {saved && (
                    <span className="flex items-center gap-1.5 text-sm text-emerald-500 font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      {isKo ? "저장 완료" : "保存完成"}
                    </span>
                  )}
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-left">
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs w-10">{isKo ? "열" : "列"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "카테고리" : "类别"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "항목" : "字段"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{isKo ? "입력됨" : "已填"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{isKo ? "빈값" : "空值"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{t("upload.errorCount")}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-center">{isKo ? "결과" : "结果"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.columnResults.map((c) => (
                        <tr key={c.col} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2 font-mono font-semibold text-primary text-xs">{c.col}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{c.category}</td>
                          <td className="px-3 py-2 font-medium text-sm">{c.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.filled.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.empty > 0 ? c.empty.toLocaleString() : "-"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {c.error > 0 ? <span className="text-destructive font-medium">{c.error}</span> : "-"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {c.error === 0
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                              : <XCircle className="w-4 h-4 text-destructive mx-auto" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
              <h3 className="text-sm font-medium mb-4">{t("upload.history")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">{t("upload.fileName")}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{isKo ? "트윈커" : "Twinker"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "로고" : "Logo"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "데이터 행" : "数据行"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "디자인" : "设计"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "트윈코드" : "TwinCode"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "결과" : "结果"}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{t("upload.dateTime")}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{t("upload.user")}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "작업연동" : "작业관联"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "관리" : "操作"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!uploadHistory.length ? (
                      <tr>
                        <td colSpan={11} className="py-6 text-center text-muted-foreground text-sm">
                          {isKo ? "업로드 이력이 없습니다" : "暂无上传记录"}
                        </td>
                      </tr>
                    ) : (
                      uploadHistory.map((h) => {
                        const twinkers: string[] = (h as any).twinkers || [];
                        const twinkerLabel = twinkers.length ? (twinkers.length > 2 ? `${twinkers.slice(0, 2).join(", ")} +${twinkers.length - 2}` : twinkers.join(", ")) : "-";
                        return (
                        <tr key={h.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <FileSpreadsheet className="w-4 h-4 text-primary/70 shrink-0" />
                              {h.file_name}
                            </div>
                          </td>
                          <td className="py-2.5 text-muted-foreground" title={twinkers.join(", ")}>{twinkerLabel}</td>
                          <td className="py-2.5 text-center">
                            {(h as any).logo_path ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <img
                                  src={supabase.storage.from("order-logos").getPublicUrl((h as any).logo_path).data.publicUrl}
                                  alt="logo"
                                  className="w-8 h-8 rounded object-contain border border-border"
                                />
                                <label className="cursor-pointer">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleHistoryLogoUpload(h.id, file, (h as any).logo_path);
                                      e.target.value = "";
                                    }}
                                  />
                                  <span className="text-xs text-primary hover:underline">
                                    {logoUploadingId === h.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                                    ) : (
                                      isKo ? "변경" : "更换"
                                    )}
                                  </span>
                                </label>
                              </div>
                            ) : (
                              <label className="cursor-pointer inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleHistoryLogoUpload(h.id, file, null);
                                    e.target.value = "";
                                  }}
                                />
                                {logoUploadingId === h.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Image className="w-3.5 h-3.5" />
                                    {isKo ? "로고 업로드" : "上传Logo"}
                                  </>
                                )}
                              </label>
                            )}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{h.row_count.toLocaleString()}</td>
                          <td className="py-2.5 text-center tabular-nums">{(h as any).design_image_count || 0}</td>
                          <td className="py-2.5 text-center tabular-nums">{(h as any).twincode_image_count || 0}</td>
                          <td className="py-2.5 text-center">
                            {h.error_count === 0
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                              : <XCircle className="w-4 h-4 text-destructive mx-auto" />}
                          </td>
                          <td className="py-2.5 text-muted-foreground">{new Date(h.created_at).toLocaleString()}</td>
                          <td className="py-2.5">{h.user_email || "-"}</td>
                          <td className="py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 gap-1 text-xs"
                                disabled={linkingId === h.id || unlinkedIds.has(h.id)}
                                onClick={() => handleLinkWork(h.id)}
                              >
                                {linkingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                                {isKo ? "작업연동" : "关联"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 gap-1 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                                disabled={unlinkingId === h.id || unlinkedIds.has(h.id)}
                                onClick={() => handleUnlinkWork(h.id)}
                              >
                                {unlinkingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                                {isKo ? "연동삭제" : "删除关联"}
                              </Button>
                            </div>
                          </td>
                          <td className="py-2.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 px-2 gap-1.5 text-xs"
                                        disabled={!isSafeStoragePath(h.file_path)}
                                        onClick={async () => {
                                          if (!isSafeStoragePath(h.file_path)) {
                                            toast({ title: isKo ? "다운로드할 원본 파일이 없습니다" : "没有可下载的原始文件", variant: "destructive" });
                                            return;
                                          }

                                          const { data, error } = await supabase.storage
                                            .from("upload-files")
                                            .download(h.file_path);

                                          if (error || !data) {
                                            toast({ title: isKo ? "다운로드 실패" : "下载失败", variant: "destructive" });
                                            return;
                                          }

                                          const url = URL.createObjectURL(data);
                                          const a = document.createElement("a");
                                          a.href = url;
                                          a.download = h.file_name;
                                          document.body.appendChild(a);
                                          a.click();
                                          a.remove();
                                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                                        }}
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        {isKo ? "다운로드" : "下载"}
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isSafeStoragePath(h.file_path) ? (isKo ? "원본 파일 다운로드" : "下载原始文件") : (isKo ? "이 이력에는 다운로드 가능한 원본 파일이 없습니다" : "该记录没有可下载的原始文件")}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                                      onClick={async () => {
                                        const summary = await removeOrderImagesForHistory(h.id);
                                        if (h.file_path) {
                                          await supabase.storage.from("upload-files").remove([h.file_path]);
                                        }
                                        if ((h as any).logo_path) {
                                          await supabase.storage.from("order-logos").remove([(h as any).logo_path]);
                                        }
                                        await supabase.from("upload_history").delete().eq("id", h.id);
                                        queryClient.invalidateQueries({ queryKey: ["upload_history"] });
                                        queryClient.invalidateQueries({ queryKey: ["orders"] });
                                        queryClient.invalidateQueries({ queryKey: ["production_tracking"] });
                                        queryClient.invalidateQueries({ queryKey: ["shipments"] });
                                        queryClient.invalidateQueries({ queryKey: ["order_stats"] });
                                        const hasFailures = summary.design.failed + summary.twincode.failed + summary.errors.length > 0;
                                        toast({
                                          title: isKo ? "삭제 완료" : "已删除",
                                          description: formatRemovalSummary(summary),
                                          variant: hasFailures ? "destructive" : "default",
                                        });
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      {isKo ? "삭제" : "删除"}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isKo ? "이력 및 파일 삭제" : "删除记录和文件"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}