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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      batches: {
        Row: {
          created_at: string
          failed: number
          id: string
          mode: string
          ok: number
          platforms: string[]
          seconds: number
          template_name: string | null
          user_id: string
          videos: number
        }
        Insert: {
          created_at?: string
          failed?: number
          id?: string
          mode?: string
          ok?: number
          platforms?: string[]
          seconds?: number
          template_name?: string | null
          user_id: string
          videos?: number
        }
        Update: {
          created_at?: string
          failed?: number
          id?: string
          mode?: string
          ok?: number
          platforms?: string[]
          seconds?: number
          template_name?: string | null
          user_id?: string
          videos?: number
        }
        Relationships: []
      }
      cleaner_jobs: {
        Row: {
          created_at: string
          detections: Json
          error: string | null
          filename: string
          id: string
          masks: Json
          metrics: Json | null
          mode: string
          options: Json
          preset: string
          preview_url: string | null
          probe: Json | null
          progress: number
          result_url: string | null
          size_bytes: number | null
          stage: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detections?: Json
          error?: string | null
          filename: string
          id?: string
          masks?: Json
          metrics?: Json | null
          mode?: string
          options?: Json
          preset?: string
          preview_url?: string | null
          probe?: Json | null
          progress?: number
          result_url?: string | null
          size_bytes?: number | null
          stage?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detections?: Json
          error?: string | null
          filename?: string
          id?: string
          masks?: Json
          metrics?: Json | null
          mode?: string
          options?: Json
          preset?: string
          preview_url?: string | null
          probe?: Json | null
          progress?: number
          result_url?: string | null
          size_bytes?: number | null
          stage?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clip_outcomes: {
        Row: {
          clip_seconds: number
          created_at: string
          id: string
          post_id: string | null
          predicted_score: number
          source: string
          tags: string[]
          user_id: string
        }
        Insert: {
          clip_seconds?: number
          created_at?: string
          id?: string
          post_id?: string | null
          predicted_score?: number
          source?: string
          tags?: string[]
          user_id: string
        }
        Update: {
          clip_seconds?: number
          created_at?: string
          id?: string
          post_id?: string | null
          predicted_score?: number
          source?: string
          tags?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_outcomes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "scheduled_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      exports: {
        Row: {
          bytes: number
          created_at: string
          file_name: string
          id: string
          mode: string
          platform: string | null
          seconds: number
          source_name: string | null
          user_id: string
          variant: string | null
        }
        Insert: {
          bytes?: number
          created_at?: string
          file_name: string
          id?: string
          mode: string
          platform?: string | null
          seconds?: number
          source_name?: string | null
          user_id: string
          variant?: string | null
        }
        Update: {
          bytes?: number
          created_at?: string
          file_name?: string
          id?: string
          mode?: string
          platform?: string | null
          seconds?: number
          source_name?: string | null
          user_id?: string
          variant?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          data: Json
          id: string
          mode: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          mode: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          mode?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_posts: {
        Row: {
          account_id: string | null
          attempts: number
          caption: string
          created_at: string
          error: string | null
          error_code: string | null
          file_name: string | null
          id: string
          kind: string
          lock_id: string | null
          locked_at: string | null
          next_attempt_at: string | null
          permalink: string | null
          provider_post_id: string | null
          published_at: string | null
          scheduled_at: string
          status: string
          updated_at: string
          user_id: string
          video_path: string | null
          video_url: string | null
        }
        Insert: {
          account_id?: string | null
          attempts?: number
          caption?: string
          created_at?: string
          error?: string | null
          error_code?: string | null
          file_name?: string | null
          id?: string
          kind?: string
          lock_id?: string | null
          locked_at?: string | null
          next_attempt_at?: string | null
          permalink?: string | null
          provider_post_id?: string | null
          published_at?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
          user_id: string
          video_path?: string | null
          video_url?: string | null
        }
        Update: {
          account_id?: string | null
          attempts?: number
          caption?: string
          created_at?: string
          error?: string | null
          error_code?: string | null
          file_name?: string | null
          id?: string
          kind?: string
          lock_id?: string | null
          locked_at?: string | null
          next_attempt_at?: string | null
          permalink?: string | null
          provider_post_id?: string | null
          published_at?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          video_path?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          platform: string
          provider: string
          provider_account_id: string | null
          status: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          platform?: string
          provider?: string
          provider_account_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          platform?: string
          provider?: string
          provider_account_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      social_connections: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          provider: string
          provider_account_id: string | null
          social_account_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          provider?: string
          provider_account_id?: string | null
          social_account_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          provider?: string
          provider_account_id?: string | null
          social_account_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: true
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_connection_credentials: {
        Row: {
          access_token_ciphertext: string
          connection_id: string
          created_at: string
          expires_at: string
          updated_at: string
        }
        Insert: {
          access_token_ciphertext: string
          connection_id: string
          created_at?: string
          expires_at: string
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string
          connection_id?: string
          created_at?: string
          expires_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_connection_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      template_versions: {
        Row: {
          created_at: string
          data: Json
          id: string
          label: string
          template_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          label?: string
          template_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          label?: string
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          data: Json
          id: string
          local_id: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          local_id?: string | null
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          local_id?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_due_scheduled_posts: {
        Args: {
          p_limit: number
          p_lock_id: string
          p_lock_timeout_seconds: number
          p_max_attempts: number
        }
        Returns: {
          account_id: string
          attempts: number
          caption: string
          id: string
          kind: string
          user_id: string
          video_path: string
          video_url: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      link_global_meta_account: {
        Args: {
          p_provider_account_id: string
          p_user_id: string
          p_username: string
        }
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          id: string
          platform: string
          provider: string
          provider_account_id: string
          status: string
          username: string
        }[]
      }
      link_meta_oauth_account: {
        Args: {
          p_access_token_ciphertext: string
          p_expires_at: string
          p_provider_account_id: string
          p_user_id: string
          p_username: string
        }
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          id: string
          platform: string
          provider: string
          provider_account_id: string
          status: string
          username: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
