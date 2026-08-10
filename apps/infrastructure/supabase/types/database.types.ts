export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          organization_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_email_verifications: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          new_email: string | null
          purpose: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          new_email?: string | null
          purpose: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          new_email?: string | null
          purpose?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_email_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_login_attempts: {
        Row: {
          email: string
          failed_count: number
          first_failed_at: string | null
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          email: string
          failed_count?: number
          first_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          failed_count?: number
          first_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      auth_mfa_recovery_codes: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_mfa_recovery_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_recovery_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          requested_ip: unknown
          token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          requested_ip?: unknown
          token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          requested_ip?: unknown
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_recovery_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      base_role_permission_overrides: {
        Row: {
          base_role: string
          created_at: string
          id: string
          organization_id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          base_role: string
          created_at?: string
          id?: string
          organization_id: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          base_role?: string
          created_at?: string
          id?: string
          organization_id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "base_role_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          base_role: string
          color: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          is_system: boolean
          name: string
          organization_id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          base_role?: string
          color?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          base_role?: string
          color?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_roles_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          custom_role_id: string | null
          declined_at: string | null
          delivery_attempts: number
          delivery_confirmed_at: string | null
          email: string
          expires_at: string
          first_name: string | null
          id: string
          invited_by: string | null
          last_delivery_attempt_at: string | null
          last_name: string | null
          organization_id: string
          revoked_at: string | null
          role: string
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          custom_role_id?: string | null
          declined_at?: string | null
          delivery_attempts?: number
          delivery_confirmed_at?: string | null
          email: string
          expires_at: string
          first_name?: string | null
          id?: string
          invited_by?: string | null
          last_delivery_attempt_at?: string | null
          last_name?: string | null
          organization_id: string
          revoked_at?: string | null
          role?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          custom_role_id?: string | null
          declined_at?: string | null
          delivery_attempts?: number
          delivery_confirmed_at?: string | null
          email?: string
          expires_at?: string
          first_name?: string | null
          id?: string
          invited_by?: string | null
          last_delivery_attempt_at?: string | null
          last_name?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_permissions: {
        Row: {
          base_role: string | null
          can_view: boolean
          created_at: string
          id: string
          menu_key: string
          organization_id: string
          role_id: string | null
          target_type: string
          user_id: string | null
        }
        Insert: {
          base_role?: string | null
          can_view?: boolean
          created_at?: string
          id?: string
          menu_key: string
          organization_id: string
          role_id?: string | null
          target_type: string
          user_id?: string | null
        }
        Update: {
          base_role?: string | null
          can_view?: boolean
          created_at?: string
          id?: string
          menu_key?: string
          organization_id?: string
          role_id?: string | null
          target_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_recovery_operations: {
        Row: {
          attempts: number
          auth_user_id: string
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          recovery_code_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          auth_user_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          recovery_code_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          auth_user_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          recovery_code_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mfa_recovery_operations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_creation_idempotencies: {
        Row: {
          created_at: string
          idempotency_key: string
          organization_id: string
          request_digest: string
          user_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          organization_id: string
          request_digest: string
          user_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          organization_id?: string
          request_digest?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_creation_idempotencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_creation_idempotencies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_legal_profiles: {
        Row: {
          created_at: string
          created_by: string
          id: string
          legal_name: string
          main_establishment_country: string
          manufacturer_contact_email: string
          manufacturer_contact_name: string
          manufacturer_contact_phone: string | null
          organization_id: string
          registered_address_administrative_area: string | null
          registered_address_country: string
          registered_address_line_1: string
          registered_address_line_2: string | null
          registered_address_locality: string
          registered_address_postal_code: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          legal_name: string
          main_establishment_country: string
          manufacturer_contact_email: string
          manufacturer_contact_name: string
          manufacturer_contact_phone?: string | null
          organization_id: string
          registered_address_administrative_area?: string | null
          registered_address_country: string
          registered_address_line_1: string
          registered_address_line_2?: string | null
          registered_address_locality: string
          registered_address_postal_code: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          legal_name?: string
          main_establishment_country?: string
          manufacturer_contact_email?: string
          manufacturer_contact_name?: string
          manufacturer_contact_phone?: string | null
          organization_id?: string
          registered_address_administrative_area?: string | null
          registered_address_country?: string
          registered_address_line_1?: string
          registered_address_line_2?: string | null
          registered_address_locality?: string
          registered_address_postal_code?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_legal_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_onboarding: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_onboarding_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_onboarding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_onboarding_evidence: {
        Row: {
          id: string
          is_available: boolean
          organization_id: string
          recorded_at: string
          recorded_by: string
          resource_id: string
          stage: string
          unavailable_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          is_available?: boolean
          organization_id: string
          recorded_at?: string
          recorded_by: string
          resource_id: string
          stage: string
          unavailable_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          is_available?: boolean
          organization_id?: string
          recorded_at?: string
          recorded_by?: string
          resource_id?: string
          stage?: string
          unavailable_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_onboarding_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_onboarding_evidence_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_onboarding_stages: {
        Row: {
          block_reason: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          organization_id: string
          stage: string
          stage_order: number
          status: string
          updated_at: string
        }
        Insert: {
          block_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          organization_id: string
          stage: string
          stage_order: number
          status: string
          updated_at?: string
        }
        Update: {
          block_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          organization_id?: string
          stage?: string
          stage_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_onboarding_stages_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_onboarding_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_permissions_version: {
        Row: {
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_permissions_version_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          legal_identity_digest: string | null
          name: string
          size: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          legal_identity_digest?: string | null
          name: string
          size?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          legal_identity_digest?: string | null
          name?: string
          size?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_role_assignments: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_table_preferences: {
        Row: {
          column_config: Json
          created_at: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
          view_id: string
        }
        Insert: {
          column_config?: Json
          created_at?: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
          view_id: string
        }
        Update: {
          column_config?: Json
          created_at?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
          view_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_table_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_table_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string | null
          avatar_path: string | null
          avatar_url: string | null
          created_at: string
          email: string
          email_verified_at: string | null
          first_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          language: string
          last_name: string | null
          session_epoch_at: string
          updated_at: string
          username: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          email_verified_at?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          language?: string
          last_name?: string | null
          session_epoch_at?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          email_verified_at?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          language?: string
          last_name?: string | null
          session_epoch_at?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation_atomic: {
        Args: { p_email: string; p_token_hash: string; p_user_id: string }
        Returns: {
          invitation_id: string | null
          organization_id: string | null
          organization_name: string | null
          organization_slug: string | null
          outcome: string
        }[]
      }
      bump_session_epoch: { Args: { p_user_id: string }; Returns: undefined }
      claim_mfa_recovery: {
        Args: { p_code_hash: string; p_user_id: string }
        Returns: {
          auth_user_id: string | null
          operation_id: string | null
          outcome: string
          status: string | null
        }[]
      }
      clear_login_attempts: { Args: { p_email: string }; Returns: undefined }
      complete_mfa_recovery: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      complete_organization_onboarding_stage: {
        Args: {
          p_actor_user_id: string
          p_completed_at: string
          p_organization_id: string
          p_resource_id: string
          p_stage: string
        }
        Returns: boolean
      }
      consume_password_reset: {
        Args: { p_token_hash: string }
        Returns: {
          auth_user_id: string | null
          outcome: string
          user_id: string | null
        }[]
      }
      create_organization_atomic: {
        Args: {
          p_actor_user_id: string
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_idempotency_key: string
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_manufacturer_contact_email: string
          p_manufacturer_contact_name: string
          p_manufacturer_contact_phone: string
          p_postal_code: string
          p_registered_address_country: string
        }
        Returns: {
          organization_id: string
          outcome: string
        }[]
      }
      expire_stale_invitations: { Args: never; Returns: number }
      fail_mfa_recovery: {
        Args: {
          p_error_code: string
          p_operation_id: string
          p_user_id: string
        }
        Returns: string
      }
      get_current_user_id: { Args: never; Returns: string }
      get_mfa_recovery_status: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      is_iso_3166_alpha_2: { Args: { p_country: string }; Returns: boolean }
      is_login_locked: { Args: { p_email: string }; Returns: string }
      m1_canonical_text: { Args: { p_value: string }; Returns: string }
      m1_legal_identity_digest: {
        Args: {
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_postal_code: string
          p_registered_address_country: string
        }
        Returns: string
      }
      m1_normalize_text: { Args: { p_value: string }; Returns: string }
      m1_organization_request_digest: {
        Args: {
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_manufacturer_contact_email: string
          p_manufacturer_contact_name: string
          p_manufacturer_contact_phone: string
          p_postal_code: string
          p_registered_address_country: string
        }
        Returns: string
      }
      mark_mfa_factors_removed: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      reconcile_organization_onboarding: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: undefined
      }
      record_invitation_delivery_onboarding_atomic: {
        Args: {
          p_actor_user_id: string
          p_invitation_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      record_login_failure: {
        Args: {
          p_email: string
          p_lock_duration?: string
          p_max_attempts?: number
          p_window?: string
        }
        Returns: string
      }
      record_organization_onboarding_evidence_atomic: {
        Args: {
          p_actor_user_id: string
          p_available?: boolean
          p_organization_id: string
          p_resource_id: string
          p_stage: string
        }
        Returns: {
          outcome: string
        }[]
      }
      resend_invitation_atomic: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_expires_at: string
          p_invitation_id: string
          p_organization_id: string
          p_token_hash: string
        }
        Returns: {
          email: string
          invitation_id: string
          organization_name: string
          outcome: string
        }[]
      }
      revoke_invitation_atomic: {
        Args: {
          p_actor_email: string
          p_actor_user_id: string
          p_invitation_id: string
          p_organization_id: string
        }
        Returns: string
      }
      switch_organization_atomic: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          outcome: string
        }[]
      }
      update_organization_legal_profile_atomic: {
        Args: {
          p_actor_user_id: string
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_contact_email_after_digest: string
          p_contact_email_before_digest: string
          p_contact_name_after_digest: string
          p_contact_name_before_digest: string
          p_contact_phone_after_digest: string
          p_contact_phone_before_digest: string
          p_expected_version: number
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_manufacturer_contact_email: string
          p_manufacturer_contact_name: string
          p_manufacturer_contact_phone: string
          p_organization_id: string
          p_postal_code: string
          p_registered_address_country: string
        }
        Returns: {
          outcome: string
        }[]
      }
      user_is_member_of: { Args: { p_org_id: string }; Returns: boolean }
      user_is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      user_org_role: { Args: { p_org_id: string }; Returns: string }
      user_shares_org_with: { Args: { p_user_id: string }; Returns: boolean }
      verify_email_code_atomic: {
        Args: {
          p_code_hash: string
          p_max_attempts?: number
          p_user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      invitation_status:
        | "pending"
        | "accepted"
        | "expired"
        | "revoked"
        | "declined"
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
      invitation_status: [
        "pending",
        "accepted",
        "expired",
        "revoked",
        "declined",
      ],
    },
  },
} as const
