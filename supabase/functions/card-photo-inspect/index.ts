// Card photo inspection via Lovable AI Gateway (Gemini Vision)
// Receives front/back card images (data URLs) + expected card data, returns extracted info + match result.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { frontImage, backImage, expected } = await req.json();
    if (!frontImage) {
      return new Response(JSON.stringify({ error: "frontImage required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const userContent: any[] = [
      {
        type: "text",
        text:
          `You are a card QC inspector. Extract these fields from the card photo(s):\n` +
          `- card_number (printed like "#014/1000/R1" → split into edition_no, edition_total, grade)\n` +
          `- cp_score (e.g. "CP 230" → 230)\n` +
          `- cp_badge_color (orange / silver / gold / holographic / pink)\n` +
          `- character_description (short, one sentence about the main character)\n` +
          `- dm_barcode (only if visible on back image)\n` +
          `- twincode (only if visible on back image)\n` +
          `Then compare with expected values and return overall match.\n\n` +
          `Expected (may be partial): ${JSON.stringify(expected || {})}\n\n` +
          `Return ONLY valid JSON with shape:\n` +
          `{"extracted":{"edition_no":"","edition_total":"","grade":"","cp_score":0,"cp_badge_color":"","character_description":"","dm_barcode":"","twincode":""},` +
          `"matches":{"edition":true,"grade":true,"cp_score":true,"character":true,"dm_barcode":true},` +
          `"overall":"pass|fail","reasons":["..."]}`,
      },
      { type: "image_url", image_url: { url: frontImage } },
    ];
    if (backImage) userContent.push({ type: "image_url", image_url: { url: backImage } });

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You inspect collectible card photos and respond with strict JSON only." },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, t);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please retry shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Lovable workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await aiRes.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";

    // Extract JSON object from text
    let parsed: any = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      console.error("Parse failed", e, text);
    }

    return new Response(JSON.stringify({ raw: text, result: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("card-photo-inspect error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
