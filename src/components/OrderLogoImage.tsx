import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SIGN_TTL = 60 * 60; // 1 hour

/** Create a signed URL for a file in the private `order-logos` bucket. */
export async function signOrderLogo(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("order-logos").createSignedUrl(path, SIGN_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Resolve signed URLs for a map of key → storage path. */
export function useSignedOrderLogos(entries: Array<{ key: string; path: string }>) {
  const [map, setMap] = useState<Record<string, string>>({});
  const signature = entries.map((e) => `${e.key}:${e.path}`).join("|");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        entries.map(async ({ key, path }) => {
          const url = await signOrderLogo(path);
          if (url) next[key] = url;
        }),
      );
      if (!cancelled) setMap(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return map;
}

interface OrderLogoImageProps {
  path?: string | null;
  fallbackUrl?: string | null;
  className?: string;
  alt?: string;
}

/** Renders an order logo, signing private storage paths on demand. */
export function OrderLogoImage({ path, fallbackUrl, className, alt = "logo" }: OrderLogoImageProps) {
  const [src, setSrc] = useState<string | null>(fallbackUrl ?? null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setSrc(fallbackUrl ?? null);
      return;
    }
    void signOrderLogo(path).then((url) => {
      if (!cancelled) setSrc(url ?? fallbackUrl ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [path, fallbackUrl]);

  if (!src) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex items-center justify-center">
      <img src={src} alt={alt} className={className} />
    </div>
  );
}
