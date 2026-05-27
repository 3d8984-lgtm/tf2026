import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Copy, Trash2, FileImage, Loader2 } from "lucide-react";

interface CardTemplate {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  front_pdf_url: string | null;
  front_preview_png_url: string | null;
  back_pdf_url: string | null;
  back_preview_png_url: string | null;
  created_at: string;
}

const BUCKET = "card-frames";

function fileExt(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

async function uploadPdfAndRender(
  pdfFile: File,
  side: "front" | "back",
  templateId: string,
): Promise<{ pdfUrl: string; pngUrl: string }> {
  const stamp = Date.now();
  const pdfPath = `${templateId}/${side}-${stamp}.pdf`;
  const pngPath = `${templateId}/${side}-${stamp}.png`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, pdfFile, { contentType: "application/pdf", upsert: true });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(pdfPath);

  const { data, error } = await supabase.functions.invoke("pdf-to-png", {
    body: { bucket: BUCKET, path: pdfPath, outPath: pngPath },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("PNG 변환 실패");

  return { pdfUrl: pub.publicUrl, pngUrl: data.url };
}

export default function CardTemplateList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CardTemplate | null>(null);

  const [name, setName] = useState("");
  const [frontPdf, setFrontPdf] = useState<File | null>(null);
  const [backPdf, setBackPdf] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("card_template")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data ?? []) as CardTemplate[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setName("");
    setFrontPdf(null);
    setBackPdf(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("템플릿 이름을 입력해주세요.");
      return;
    }
    if (frontPdf && fileExt(frontPdf.name) !== "pdf") {
      toast.error("앞면 파일은 PDF여야 합니다.");
      return;
    }
    if (backPdf && fileExt(backPdf.name) !== "pdf") {
      toast.error("뒷면 파일은 PDF여야 합니다.");
      return;
    }

    setSaving(true);
    try {
      const { data: tpl, error: insErr } = await supabase
        .from("card_template")
        .insert({ name: name.trim() })
        .select()
        .single();
      if (insErr) throw insErr;

      const patch: Record<string, string> = {};
      if (frontPdf) {
        const { pdfUrl, pngUrl } = await uploadPdfAndRender(frontPdf, "front", tpl.id);
        patch.front_pdf_url = pdfUrl;
        patch.front_preview_png_url = pngUrl;
      }
      if (backPdf) {
        const { pdfUrl, pngUrl } = await uploadPdfAndRender(backPdf, "back", tpl.id);
        patch.back_pdf_url = pdfUrl;
        patch.back_preview_png_url = pngUrl;
      }
      if (Object.keys(patch).length) {
        const { error: updErr } = await supabase
          .from("card_template")
          .update(patch)
          .eq("id", tpl.id);
        if (updErr) throw updErr;
      }

      toast.success("템플릿이 저장되었습니다.");
      setCreateOpen(false);
      resetForm();
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (t: CardTemplate) => {
    try {
      const { error } = await supabase.from("card_template").insert({
        name: `${t.name} (복제)`,
        width_mm: t.width_mm,
        height_mm: t.height_mm,
        front_pdf_url: t.front_pdf_url,
        front_preview_png_url: t.front_preview_png_url,
        back_pdf_url: t.back_pdf_url,
        back_preview_png_url: t.back_preview_png_url,
      });
      if (error) throw error;
      toast.success("복제되었습니다.");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "복제 실패");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from("card_template")
        .delete()
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("삭제되었습니다.");
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "삭제 실패");
    }
  };

  return (
    <div>
      <PageHeader title="카드 템플릿" description="57×87mm 카드 발주 템플릿 관리">
        <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-1" /> 새 템플릿 만들기
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 템플릿 만들기</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">템플릿 이름 *</Label>
                <Input
                  id="tpl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: CP 시리즈 카드"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="front-pdf">앞면 프레임 PDF</Label>
                <Input
                  id="front-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFrontPdf(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="back-pdf">뒷면 프레임 PDF</Label>
                <Input
                  id="back-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setBackPdf(e.target.files?.[0] ?? null)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                PDF 업로드 후 첫 페이지를 300 DPI · 57×87mm로 자동 변환합니다. 잠시 걸릴 수 있습니다.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
                취소
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                저장
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="border rounded-lg p-12 text-center text-muted-foreground">
            등록된 템플릿이 없습니다. 우측 상단의 [+ 새 템플릿 만들기]를 눌러 시작하세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((t) => (
              <div
                key={t.id}
                className="border rounded-lg bg-card overflow-hidden flex flex-col"
              >
                <Link
                  to={`/outsource/card-order/templates/${t.id}`}
                  className="block aspect-[57/87] bg-muted flex items-center justify-center overflow-hidden hover:opacity-90 transition-opacity"
                >
                  {t.front_preview_png_url ? (
                    <img
                      src={t.front_preview_png_url}
                      alt={t.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <FileImage className="w-10 h-10 text-muted-foreground/50" />
                  )}
                </Link>
                <div className="p-3 space-y-2">
                  <div>
                    <div className="font-medium text-sm truncate">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("ko-KR")}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => navigate(`/outsource/card-order/templates/${t.id}`)}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" /> 편집
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDuplicate(t)}
                      title="복제"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteTarget(t)}
                      title="삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>템플릿을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" 템플릿과 연결된 요소가 함께 삭제됩니다. 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
