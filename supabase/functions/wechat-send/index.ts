import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// WeChat Work group bot webhook sender
// Docs: https://developer.work.weixin.qq.com/document/path/91770

interface Payload {
  webhookUrl: string;
  message: string;
  mentionedMobileList?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Payload;
    if (!body.webhookUrl || !body.message) {
      return new Response(
        JSON.stringify({ error: 'webhookUrl and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Basic safety check: must be a WeChat Work webhook
    if (!/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send/.test(body.webhookUrl)) {
      return new Response(
        JSON.stringify({ error: 'Only qyapi.weixin.qq.com webhook URLs are allowed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const wxBody = {
      msgtype: 'text',
      text: {
        content: body.message,
        mentioned_mobile_list: body.mentionedMobileList ?? [],
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let resp: Response;
    try {
      resp = await fetch(body.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wxBody),
        signal: controller.signal,
      });
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      return new Response(
        JSON.stringify({
          error: isAbort ? 'WECHAT_TIMEOUT' : 'WECHAT_FETCH_FAILED',
          message: isAbort ? 'WeChat webhook response timed out.' : String((e as Error).message ?? e),
          fallback: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } finally {
      clearTimeout(timeout);
    }
    const responseText = await resp.text();
    let data: any = { raw: responseText };
    try { data = JSON.parse(responseText); } catch { /* keep raw response */ }

    if (data.errcode !== 0) {
      return new Response(
        JSON.stringify({ error: 'WeChat API error', details: data, fallback: resp.status >= 500 }),
        { status: resp.status >= 500 ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e as Error).message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
