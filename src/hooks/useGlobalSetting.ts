import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared, server-backed setting stored in `app_ui_settings`.
 * Every approved account on every device reads and writes the same row.
 */
export function useGlobalSetting<T>(settingKey: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const initialRef = useRef(initial);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      const { data, error } = await supabase
        .from("app_ui_settings")
        .select("setting_value")
        .eq("setting_key", settingKey)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data && data.setting_value !== null) {
        setValue(data.setting_value as unknown as T);
      }
      setLoading(false);
    };
    void pull();
    const onFocus = () => { void pull(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [settingKey]);

  const persist = useCallback(async (next: T) => {
    setValue(next);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("app_ui_settings")
      .upsert(
        {
          setting_key: settingKey,
          setting_value: next as unknown as never,
          updated_by: auth.user?.id ?? null,
        },
        { onConflict: "setting_key" },
      );
    if (error) throw new Error(error.message);
  }, [settingKey]);

  const reset = useCallback(() => persist(initialRef.current), [persist]);

  return { value, setValue, persist, loading, reset };
}
