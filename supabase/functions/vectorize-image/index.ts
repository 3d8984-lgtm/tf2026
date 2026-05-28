// Vectorizer.AI proxy edge function
// Converts a raster image (URL or base64) to SVG via vectorizer.ai API
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Body {
  imageUrl?: string;
  imageBase64?: string; // data URL or raw base64
  mode?: 'test' | 'production' | 'preview';
  // Optional Vectorizer.AI tuning params (passed through if provided)
  processing_max_colors?: number;
  output_gap_filler_enabled?: boolean;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiId = Deno.env.get('VECTORIZER_AI_API_ID');
    const apiSecret = Deno.env.get('VECTORIZER_AI_API_SECRET');
    if (!apiId || !apiSecret) {
      return new Response(JSON.stringify({ error: 'Vectorizer.AI 자격증명이 설정되지 않았습니다.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as Body;
    const mode = body.mode || 'test';

    // Resolve image bytes
    let bytes: Uint8Array;
    let filename = 'input.png';
    let contentType = 'image/png';

    if (body.imageBase64) {
      bytes = base64ToBytes(body.imageBase64);
      const m = body.imageBase64.match(/^data:([^;]+);/);
      if (m) {
        contentType = m[1];
        if (contentType === 'image/jpeg') filename = 'input.jpg';
        else if (contentType === 'image/webp') filename = 'input.webp';
        else if (contentType === 'image/svg+xml') filename = 'input.svg';
      }
    } else if (body.imageUrl) {
      const r = await fetch(body.imageUrl);
      if (!r.ok) throw new Error(`이미지 다운로드 실패: ${r.status}`);
      contentType = r.headers.get('content-type') || 'image/png';
      const ab = await r.arrayBuffer();
      bytes = new Uint8Array(ab);
      const ext = (new URL(body.imageUrl).pathname.split('.').pop() || 'png').toLowerCase();
      filename = `input.${ext}`;
    } else {
      return new Response(JSON.stringify({ error: 'imageUrl 또는 imageBase64가 필요합니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const form = new FormData();
    form.append('image', new Blob([bytes], { type: contentType }), filename);
    form.append('mode', mode);
    if (typeof body.processing_max_colors === 'number') {
      form.append('processing.max_colors', String(body.processing_max_colors));
    }
    if (typeof body.output_gap_filler_enabled === 'boolean') {
      form.append('output.gap_filler.enabled', String(body.output_gap_filler_enabled));
    }

    const auth = 'Basic ' + btoa(`${apiId}:${apiSecret}`);
    const res = await fetch('https://vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: { Authorization: auth },
      body: form,
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: `Vectorizer.AI ${res.status}: ${txt}` }), {
        status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const svgBuf = new Uint8Array(await res.arrayBuffer());
    const credits = res.headers.get('X-Credits-Calculated') || res.headers.get('X-Credits-Charged') || null;
    const svgBase64 = bytesToBase64(svgBuf);
    const svgDataUrl = `data:image/svg+xml;base64,${svgBase64}`;

    return new Response(JSON.stringify({ svgDataUrl, mode, credits }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
