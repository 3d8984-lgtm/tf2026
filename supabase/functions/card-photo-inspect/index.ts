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
    const { side, image, reference_twincode } = await req.json();
    if (!image || !side) {
      return new Response(JSON.stringify({ error: "side and image required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const isFront = side === "front";

    // Resolve the reference TwinCode image. The AI provider can only fetch raster
    // images (png/jpeg/webp/gif). SVG URLs make the upstream return 400
    // ("URL did not return an image"), so we inline raster bytes and drop SVGs.
    let refUrl: string | null = null;
    if (!isFront && typeof reference_twincode === "string" && reference_twincode) {
      if (reference_twincode.startsWith("data:image/svg")) {
        console.log("Reference twincode is an SVG data URL - skipping");
      } else if (reference_twincode.startsWith("data:image/")) {
        refUrl = reference_twincode;
      } else if (/^https?:/.test(reference_twincode)) {
        try {
          const r = await fetch(reference_twincode);
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (!r.ok) {
            console.log("Reference twincode fetch failed:", r.status, reference_twincode);
          } else if (ct.includes("svg") || reference_twincode.toLowerCase().endsWith(".svg")) {
            console.log("Reference twincode is SVG - skipping (not supported by the model)");
          } else if (ct.startsWith("image/")) {
            const buf = new Uint8Array(await r.arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            refUrl = `data:${ct.split(";")[0]};base64,${btoa(bin)}`;
          } else {
            console.log("Reference twincode is not an image:", ct);
          }
        } catch (e) {
          console.log("Reference twincode fetch error", e);
        }
      }
    }
    const hasRef = !!refUrl;


    const tool = isFront ? {
      type: "function",
      function: {
        name: "extract_card_front",
        description: "Extract text fields visible on the FRONT of a collectible card.",
        parameters: {
          type: "object",
          properties: {
            cp_score: { type: "string", description: "CP badge number, digits only e.g. '8420'. Empty if not visible." },
            edition: { type: "string", description: "EDITION value printed on the front e.g. '12 / 50' or '014/1000'. Empty if not visible." },
            notes: { type: "string", description: "One short sentence about extraction confidence/issues." },
          },
          required: ["cp_score", "edition", "notes"],
          additionalProperties: false,
        },
      },
    } : {
      type: "function",
      function: {
        name: "extract_card_back",
        description: "Extract fields visible on the BACK of a collectible card and compare the TwinCode graphic shape.",
        parameters: {
          type: "object",
          properties: {
            issued_no: { type: "string", description: "ISSUED No. value e.g. 'P7' or '#014'. Empty if not visible." },
            minted_on: { type: "string", description: "Minted on value e.g. 'S1' or '2026-04-22'. Empty if not visible." },
            card_grade: {
              type: "string",
              description: "Card grade word printed on the back. Usually one of: Common, Uncommon, Rare, Epic, Unique, Legend, Legendary. It may be printed in small caps near the grade/edition block or shown as a coloured label. Return it exactly as printed (e.g. 'Common'). Empty only if truly not visible.",
            },
            twincode: { type: "string", description: "TwinCode text printed under/next to the TwinCode graphic, if any. Empty if none." },
            twincode_shape_match: {
              type: "boolean",
              description: hasRef
                ? "TRUE if the TwinCode graphic pattern on the card back is visually the SAME SHAPE as the reference TwinCode image (compare module/segment pattern, orientation and outline, ignore colour, print quality and scale). FALSE otherwise."
                : "Always false when no reference image is provided.",
            },
            twincode_shape_note: { type: "string", description: "Short reason for the shape judgement." },
            dm_barcode: { type: "string", description: "Human readable text of the DM (Data Matrix) barcode if printed as text. Empty if only the graphic is present." },
            notes: { type: "string", description: "One short sentence about extraction confidence/issues." },
          },
          required: ["issued_no", "minted_on", "card_grade", "twincode", "twincode_shape_match", "twincode_shape_note", "dm_barcode", "notes"],
          additionalProperties: false,
        },
      },
    };

    const userContent: any[] = [
      { type: "text", text: isFront
        ? "Extract the printed text fields from the FRONT of this card. Look for the CP score badge and the EDITION value (e.g. '12 / 50' or '014/1000')."
        : `Image 1 is the BACK of the card. Extract 'ISSUED No.', 'Minted on', the card GRADE word (Common/Rare/Epic/Legend/...), and any TwinCode text.${hasRef ? " Image 2 is the reference TwinCode graphic registered for this card: judge whether the TwinCode graphic printed on the card back has the SAME SHAPE/PATTERN as the reference, and set twincode_shape_match accordingly." : " No reference TwinCode image is provided, so set twincode_shape_match to false."}` },
      { type: "image_url", image_url: { url: image } },
    ];
    if (refUrl) userContent.push({ type: "image_url", image_url: { url: refUrl } });

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a precise OCR and visual-comparison assistant for collectible cards. Read text exactly as printed. If a field is unreadable, return an empty string for it." },
          { role: "user", content: userContent },
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
      return new Response(JSON.stringify({ error: `AI gateway error (${aiRes.status}): ${t.slice(0, 300)}` }),
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
