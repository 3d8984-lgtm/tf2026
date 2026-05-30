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

    const resp = await fetch(body.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wxBody),
    });
    const data = await resp.json();

    if (data.errcode !== 0) {
      return new Response(
        JSON.stringify({ error: 'WeChat API error', details: data }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
