// Returns whether WEBHOOK_SECRET is configured (boolean only — never the value).
// Used by the UI to decide whether the API integration is "Connected" vs "Waiting".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const secret = Deno.env.get("WEBHOOK_SECRET") || "";
  return new Response(
    JSON.stringify({ secret_configured: secret.length > 0 }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
