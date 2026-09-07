import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  QR_LABEL_TEMPLATE_KEY, QR_LABEL_DEFAULTS, mergeTemplate, type QrLabelTemplate,
} from "@/lib/qr-label-template";

/**
 * QR 라벨 공통 템플릿 — 서버(app_ui_settings)가 Source of Truth.
 * 다른 PC에서 설정을 바꾸면 realtime 구독으로 즉시 반영된다.
 */
export function useQrLabelTemplate() {
  const [template, setTemplate] = useState<QrLabelTemplate>(QR_LABEL_DEFAULTS);
  const [loading, setLoading] = useState(true);

  const pull = useCallback(async () => {
    const { data } = await supabase
      .from("app_ui_settings")
      .select("setting_value")
      .eq("setting_key", QR_LABEL_TEMPLATE_KEY)
      .maybeSingle();
    if (data?.setting_value) setTemplate(mergeTemplate(data.setting_value));
    setLoading(false);
  }, []);

  useEffect(() => {
    void pull();
    const ch = supabase
      .channel("qr-label-template")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_ui_settings", filter: `setting_key=eq.${QR_LABEL_TEMPLATE_KEY}` },
        (payload: any) => {
          const v = payload?.new?.setting_value;
          if (v) setTemplate(mergeTemplate(v));
        },
      )
      .subscribe();
    const onFocus = () => { void pull(); };
    const onVisible = () => { if (document.visibilityState === "visible") void pull(); };
    // realtime 이 끊긴 환경(사내망/프록시)에서도 다른 PC 변경이 반영되도록 주기적으로 재조회
    const timer = window.setInterval(() => { void pull(); }, 20000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(ch);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pull]);

  const save = useCallback(async (next: QrLabelTemplate) => {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("app_ui_settings").upsert(
      {
        setting_key: QR_LABEL_TEMPLATE_KEY,
        setting_value: next as unknown as never,
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: "setting_key" },
    );
    if (error) throw new Error(error.message);
    setTemplate(next);
  }, []);

  return { template, loading, save, reload: pull };
}
