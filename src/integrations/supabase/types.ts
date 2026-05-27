export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      callback_settings: {
        Row: {
          auth_header: string
          auth_value: string
          auto_sync: boolean
          callback_url: string
          created_at: string
          enabled: boolean
          id: string
          sync_delivered: boolean
          sync_status_change: boolean
          sync_tracking_number: boolean
          updated_at: string
        }
        Insert: {
          auth_header?: string
          auth_value?: string
          auto_sync?: boolean
          callback_url?: string
          created_at?: string
          enabled?: boolean
          id?: string
          sync_delivered?: boolean
          sync_status_change?: boolean
          sync_tracking_number?: boolean
          updated_at?: string
        }
        Update: {
          auth_header?: string
          auth_value?: string
          auto_sync?: boolean
          callback_url?: string
          created_at?: string
          enabled?: boolean
          id?: string
          sync_delivered?: boolean
          sync_status_change?: boolean
          sync_tracking_number?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      card_element: {
        Row: {
          created_at: string
          element_type: string
          field_name: string
          font_color: string | null
          font_family: string | null
          font_size_pt: number | null
          height_mm: number
          id: string
          rotation_deg: number
          side: string
          template_id: string
          text_align: string | null
          updated_at: string
          width_mm: number
          x_mm: number
          y_mm: number
          z_index: number
        }
        Insert: {
          created_at?: string
          element_type: string
          field_name: string
          font_color?: string | null
          font_family?: string | null
          font_size_pt?: number | null
          height_mm?: number
          id?: string
          rotation_deg?: number
          side: string
          template_id: string
          text_align?: string | null
          updated_at?: string
          width_mm?: number
          x_mm?: number
          y_mm?: number
          z_index?: number
        }
        Update: {
          created_at?: string
          element_type?: string
          field_name?: string
          font_color?: string | null
          font_family?: string | null
          font_size_pt?: number | null
          height_mm?: number
          id?: string
          rotation_deg?: number
          side?: string
          template_id?: string
          text_align?: string | null
          updated_at?: string
          width_mm?: number
          x_mm?: number
          y_mm?: number
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_element_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "card_template"
            referencedColumns: ["id"]
          },
        ]
      }
      card_order: {
        Row: {
          created_at: string
          id: string
          order_name: string
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_name: string
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_name?: string
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_order_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "card_template"
            referencedColumns: ["id"]
          },
        ]
      }
      card_order_item: {
        Row: {
          created_at: string
          data: Json
          id: string
          order_id: string
          pdf_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          order_id: string
          pdf_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          order_id?: string
          pdf_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_order_item_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "card_order"
            referencedColumns: ["id"]
          },
        ]
      }
      card_template: {
        Row: {
          back_pdf_url: string | null
          back_preview_png_url: string | null
          created_at: string
          front_pdf_url: string | null
          front_preview_png_url: string | null
          height_mm: number
          id: string
          name: string
          updated_at: string
          width_mm: number
        }
        Insert: {
          back_pdf_url?: string | null
          back_preview_png_url?: string | null
          created_at?: string
          front_pdf_url?: string | null
          front_preview_png_url?: string | null
          height_mm?: number
          id?: string
          name: string
          updated_at?: string
          width_mm?: number
        }
        Update: {
          back_pdf_url?: string | null
          back_preview_png_url?: string | null
          created_at?: string
          front_pdf_url?: string | null
          front_preview_png_url?: string | null
          height_mm?: number
          id?: string
          name?: string
          updated_at?: string
          width_mm?: number
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          design_code: string | null
          external_order_id: string
          id: string
          logo_url: string | null
          product_code: string
          project_completed_at: string | null
          quantity: number
          recipient_name: string
          recipient_phone: string | null
          shipping_address: string
          shipping_city: string | null
          shipping_country: string
          shipping_state: string | null
          shipping_zip: string | null
          source_data: Json | null
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
          upload_history_id: string | null
        }
        Insert: {
          created_at?: string
          design_code?: string | null
          external_order_id: string
          id?: string
          logo_url?: string | null
          product_code: string
          project_completed_at?: string | null
          quantity: number
          recipient_name: string
          recipient_phone?: string | null
          shipping_address: string
          shipping_city?: string | null
          shipping_country?: string
          shipping_state?: string | null
          shipping_zip?: string | null
          source_data?: Json | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          upload_history_id?: string | null
        }
        Update: {
          created_at?: string
          design_code?: string | null
          external_order_id?: string
          id?: string
          logo_url?: string | null
          product_code?: string
          project_completed_at?: string | null
          quantity?: number
          recipient_name?: string
          recipient_phone?: string | null
          shipping_address?: string
          shipping_city?: string | null
          shipping_country?: string
          shipping_state?: string | null
          shipping_zip?: string | null
          source_data?: Json | null
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
          upload_history_id?: string | null
        }
        Relationships: []
      }
      production_tracking: {
        Row: {
          completed_at: string | null
          completed_count: number
          created_at: string
          id: string
          machine_id: string | null
          machine_status: string | null
          order_id: string
          stage: Database["public"]["Enums"]["production_stage"]
          started_at: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          id?: string
          machine_id?: string | null
          machine_status?: string | null
          order_id: string
          stage: Database["public"]["Enums"]["production_stage"]
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          id?: string
          machine_id?: string | null
          machine_status?: string | null
          order_id?: string
          stage?: Database["public"]["Enums"]["production_stage"]
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_tracking_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string | null
          id: string
          name: string | null
          phone: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      qr_design_master: {
        Row: {
          created_at: string
          design_code: string
          design_name: string | null
          id: string
          qr_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          design_code: string
          design_name?: string | null
          id?: string
          qr_value: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          design_code?: string
          design_name?: string | null
          id?: string
          qr_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      qr_hologram_master: {
        Row: {
          created_at: string
          hologram_type: string | null
          id: string
          qr_value: string
          serial_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hologram_type?: string | null
          id?: string
          qr_value: string
          serial_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hologram_type?: string | null
          id?: string
          qr_value?: string
          serial_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      qr_silicon_master: {
        Row: {
          created_at: string
          id: string
          product_code: string | null
          qr_value: string
          serial_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_code?: string | null
          qr_value: string
          serial_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          product_code?: string | null
          qr_value?: string
          serial_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      qr_tshirt_master: {
        Row: {
          color: string
          created_at: string
          id: string
          product_code: string | null
          qr_value: string
          size: string
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          product_code?: string | null
          qr_value: string
          size: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          product_code?: string | null
          qr_value?: string
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipments: {
        Row: {
          carrier: string
          carrier_response: Json | null
          created_at: string
          delivered_at: string | null
          expected_weight_grams: number | null
          id: string
          inspect_qr_match: boolean | null
          inspect_result: Database["public"]["Enums"]["inspect_result"]
          inspect_weight: boolean | null
          label_url: string | null
          order_id: string
          set_id: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["shipment_status"]
          synced_at: string | null
          synced_to_source: boolean | null
          tracking_number: string | null
          updated_at: string
          weight_grams: number | null
        }
        Insert: {
          carrier?: string
          carrier_response?: Json | null
          created_at?: string
          delivered_at?: string | null
          expected_weight_grams?: number | null
          id?: string
          inspect_qr_match?: boolean | null
          inspect_result?: Database["public"]["Enums"]["inspect_result"]
          inspect_weight?: boolean | null
          label_url?: string | null
          order_id: string
          set_id?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          synced_at?: string | null
          synced_to_source?: boolean | null
          tracking_number?: string | null
          updated_at?: string
          weight_grams?: number | null
        }
        Update: {
          carrier?: string
          carrier_response?: Json | null
          created_at?: string
          delivered_at?: string | null
          expected_weight_grams?: number | null
          id?: string
          inspect_qr_match?: boolean | null
          inspect_result?: Database["public"]["Enums"]["inspect_result"]
          inspect_weight?: boolean | null
          label_url?: string | null
          order_id?: string
          set_id?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          synced_at?: string | null
          synced_to_source?: boolean | null
          tracking_number?: string | null
          updated_at?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_history: {
        Row: {
          created_at: string
          design_image_count: number
          error_count: number
          file_name: string
          file_path: string | null
          id: string
          logo_path: string | null
          row_count: number
          source: string
          success_count: number
          twincode_image_count: number
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          design_image_count?: number
          error_count?: number
          file_name: string
          file_path?: string | null
          id?: string
          logo_path?: string | null
          row_count?: number
          source?: string
          success_count?: number
          twincode_image_count?: number
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          design_image_count?: number
          error_count?: number
          file_name?: string
          file_path?: string | null
          id?: string
          logo_path?: string | null
          row_count?: number
          source?: string
          success_count?: number
          twincode_image_count?: number
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_ui_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          payload: Json
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          source?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      inspect_result: "pending" | "pass" | "mismatch" | "weight_fail"
      order_status:
        | "received"
        | "in_production"
        | "completed"
        | "shipped"
        | "cancelled"
      production_stage:
        | "tshirt"
        | "card"
        | "set"
        | "weight"
        | "courier"
        | "invoice"
        | "done"
      shipment_status:
        | "pending"
        | "label_requested"
        | "label_received"
        | "packed"
        | "shipped"
        | "in_transit"
        | "delivered"
        | "hold"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      inspect_result: ["pending", "pass", "mismatch", "weight_fail"],
      order_status: [
        "received",
        "in_production",
        "completed",
        "shipped",
        "cancelled",
      ],
      production_stage: [
        "tshirt",
        "card",
        "set",
        "weight",
        "courier",
        "invoice",
        "done",
      ],
      shipment_status: [
        "pending",
        "label_requested",
        "label_received",
        "packed",
        "shipped",
        "in_transit",
        "delivered",
        "hold",
      ],
    },
  },
} as const
