import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

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
    const { imageBase64, mode = 'test' } = body as { imageBase64?: string; mode?: string; scale?: number };
    const scale = body?.scale === 4 ? 4 : 2;

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
      // 투명 픽셀(여백)을 제거하고 피사체 경계로 자동 크롭한다.
      // 이 옵션이 없으면 원본 캔버스 크기가 유지되어 크기 계산 시
      // 투명 영역까지 오브젝트 크기에 포함된다.
      fd.append('outputSize', 'croppedSubject');
      fd.append('padding', '0');
      fd.append('export.format', 'png');
    } else {
      // === PiD (NVIDIA) on RunPod Serverless — preferred upscaler if configured ===
      const pidUrlRaw = Deno.env.get('PID_ENDPOINT_URL');
      const pidUrl = pidUrlRaw?.trim().replace(/\/run\/?$/, '/runsync');
      const pidKey = Deno.env.get('PID_API_KEY');
      if (pidUrl && pidKey) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 120_000);
        try {
          const r = await fetch(pidUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${pidKey}`,
            },
            body: JSON.stringify({ input: { image_b64: base64, scale } }),
            signal: ctrl.signal,
          });
          const j = await r.json().catch(() => ({} as any));
          const out = j?.output ?? j;
          if (!r.ok || !out?.image_b64) {
            console.log('[PiD] non-image response', JSON.stringify(j).slice(0, 500));
            const hint = j?.status === 'IN_QUEUE' || j?.status === 'IN_PROGRESS'
              ? 'RunPod URL이 /run (비동기) 입니다. /runsync 로 변경하세요.'
              : (out?.error || j?.error || `PiD 업스케일 실패 (${r.status}). 응답: ${JSON.stringify(j).slice(0, 200)}`);
            return new Response(JSON.stringify({
              ok: false, code: `PID_${r.status}`, error: hint, raw: j,
            }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          const bin2 = decodeBase64(out.image_b64);
          return new Response(bin2, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/octet-stream',
              'X-Image-Content-Type': 'image/png',
              'X-Upscale-Engine': 'PiD',
            },
          });
        } catch (e) {
          const isAbort = e instanceof DOMException && e.name === 'AbortError';
          return new Response(JSON.stringify({
            ok: false,
            code: isAbort ? 'PID_TIMEOUT' : 'PID_FETCH_FAILED',
            error: isAbort ? 'PiD 추론 시간이 초과되었습니다.' : (e instanceof Error ? e.message : String(e)),
          }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } finally {
          clearTimeout(to);
        }
      }
      // Fallback: Photoroom AI upscale
      fd.append('upscale.mode', 'ai.fast');
      fd.append('upscale.scale', String(scale));
    }

    let resp: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      resp = await fetch('https://image-api.photoroom.com/v2/edit', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: fd,
        signal: controller.signal,
      });
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      return new Response(JSON.stringify({
        ok: false,
        code: isAbort ? 'PHOTOROOM_TIMEOUT' : 'PHOTOROOM_FETCH_FAILED',
        error: isAbort
          ? 'Photoroom 서버 응답 시간이 초과되었습니다. 더 작은 이미지 또는 2× 사이즈로 다시 시도하세요.'
          : e instanceof Error ? e.message : String(e),
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) {
      const t = await resp.text();
      const isHtml = /<\/?html/i.test(t);
      const error = resp.status === 504
        ? 'Photoroom 서버에서 업스케일 처리 시간이 초과되었습니다. 더 작은 이미지 또는 2× 사이즈로 다시 시도하세요.'
        : `Photoroom 처리 실패 (${resp.status}): ${isHtml ? 'HTML 오류 응답' : t.slice(0, 500)}`;
      return new Response(JSON.stringify({ ok: false, code: `PHOTOROOM_${resp.status}`, error, upstreamStatus: resp.status }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Stream the binary image back to the browser instead of converting the
    // result to base64 JSON. Base64 inflates the payload and can exceed the
    // edge worker memory limit for upscale results.
    return new Response(resp.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'X-Image-Content-Type': resp.headers.get('Content-Type') || 'image/png',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
