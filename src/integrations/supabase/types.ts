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
      order_job_items: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          filename: string
          id: string
          idx: number
          job_id: string
          meta: Json
          output_path: string | null
          source_url: string
          status: Database["public"]["Enums"]["order_item_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          filename?: string
          id?: string
          idx: number
          job_id: string
          meta?: Json
          output_path?: string | null
          source_url: string
          status?: Database["public"]["Enums"]["order_item_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          filename?: string
          id?: string
          idx?: number
          job_id?: string
          meta?: Json
          output_path?: string | null
          source_url?: string
          status?: Database["public"]["Enums"]["order_item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "order_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      order_jobs: {
        Row: {
          bundle_size: number | null
          bundle_zip_path: string | null
          bundle_zip_url: string | null
          callback_url: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          factory: string
          id: string
          order_no: string
          payload: Json
          progress_current: number
          progress_total: number
          stage: string
          status: Database["public"]["Enums"]["order_job_status"]
          updated_at: string
          upload_token: string | null
          webhook_url: string
        }
        Insert: {
          bundle_size?: number | null
          bundle_zip_path?: string | null
          bundle_zip_url?: string | null
          callback_url?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          factory: string
          id?: string
          order_no: string
          payload?: Json
          progress_current?: number
          progress_total?: number
          stage?: string
          status?: Database["public"]["Enums"]["order_job_status"]
          updated_at?: string
          upload_token?: string | null
          webhook_url?: string
        }
        Update: {
          bundle_size?: number | null
          bundle_zip_path?: string | null
          bundle_zip_url?: string | null
          callback_url?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          factory?: string
          id?: string
          order_no?: string
          payload?: Json
          progress_current?: number
          progress_total?: number
          stage?: string
          status?: Database["public"]["Enums"]["order_job_status"]
          updated_at?: string
          upload_token?: string | null
          webhook_url?: string
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
      outsource_orders: {
        Row: {
          carrier: string | null
          created_at: string
          expected_at: string | null
          factory: Database["public"]["Enums"]["outsource_factory"]
          id: string
          image_url: string | null
          note: string | null
          order_no: string
          ordered_at: string
          produced_at: string | null
          product_code: string
          quantity: number
          received_at: string | null
          shipped_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["outsource_status"]
          tracking_no: string | null
          updated_at: string
          us_due_at: string | null
          wechat_sent_at: string | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          expected_at?: string | null
          factory: Database["public"]["Enums"]["outsource_factory"]
          id?: string
          image_url?: string | null
          note?: string | null
          order_no: string
          ordered_at?: string
          produced_at?: string | null
          product_code: string
          quantity?: number
          received_at?: string | null
          shipped_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["outsource_status"]
          tracking_no?: string | null
          updated_at?: string
          us_due_at?: string | null
          wechat_sent_at?: string | null
        }
        Update: {
          carrier?: string | null
          created_at?: string
          expected_at?: string | null
          factory?: Database["public"]["Enums"]["outsource_factory"]
          id?: string
          image_url?: string | null
          note?: string | null
          order_no?: string
          ordered_at?: string
          produced_at?: string | null
          product_code?: string
          quantity?: number
          received_at?: string | null
          shipped_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["outsource_status"]
          tracking_no?: string | null
          updated_at?: string
          us_due_at?: string | null
          wechat_sent_at?: string | null
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
      tshirt_colors: {
        Row: {
          active: boolean
          code: string
          created_at: string
          hex: string
          name_ko: string
          name_zh: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          hex?: string
          name_ko: string
          name_zh: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          hex?: string
          name_ko?: string
          name_zh?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      tshirt_inventory: {
        Row: {
          available: number
          color_code: string
          created_at: string
          id: string
          in_progress: number
          in_stock: number
          product_type_code: string
          safety_stock: number
          size: Database["public"]["Enums"]["tshirt_size"]
          updated_at: string
        }
        Insert: {
          available?: number
          color_code: string
          created_at?: string
          id?: string
          in_progress?: number
          in_stock?: number
          product_type_code: string
          safety_stock?: number
          size: Database["public"]["Enums"]["tshirt_size"]
          updated_at?: string
        }
        Update: {
          available?: number
          color_code?: string
          created_at?: string
          id?: string
          in_progress?: number
          in_stock?: number
          product_type_code?: string
          safety_stock?: number
          size?: Database["public"]["Enums"]["tshirt_size"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tshirt_inventory_color_code_fkey"
            columns: ["color_code"]
            isOneToOne: false
            referencedRelation: "tshirt_colors"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "tshirt_inventory_product_type_code_fkey"
            columns: ["product_type_code"]
            isOneToOne: false
            referencedRelation: "tshirt_product_types"
            referencedColumns: ["code"]
          },
        ]
      }
      tshirt_product_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          name_ko: string
          name_zh: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          name_ko: string
          name_zh: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          name_ko?: string
          name_zh?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      tshirt_purchase_order_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          po_id: string
          size_bytes: number | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          po_id: string
          size_bytes?: number | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          po_id?: string
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tshirt_purchase_order_attachments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "tshirt_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tshirt_purchase_order_items: {
        Row: {
          created_at: string
          id: string
          po_id: string
          quantity: number
          size: Database["public"]["Enums"]["tshirt_size"]
        }
        Insert: {
          created_at?: string
          id?: string
          po_id: string
          quantity?: number
          size: Database["public"]["Enums"]["tshirt_size"]
        }
        Update: {
          created_at?: string
          id?: string
          po_id?: string
          quantity?: number
          size?: Database["public"]["Enums"]["tshirt_size"]
        }
        Relationships: [
          {
            foreignKeyName: "tshirt_purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "tshirt_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tshirt_purchase_orders: {
        Row: {
          color_code: string
          created_at: string
          created_by: string | null
          created_by_label: string | null
          expected_at: string | null
          id: string
          notes: string | null
          ordered_at: string
          po_number: string
          product_type_code: string
          received_at: string | null
          status: Database["public"]["Enums"]["tshirt_po_status"]
          updated_at: string
        }
        Insert: {
          color_code: string
          created_at?: string
          created_by?: string | null
          created_by_label?: string | null
          expected_at?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string
          po_number?: string
          product_type_code: string
          received_at?: string | null
          status?: Database["public"]["Enums"]["tshirt_po_status"]
          updated_at?: string
        }
        Update: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          created_by_label?: string | null
          expected_at?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string
          po_number?: string
          product_type_code?: string
          received_at?: string | null
          status?: Database["public"]["Enums"]["tshirt_po_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tshirt_purchase_orders_color_code_fkey"
            columns: ["color_code"]
            isOneToOne: false
            referencedRelation: "tshirt_colors"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "tshirt_purchase_orders_product_type_code_fkey"
            columns: ["product_type_code"]
            isOneToOne: false
            referencedRelation: "tshirt_product_types"
            referencedColumns: ["code"]
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
      generate_tshirt_po_number: { Args: never; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      inspect_result: "pending" | "pass" | "mismatch" | "weight_fail"
      order_item_status:
        | "pending"
        | "processing"
        | "uploaded"
        | "failed"
        | "skipped"
      order_job_status:
        | "queued"
        | "processing"
        | "uploading"
        | "wechat"
        | "done"
        | "failed"
      order_status:
        | "received"
        | "in_production"
        | "completed"
        | "shipped"
        | "cancelled"
      outsource_factory: "silicon" | "heat" | "hologram" | "nfc" | "logo"
      outsource_status: "ordered" | "shipped" | "received"
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
      tshirt_po_status: "draft" | "ordered" | "in_production" | "received"
      tshirt_size: "S" | "M" | "L" | "XL" | "2XL" | "3XL" | "4XL"
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
      order_item_status: [
        "pending",
        "processing",
        "uploaded",
        "failed",
        "skipped",
      ],
      order_job_status: [
        "queued",
        "processing",
        "uploading",
        "wechat",
        "done",
        "failed",
      ],
      order_status: [
        "received",
        "in_production",
        "completed",
        "shipped",
        "cancelled",
      ],
      outsource_factory: ["silicon", "heat", "hologram", "nfc", "logo"],
      outsource_status: ["ordered", "shipped", "received"],
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
      tshirt_po_status: ["draft", "ordered", "in_production", "received"],
      tshirt_size: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    },
  },
} as const
