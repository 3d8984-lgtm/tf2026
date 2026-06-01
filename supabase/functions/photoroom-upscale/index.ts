import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { decodeBase64, encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('PHOTOROOM_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'PHOTOROOM_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { imageBase64, mode = 'test', scale = 2 } = body as { imageBase64?: string; mode?: string; scale?: number };

    // Test mode: just verify the API key
    if (mode === 'test' || !imageBase64) {
      const resp = await fetch('https://image-api.photoroom.com/v2/account', {
        headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      });
      const text = await resp.text();
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: `Photoroom auth failed (${resp.status}): ${text}` }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      return new Response(JSON.stringify({ ok: true, account: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Memory-efficient base64 decode
    const base64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const bin = decodeBase64(base64);
    const fd = new FormData();
    fd.append('imageFile', new Blob([bin], { type: 'image/png' }), 'input.png');

    if (mode === 'remove-bg') {
      fd.append('background.color', 'transparent');
      fd.append('outputSize', 'originalImage');
      fd.append('export.format', 'png');
    } else {
      fd.append('upscale.mode', 'ai.fast');
      fd.append('upscale.scale', String(scale));
    }

    const resp = await fetch('https://image-api.photoroom.com/v2/edit', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: fd,
    });
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: `Upscale failed (${resp.status}): ${t}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Memory-efficient base64 encode using std lib (avoids huge string concat loop)
    const buf = new Uint8Array(await resp.arrayBuffer());
    const out = `data:image/png;base64,${encodeBase64(buf)}`;
    return new Response(JSON.stringify({ ok: true, imageDataUrl: out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
