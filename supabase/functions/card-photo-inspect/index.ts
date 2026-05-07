// Card photo inspection via Lovable AI Gateway (Gemini Vision)
// Extracts TEXT fields only from front/back card photos using tool-calling for strict JSON.
// Front: cp_score, card_sequence (e.g. "12 / 50" or "#014/1000/R1" bottom-right)
// Back: edition, minted_on, twincode, dm_barcode, card_grade

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { side, image } = await req.json();
    if (!image || !side) {
      return new Response(JSON.stringify({ error: "side and image required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const isFront = side === "front";

    const tool = isFront ? {
      type: "function",
      function: {
        name: "extract_card_front",
        description: "Extract text fields visible on the front of a collectible card.",
        parameters: {
          type: "object",
          properties: {
            cp_score: { type: "string", description: "CP badge number, digits only e.g. '8420'. Empty if not visible." },
            card_sequence: { type: "string", description: "Card sequence at bottom-right (e.g. 'TM-CARD-A0731' or '#014/1000/R1'). Empty if not visible." },
            notes: { type: "string", description: "One short sentence about extraction confidence/issues." },
          },
          required: ["cp_score", "card_sequence", "notes"],
          additionalProperties: false,
        },
      },
    } : {
      type: "function",
      function: {
        name: "extract_card_back",
        description: "Extract text fields visible on the back of a collectible card.",
        parameters: {
          type: "object",
          properties: {
            edition: { type: "string", description: "EDITION printed value e.g. '12 / 50'. Empty if not visible." },
            minted_on: { type: "string", description: "Minted on date e.g. '2026-04-22'. Empty if not visible." },
            twincode: { type: "string", description: "TwinCode value e.g. 'TWN-007-A'. Empty if not visible." },
            dm_barcode: { type: "string", description: "DM barcode text e.g. 'DM-2026-0501-00731'. Empty if not visible." },
            card_grade: { type: "string", description: "Card grade letter e.g. 'S','A','B'. Empty if not visible." },
            notes: { type: "string", description: "One short sentence about extraction confidence/issues." },
          },
          required: ["edition", "minted_on", "twincode", "dm_barcode", "card_grade", "notes"],
          additionalProperties: false,
        },
      },
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a precise OCR assistant for collectible cards. Read text exactly as printed. If a field is unreadable, return an empty string for it." },
          {
            role: "user",
            content: [
              { type: "text", text: isFront
                ? "Extract the printed text fields from the FRONT of this card. Look for the CP score badge and the card sequence number at the bottom-right area."
                : "Extract the printed text fields from the BACK of this card. Look for EDITION, 'Minted on' date, TwinCode, DM barcode text, and card grade letter." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: tool.function.name } },
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
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    let extracted: any = null;
    try {
      extracted = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
    } catch (e) {
      console.error("Tool args parse failed", e, call?.function?.arguments);
    }

    return new Response(JSON.stringify({ side, extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("card-photo-inspect error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
