import { useLang } from "@/contexts/LangContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-receive`;

const PAYLOAD_EXAMPLE = `{
  "event_type": "order_create",
  "source": "site_a",
  "order": {
    "external_order_id": "A-20260324-001",
    "product_code": "TS-BLK-M",
    "design_code": "D-LOGO-01",
    "quantity": 3,
    "recipient_name": "John Doe",
    "recipient_phone": "+1-555-1234",
    "shipping_address": "123 Main St",
    "shipping_city": "Los Angeles",
    "shipping_state": "CA",
    "shipping_zip": "90001",
    "shipping_country": "US"
  },
  "design_images": [
    { "filename": "D-LOGO-01.png", "url": "https://twinmeta.example.com/files/D-LOGO-01.png" },
    { "filename": "D-LOGO-01-back.png", "base64": "iVBORw0KGgoAAAANS...", "content_type": "image/png" }
  ],
  "twincode_images": [
    { "filename": "TC-001.png", "url": "https://twinmeta.example.com/files/TC-001.png" }
  ]
}`;

export default function WebhookSettings() {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["webhook_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: 10000,
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColor = (status: string) => {
    if (status === "processed") return "default";
    if (status === "received") return "secondary";
    return "destructive";
  };

  return (
    <div className="section-enter space-y-6">
      <h3 className="font-semibold text-lg">{t("webhook.title")}</h3>

      {/* Webhook URL */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("webhook.url")}</label>
        <p className="text-xs text-muted-foreground">{t("webhook.urlDesc")}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all">
            {WEBHOOK_URL}
          </code>
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 shrink-0">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? t("webhook.copied") : t("webhook.copy")}
          </Button>
        </div>
      </div>

      {/* Auth header info */}
      <div className="space-y-1">
        <label className="text-sm font-medium">{t("webhook.secretHeader")}</label>
        <p className="text-xs text-muted-foreground">{t("webhook.secretDesc")}</p>
        <code className="block bg-muted px-3 py-2 rounded text-xs font-mono">
          x-webhook-secret: &lt;your-secret&gt;
        </code>
      </div>

      {/* Payload example */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("webhook.payloadExample")}</label>
        <pre className="bg-muted p-4 rounded text-xs font-mono overflow-x-auto max-h-64">
          {PAYLOAD_EXAMPLE}
        </pre>
      </div>

      {/* Logs */}
      <div className="space-y-2">
        <h4 className="font-medium">{t("webhook.logs")}</h4>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("webhook.time")}</TableHead>
                <TableHead>{t("webhook.eventType")}</TableHead>
                <TableHead>{t("webhook.source")}</TableHead>
                <TableHead>{t("webhook.status")}</TableHead>
                <TableHead>{t("webhook.error")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">...</TableCell>
                </TableRow>
              ) : !logs?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {t("webhook.noLogs")}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{log.event_type}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{log.source}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor(log.status)} className="text-xs">{log.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-48 truncate">
                      {log.error_message || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
