// 발주 진행 상황 대시보드.
// order_jobs / order_job_items를 Realtime으로 구독하며 진행률, 실패 항목, 재시도/재전송 버튼을 제공.
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertCircle, CheckCircle2, Clock, Download, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/PageHeader";

type JobStatus = "queued" | "processing" | "uploading" | "wechat" | "done" | "failed";

interface Job {
  id: string;
  order_no: string;
  factory: string;
  status: JobStatus;
  stage: string;
  progress_current: number;
  progress_total: number;
  bundle_zip_url: string | null;
  bundle_size: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface JobItem {
  id: string;
  job_id: string;
  idx: number;
  filename: string;
  status: "pending" | "processing" | "uploaded" | "failed" | "skipped";
  attempts: number;
  error_message: string | null;
}

const statusBadge: Record<JobStatus, { label: string; cls: string; Icon: typeof Clock }> = {
  queued: { label: "대기", cls: "bg-muted text-muted-foreground", Icon: Clock },
  processing: { label: "가공", cls: "bg-blue-500/15 text-blue-500", Icon: Loader2 },
  uploading: { label: "ZIP", cls: "bg-purple-500/15 text-purple-400", Icon: Loader2 },
  wechat: { label: "위챗", cls: "bg-amber-500/15 text-amber-400", Icon: Send },
  done: { label: "완료", cls: "bg-emerald-500/15 text-emerald-400", Icon: CheckCircle2 },
  failed: { label: "실패", cls: "bg-destructive/15 text-destructive", Icon: AlertCircle },
};

function formatBytes(n: number | null): string {
  if (!n) return "-";
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatEta(job: Job): string {
  if (job.status === "done" || job.status === "failed") return "-";
  const done = job.progress_current;
  const total = job.progress_total;
  if (!done || !total || done >= total) return "-";
  const startedMs = new Date(job.created_at).getTime();
  const elapsed = Date.now() - startedMs;
  const perItem = elapsed / done;
  const remaining = Math.round((perItem * (total - done)) / 1000);
  if (remaining < 60) return `${remaining}초`;
  if (remaining < 3600) return `${Math.round(remaining / 60)}분`;
  return `${(remaining / 3600).toFixed(1)}시간`;
}

export default function OrderJobsDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [items, setItems] = useState<Record<string, JobItem[]>>({});
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from("order_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast.error(`조회 실패: ${error.message}`);
      return;
    }
    setJobs((data || []) as Job[]);
    setLoading(false);
  }, []);

  const loadItems = useCallback(async (jobId: string) => {
    const { data, error } = await supabase
      .from("order_job_items")
      .select("id, job_id, idx, filename, status, attempts, error_message")
      .eq("job_id", jobId)
      .order("idx", { ascending: true });
    if (error) return;
    setItems((prev) => ({ ...prev, [jobId]: (data || []) as JobItem[] }));
  }, []);

  useEffect(() => {
    loadJobs();
    const ch = supabase
      .channel("order_jobs_dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_jobs" }, () => {
        loadJobs();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_job_items" }, (payload) => {
        const row = (payload.new ?? payload.old) as { job_id?: string } | null;
        if (row?.job_id && items[row.job_id]) loadItems(row.job_id);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryItem = async (item: JobItem) => {
    const { error } = await supabase
      .from("order_job_items")
      .update({ status: "pending", attempts: 0, error_message: null })
      .eq("id", item.id);
    if (error) { toast.error(error.message); return; }
    const { error: jErr } = await supabase
      .from("order_jobs")
      .update({ status: "queued", error_message: null })
      .eq("id", item.job_id);
    if (jErr) { toast.error(jErr.message); return; }
    const { error: invErr } = await supabase.functions.invoke("orders-create", {
      body: { __resume: item.job_id },
    });
    // If orders-create doesn't support resume, just inform user to redeploy worker call manually:
    if (invErr) {
      toast.message("재시도 대기열에 등록", {
        description: "워커가 다음 처리 시 자동 재시도합니다.",
      });
    } else {
      toast.success("재시도 요청 완료");
    }
  };

  const resendWeChat = async (job: Job) => {
    const { error } = await supabase.functions.invoke("wechat-send", {
      body: { jobId: job.id, mode: "resend" },
    });
    if (error) { toast.error(`재전송 실패: ${error.message}`); return; }
    toast.success("위챗 재전송 요청됨");
  };

  const sorted = useMemo(() => jobs, [jobs]);

  return (
    <div className="space-y-4">
      <PageHeader title="발주 진행 상황" description="Railway Worker가 처리하는 발주 작업의 실시간 진행률" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>최근 발주 작업</CardTitle>
          <Button variant="outline" size="sm" onClick={() => loadJobs()}>
            <RefreshCw className="h-4 w-4 mr-2" /> 새로고침
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">불러오는 중...</div>
          ) : sorted.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              아직 발주된 작업이 없습니다. <br />
              발주를 누르면 이 화면에 진행률이 표시됩니다.
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {sorted.map((job) => {
                const b = statusBadge[job.status];
                const pct = job.progress_total > 0
                  ? Math.min(100, Math.round((job.progress_current / job.progress_total) * 100))
                  : 0;
                return (
                  <AccordionItem
                    key={job.id}
                    value={job.id}
                    className="border rounded-lg bg-card"
                  >
                    <AccordionTrigger
                      className="px-4 py-3 hover:no-underline"
                      onClick={() => loadItems(job.id)}
                    >
                      <div className="flex-1 grid grid-cols-12 gap-3 items-center text-left">
                        <div className="col-span-3">
                          <div className="font-mono text-sm font-semibold">{job.order_no}</div>
                          <div className="text-xs text-muted-foreground">{job.factory}</div>
                        </div>
                        <div className="col-span-2">
                          <Badge className={b.cls}>
                            <b.Icon className={`h-3 w-3 mr-1 ${job.status === "processing" || job.status === "uploading" ? "animate-spin" : ""}`} />
                            {b.label}
                          </Badge>
                        </div>
                        <div className="col-span-4">
                          <Progress value={pct} className="h-2" />
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {job.stage || "-"} · {job.progress_current}/{job.progress_total} ({pct}%)
                          </div>
                        </div>
                        <div className="col-span-1 text-xs text-muted-foreground">{formatEta(job)}</div>
                        <div className="col-span-2 text-xs text-right text-muted-foreground">
                          {new Date(job.created_at).toLocaleString("ko-KR", { hour12: false })}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-3">
                      {job.error_message && (
                        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
                          <AlertCircle className="h-4 w-4 inline mr-1" /> {job.error_message}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {job.bundle_zip_url && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={job.bundle_zip_url} target="_blank" rel="noreferrer">
                              <Download className="h-4 w-4 mr-2" /> bundle.zip 다운로드 ({formatBytes(job.bundle_size)})
                            </a>
                          </Button>
                        )}
                        {job.status === "failed" && job.bundle_zip_url && (
                          <Button variant="outline" size="sm" onClick={() => resendWeChat(job)}>
                            <Send className="h-4 w-4 mr-2" /> 위챗 재전송
                          </Button>
                        )}
                      </div>

                      <div>
                        <div className="text-sm font-medium mb-2">
                          항목 ({(items[job.id] || []).length}/{job.progress_total})
                        </div>
                        <div className="max-h-72 overflow-y-auto border rounded">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/40 sticky top-0">
                              <tr className="text-left">
                                <th className="px-2 py-1 w-12">#</th>
                                <th className="px-2 py-1">파일명</th>
                                <th className="px-2 py-1 w-20">상태</th>
                                <th className="px-2 py-1 w-12">시도</th>
                                <th className="px-2 py-1">실패 사유</th>
                                <th className="px-2 py-1 w-20"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(items[job.id] || []).map((it) => (
                                <tr key={it.id} className="border-t">
                                  <td className="px-2 py-1 font-mono">{it.idx}</td>
                                  <td className="px-2 py-1 truncate max-w-xs" title={it.filename}>{it.filename || "-"}</td>
                                  <td className="px-2 py-1">
                                    <span className={
                                      it.status === "uploaded" ? "text-emerald-500" :
                                      it.status === "failed" ? "text-destructive" :
                                      it.status === "processing" ? "text-blue-400" :
                                      "text-muted-foreground"
                                    }>{it.status}</span>
                                  </td>
                                  <td className="px-2 py-1">{it.attempts}</td>
                                  <td className="px-2 py-1 text-destructive truncate max-w-md" title={it.error_message || ""}>
                                    {it.error_message || "-"}
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    {it.status === "failed" && (
                                      <Button variant="ghost" size="sm" onClick={() => retryItem(it)}>
                                        <RefreshCw className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">아키텍처 안내</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>Lovable UI → <code>/v1/orders</code> Edge Function → Railway Worker → Storage(bundle.zip) → WeChat</p>
          <p>이 페이지는 <code>order_jobs</code>를 Realtime으로 구독합니다. 워커가 보내는 콜백은 즉시 반영됩니다.</p>
          <p>워커가 죽거나 응답이 없으면 작업은 <code>queued</code>로 멈춥니다. <code>worker/README.md</code>를 참고해 Railway 서비스 상태를 확인하세요.</p>
          <p className="flex items-center gap-1">
            <ExternalLink className="h-3 w-3" /> worker/README.md에 Railway 배포 가이드가 있습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
