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
      destructive_reauth_grants: {
        Row: {
          actor_user_id: string
          consumed_at: string | null
          consumed_for: string | null
          created_at: string
          expires_at: string
          id: string
          lifecycle_version: number
          organization_id: string
          session_id: string
        }
        Insert: {
          actor_user_id: string
          consumed_at?: string | null
          consumed_for?: string | null
          created_at?: string
          expires_at: string
          id?: string
          lifecycle_version: number
          organization_id: string
          session_id: string
        }
        Update: {
          actor_user_id?: string
          consumed_at?: string | null
          consumed_for?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          lifecycle_version?: number
          organization_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "destructive_reauth_grants_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destructive_reauth_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_protection_watermarks: {
        Row: {
          evidence_class: string
          organization_id: string
          protected_through: string
          updated_at: string
        }
        Insert: {
          evidence_class: string
          organization_id: string
          protected_through?: string
          updated_at?: string
        }
        Update: {
          evidence_class?: string
          organization_id?: string
          protected_through?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_protection_watermarks_evidence_class_fkey"
            columns: ["evidence_class"]
            isOneToOne: false
            referencedRelation: "retention_evidence_classes"
            referencedColumns: ["identifier"]
          },
          {
            foreignKeyName: "evidence_protection_watermarks_organization_id_fkey"
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
      organization_branding_assets: {
        Row: {
          alt_text: string | null
          content_hash: string | null
          created_at: string
          created_by: string
          failure_code: string | null
          height: number | null
          id: string
          input_bytes: number | null
          normalized_bytes: number | null
          normalized_mime_type: string | null
          object_path: string | null
          organization_id: string
          scanner_status: string
          source_mime_type: string | null
          state: string
          updated_at: string
          updated_by: string
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          content_hash?: string | null
          created_at?: string
          created_by: string
          failure_code?: string | null
          height?: number | null
          id?: string
          input_bytes?: number | null
          normalized_bytes?: number | null
          normalized_mime_type?: string | null
          object_path?: string | null
          organization_id: string
          scanner_status?: string
          source_mime_type?: string | null
          state?: string
          updated_at?: string
          updated_by: string
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string
          failure_code?: string | null
          height?: number | null
          id?: string
          input_bytes?: number | null
          normalized_bytes?: number | null
          normalized_mime_type?: string | null
          object_path?: string | null
          organization_id?: string
          scanner_status?: string
          source_mime_type?: string | null
          state?: string
          updated_at?: string
          updated_by?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_branding_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_branding_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_branding_assets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_branding_drafts: {
        Row: {
          contact_text: string | null
          created_at: string
          created_by: string
          display_name: string
          footer_text: string | null
          id: string
          logo_asset_id: string | null
          organization_id: string
          primary_color: string
          secondary_color: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          contact_text?: string | null
          created_at?: string
          created_by: string
          display_name: string
          footer_text?: string | null
          id?: string
          logo_asset_id?: string | null
          organization_id: string
          primary_color: string
          secondary_color: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          contact_text?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          footer_text?: string | null
          id?: string
          logo_asset_id?: string | null
          organization_id?: string
          primary_color?: string
          secondary_color?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_branding_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_branding_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_branding_drafts_organization_id_logo_asset_id_fkey"
            columns: ["organization_id", "logo_asset_id"]
            isOneToOne: false
            referencedRelation: "organization_branding_assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_branding_drafts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_branding_publish_idempotencies: {
        Row: {
          actor_user_id: string
          created_at: string
          idempotency_key: string
          operation: string
          organization_id: string
          request_digest: string
          version: number
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          idempotency_key: string
          operation: string
          organization_id: string
          request_digest: string
          version: number
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          idempotency_key?: string
          operation?: string
          organization_id?: string
          request_digest?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_branding_publish_idem_organization_id_version_fkey"
            columns: ["organization_id", "version"]
            isOneToOne: false
            referencedRelation: "organization_branding_versions"
            referencedColumns: ["organization_id", "version"]
          },
          {
            foreignKeyName: "organization_branding_publish_idempotencie_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_branding_publish_idempotencies_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_branding_versions: {
        Row: {
          contact_text: string | null
          display_name: string
          draft_version: number
          footer_text: string | null
          logo_alt_text: string | null
          logo_asset_id: string | null
          logo_height: number | null
          logo_sha256: string | null
          logo_width: number | null
          organization_id: string
          primary_color: string
          primary_text_color: string
          published_at: string
          published_by: string
          secondary_color: string
          secondary_text_color: string
          version: number
        }
        Insert: {
          contact_text?: string | null
          display_name: string
          draft_version: number
          footer_text?: string | null
          logo_alt_text?: string | null
          logo_asset_id?: string | null
          logo_height?: number | null
          logo_sha256?: string | null
          logo_width?: number | null
          organization_id: string
          primary_color: string
          primary_text_color: string
          published_at?: string
          published_by: string
          secondary_color: string
          secondary_text_color: string
          version: number
        }
        Update: {
          contact_text?: string | null
          display_name?: string
          draft_version?: number
          footer_text?: string | null
          logo_alt_text?: string | null
          logo_asset_id?: string | null
          logo_height?: number | null
          logo_sha256?: string | null
          logo_width?: number | null
          organization_id?: string
          primary_color?: string
          primary_text_color?: string
          published_at?: string
          published_by?: string
          secondary_color?: string
          secondary_text_color?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_branding_version_organization_id_logo_asset_i_fkey"
            columns: ["organization_id", "logo_asset_id"]
            isOneToOne: false
            referencedRelation: "organization_branding_assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_branding_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_branding_versions_published_by_fkey"
            columns: ["published_by"]
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
      organization_deletion_artifact_work: {
        Row: {
          attempt_count: number
          available_at: string
          bucket_id: string
          created_at: string
          deletion_proof_id: string
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          object_prefix: string
          safe_error_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          bucket_id: string
          created_at?: string
          deletion_proof_id: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          object_prefix: string
          safe_error_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          bucket_id?: string
          created_at?: string
          deletion_proof_id?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          object_prefix?: string
          safe_error_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_deletion_artifact_work_deletion_proof_id_fkey"
            columns: ["deletion_proof_id"]
            isOneToOne: false
            referencedRelation: "organization_deletion_proofs"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_deletion_proofs: {
        Row: {
          artifact_deletion_completed_at: string | null
          created_at: string
          database_deleted_at: string
          deleted_organization_id: string
          id: string
          lifecycle_version: number
          organization_slug_digest: string
          purge_job_id: string
        }
        Insert: {
          artifact_deletion_completed_at?: string | null
          created_at?: string
          database_deleted_at: string
          deleted_organization_id: string
          id?: string
          lifecycle_version: number
          organization_slug_digest: string
          purge_job_id: string
        }
        Update: {
          artifact_deletion_completed_at?: string | null
          created_at?: string
          database_deleted_at?: string
          deleted_organization_id?: string
          id?: string
          lifecycle_version?: number
          organization_slug_digest?: string
          purge_job_id?: string
        }
        Relationships: []
      }
      organization_export_artifact_snapshots: {
        Row: {
          artifact_key: string
          byte_size: number
          content_type: string | null
          created_at: string
          export_job_id: string
          id: string
          metadata: Json
          organization_id: string
          sha256: string
          snapshot_object_path: string
        }
        Insert: {
          artifact_key: string
          byte_size: number
          content_type?: string | null
          created_at?: string
          export_job_id: string
          id?: string
          metadata?: Json
          organization_id: string
          sha256: string
          snapshot_object_path: string
        }
        Update: {
          artifact_key?: string
          byte_size?: number
          content_type?: string | null
          created_at?: string
          export_job_id?: string
          id?: string
          metadata?: Json
          organization_id?: string
          sha256?: string
          snapshot_object_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_artifact_snapshots_export_job_id_fkey"
            columns: ["export_job_id"]
            isOneToOne: false
            referencedRelation: "organization_export_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_artifact_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_export_idempotencies: {
        Row: {
          actor_user_id: string
          created_at: string
          export_job_id: string
          idempotency_key: string
          organization_id: string
          request_digest: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          export_job_id: string
          idempotency_key: string
          organization_id: string
          request_digest: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          export_job_id?: string
          idempotency_key?: string
          organization_id?: string
          request_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_idempotencies_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_idempotencies_export_job_id_fkey"
            columns: ["export_job_id"]
            isOneToOne: false
            referencedRelation: "organization_export_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_idempotencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_export_jobs: {
        Row: {
          actor_user_id: string
          artifact_object_path: string | null
          artifact_sha256: string | null
          attempt_count: number
          available_at: string
          checkpoint_version: number
          completed_parts: number
          correlation_id: string | null
          created_at: string
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          manifest_file_count: number | null
          manifest_format_version: number | null
          manifest_sha256: string | null
          max_attempts: number
          organization_id: string
          request_digest: string
          safe_diagnostics: Json | null
          safe_error_code: string | null
          status: string
          total_parts: number
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          actor_user_id: string
          artifact_object_path?: string | null
          artifact_sha256?: string | null
          attempt_count?: number
          available_at?: string
          checkpoint_version?: number
          completed_parts?: number
          correlation_id?: string | null
          created_at?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          manifest_file_count?: number | null
          manifest_format_version?: number | null
          manifest_sha256?: string | null
          max_attempts?: number
          organization_id: string
          request_digest: string
          safe_diagnostics?: Json | null
          safe_error_code?: string | null
          status?: string
          total_parts?: number
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          actor_user_id?: string
          artifact_object_path?: string | null
          artifact_sha256?: string | null
          attempt_count?: number
          available_at?: string
          checkpoint_version?: number
          completed_parts?: number
          correlation_id?: string | null
          created_at?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          manifest_file_count?: number | null
          manifest_format_version?: number | null
          manifest_sha256?: string | null
          max_attempts?: number
          organization_id?: string
          request_digest?: string
          safe_diagnostics?: Json | null
          safe_error_code?: string | null
          status?: string
          total_parts?: number
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_jobs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_export_parts: {
        Row: {
          byte_size: number
          created_at: string
          export_job_id: string
          id: string
          object_path: string
          organization_id: string
          part_number: number
          sha256: string
          source_id: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          export_job_id: string
          id?: string
          object_path: string
          organization_id: string
          part_number: number
          sha256: string
          source_id: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          export_job_id?: string
          id?: string
          object_path?: string
          organization_id?: string
          part_number?: number
          sha256?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_parts_export_job_id_fkey"
            columns: ["export_job_id"]
            isOneToOne: false
            referencedRelation: "organization_export_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_parts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_parts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "organization_export_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      organization_export_snapshot_records: {
        Row: {
          created_at: string
          export_job_id: string
          id: string
          organization_id: string
          record_index: number
          record_payload: Json
          source_id: string
          table_name: string
          table_sort: number
        }
        Insert: {
          created_at?: string
          export_job_id: string
          id?: string
          organization_id: string
          record_index: number
          record_payload: Json
          source_id: string
          table_name: string
          table_sort: number
        }
        Update: {
          created_at?: string
          export_job_id?: string
          id?: string
          organization_id?: string
          record_index?: number
          record_payload?: Json
          source_id?: string
          table_name?: string
          table_sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_snapshot_records_export_job_id_fkey"
            columns: ["export_job_id"]
            isOneToOne: false
            referencedRelation: "organization_export_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_snapshot_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_snapshot_records_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "organization_export_sources"
            referencedColumns: ["source_id"]
          },
          {
            foreignKeyName: "organization_export_snapshot_records_source_id_table_name_fkey"
            columns: ["source_id", "table_name"]
            isOneToOne: false
            referencedRelation: "organization_export_source_tables"
            referencedColumns: ["source_id", "table_name"]
          },
        ]
      }
      organization_export_snapshots: {
        Row: {
          created_at: string
          export_job_id: string
          id: string
          materialized_at: string | null
          materialized_by: string | null
          materialized_checkpoint_version: number | null
          organization_id: string
          snapshot_version: number
          source_catalog_version: number
          source_ids: string[]
        }
        Insert: {
          created_at?: string
          export_job_id: string
          id?: string
          materialized_at?: string | null
          materialized_by?: string | null
          materialized_checkpoint_version?: number | null
          organization_id: string
          snapshot_version: number
          source_catalog_version?: number
          source_ids: string[]
        }
        Update: {
          created_at?: string
          export_job_id?: string
          id?: string
          materialized_at?: string | null
          materialized_by?: string | null
          materialized_checkpoint_version?: number | null
          organization_id?: string
          snapshot_version?: number
          source_catalog_version?: number
          source_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_snapshots_export_job_id_fkey"
            columns: ["export_job_id"]
            isOneToOne: false
            referencedRelation: "organization_export_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_snapshots_materialized_by_fkey"
            columns: ["materialized_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_export_source_tables: {
        Row: {
          record_order_column: string
          source_id: string
          table_name: string
          table_sort: number
          tenant_key_column: string
        }
        Insert: {
          record_order_column: string
          source_id: string
          table_name: string
          table_sort: number
          tenant_key_column: string
        }
        Update: {
          record_order_column?: string
          source_id?: string
          table_name?: string
          table_sort?: number
          tenant_key_column?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_source_tables_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "organization_export_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      organization_export_sources: {
        Row: {
          enabled: boolean
          sort_order: number
          source_id: string
        }
        Insert: {
          enabled?: boolean
          sort_order: number
          source_id: string
        }
        Update: {
          enabled?: boolean
          sort_order?: number
          source_id?: string
        }
        Relationships: []
      }
      organization_legal_entities: {
        Row: {
          completion_status: string
          created_at: string
          created_by: string
          deleted_at: string | null
          display_name: string
          id: string
          identifier: string
          is_default: boolean
          legal_name: string | null
          main_establishment_country: string | null
          manufacturer_contact_email: string | null
          manufacturer_contact_name: string | null
          organization_id: string
          phone: string | null
          registered_address_administrative_area: string | null
          registered_address_country: string | null
          registered_address_line_1: string | null
          registered_address_line_2: string | null
          registered_address_locality: string | null
          registered_address_postal_code: string | null
          registration_identifier: string | null
          registration_identifier_normalized: string | null
          status: string
          tax_identifier: string | null
          tax_identifier_normalized: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          completion_status?: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          display_name: string
          id?: string
          identifier: string
          is_default?: boolean
          legal_name?: string | null
          main_establishment_country?: string | null
          manufacturer_contact_email?: string | null
          manufacturer_contact_name?: string | null
          organization_id: string
          phone?: string | null
          registered_address_administrative_area?: string | null
          registered_address_country?: string | null
          registered_address_line_1?: string | null
          registered_address_line_2?: string | null
          registered_address_locality?: string | null
          registered_address_postal_code?: string | null
          registration_identifier?: string | null
          registration_identifier_normalized?: string | null
          status?: string
          tax_identifier?: string | null
          tax_identifier_normalized?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          completion_status?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          display_name?: string
          id?: string
          identifier?: string
          is_default?: boolean
          legal_name?: string | null
          main_establishment_country?: string | null
          manufacturer_contact_email?: string | null
          manufacturer_contact_name?: string | null
          organization_id?: string
          phone?: string | null
          registered_address_administrative_area?: string | null
          registered_address_country?: string | null
          registered_address_line_1?: string | null
          registered_address_line_2?: string | null
          registered_address_locality?: string | null
          registered_address_postal_code?: string | null
          registration_identifier?: string | null
          registration_identifier_normalized?: string | null
          status?: string
          tax_identifier?: string | null
          tax_identifier_normalized?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_legal_entities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_entities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_entities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_legal_entity_create_idempotencies: {
        Row: {
          actor_user_id: string
          created_at: string
          idempotency_key: string
          legal_entity_id: string
          organization_id: string
          request_digest: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          idempotency_key: string
          legal_entity_id: string
          organization_id: string
          request_digest: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          idempotency_key?: string
          legal_entity_id?: string
          organization_id?: string
          request_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_legal_entity_cre_organization_id_legal_entity_fkey"
            columns: ["organization_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "organization_legal_entities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_legal_entity_create_idempoten_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_entity_create_idempotenci_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_legal_entity_dependency_authorities: {
        Row: {
          authority_kind: string
          available: boolean
          last_reconciled_at: string | null
          legal_entity_id: string
          organization_id: string
          reconciled_by: string | null
          safe_error_code: string | null
        }
        Insert: {
          authority_kind: string
          available?: boolean
          last_reconciled_at?: string | null
          legal_entity_id: string
          organization_id: string
          reconciled_by?: string | null
          safe_error_code?: string | null
        }
        Update: {
          authority_kind?: string
          available?: boolean
          last_reconciled_at?: string | null
          legal_entity_id?: string
          organization_id?: string
          reconciled_by?: string | null
          safe_error_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_legal_entity_dep_organization_id_legal_entity_fkey"
            columns: ["organization_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "organization_legal_entities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_legal_entity_dependency_autho_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_entity_dependency_authori_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_legal_entity_dependency_facts: {
        Row: {
          authority_kind: string
          legal_entity_id: string
          organization_id: string
          reconciled_at: string
          reconciled_by: string | null
          record_count: number
          source_record_id: string
        }
        Insert: {
          authority_kind: string
          legal_entity_id: string
          organization_id: string
          reconciled_at?: string
          reconciled_by?: string | null
          record_count: number
          source_record_id: string
        }
        Update: {
          authority_kind?: string
          legal_entity_id?: string
          organization_id?: string
          reconciled_at?: string
          reconciled_by?: string | null
          record_count?: number
          source_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_legal_entity_de_organization_id_legal_entity_fkey1"
            columns: ["organization_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "organization_legal_entities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "organization_legal_entity_dependency_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_legal_entity_dependency_facts_reconciled_by_fkey"
            columns: ["reconciled_by"]
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
      organization_lifecycles: {
        Row: {
          changed_at: string
          changed_by: string | null
          created_at: string
          deactivated_at: string | null
          organization_id: string
          purge_after: string | null
          purge_block_reasons: Json
          safe_error_code: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          organization_id: string
          purge_after?: string | null
          purge_block_reasons?: Json
          safe_error_code?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          organization_id?: string
          purge_after?: string | null
          purge_block_reasons?: Json
          safe_error_code?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_lifecycles_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_lifecycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
      organization_purge_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          blocked_reasons: Json
          checkpoint_version: number
          created_at: string
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          lifecycle_version: number
          max_attempts: number
          organization_id: string
          purge_after: string
          requested_by: string | null
          safe_diagnostics: Json | null
          safe_error_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at: string
          blocked_reasons?: Json
          checkpoint_version?: number
          created_at?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lifecycle_version: number
          max_attempts?: number
          organization_id: string
          purge_after: string
          requested_by?: string | null
          safe_diagnostics?: Json | null
          safe_error_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          blocked_reasons?: Json
          checkpoint_version?: number
          created_at?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          lifecycle_version?: number
          max_attempts?: number
          organization_id?: string
          purge_after?: string
          requested_by?: string | null
          safe_diagnostics?: Json | null
          safe_error_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_purge_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_purge_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_purge_work_items: {
        Row: {
          checkpoint_version: number
          created_at: string
          id: string
          organization_id: string
          purge_job_id: string
          safe_error_code: string | null
          status: string
          updated_at: string
          work_kind: string
        }
        Insert: {
          checkpoint_version?: number
          created_at?: string
          id?: string
          organization_id: string
          purge_job_id: string
          safe_error_code?: string | null
          status?: string
          updated_at?: string
          work_kind: string
        }
        Update: {
          checkpoint_version?: number
          created_at?: string
          id?: string
          organization_id?: string
          purge_job_id?: string
          safe_error_code?: string | null
          status?: string
          updated_at?: string
          work_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_purge_work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_purge_work_items_purge_job_id_fkey"
            columns: ["purge_job_id"]
            isOneToOne: false
            referencedRelation: "organization_purge_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_retention_policies: {
        Row: {
          created_at: string
          effective_floor_days: number
          effective_retention_days: number
          evidence_class: string
          floor_snapshot_version: number
          id: string
          organization_id: string
          requested_retention_days: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          effective_floor_days?: number
          effective_retention_days: number
          evidence_class: string
          floor_snapshot_version?: number
          id?: string
          organization_id: string
          requested_retention_days: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          effective_floor_days?: number
          effective_retention_days?: number
          evidence_class?: string
          floor_snapshot_version?: number
          id?: string
          organization_id?: string
          requested_retention_days?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_retention_policies_evidence_class_fkey"
            columns: ["evidence_class"]
            isOneToOne: false
            referencedRelation: "retention_evidence_classes"
            referencedColumns: ["identifier"]
          },
          {
            foreignKeyName: "organization_retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_retention_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_session_bindings: {
        Row: {
          issued_at: string
          last_seen_at: string
          organization_id: string
          session_id: string
          user_id: string
        }
        Insert: {
          issued_at: string
          last_seen_at?: string
          organization_id: string
          session_id: string
          user_id: string
        }
        Update: {
          issued_at?: string
          last_seen_at?: string
          organization_id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_session_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_session_bindings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_session_revocations: {
        Row: {
          lifecycle_version: number | null
          organization_id: string
          reason: string
          revoked_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          lifecycle_version?: number | null
          organization_id: string
          reason: string
          revoked_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          lifecycle_version?: number | null
          organization_id?: string
          reason?: string
          revoked_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_session_revocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_session_revocations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          ai_provider_id: string | null
          configured: boolean
          created_at: string
          data_residency_id: string | null
          holidays: string[] | null
          maximum_session_age_minutes: number | null
          mfa_enforcement_date: string | null
          notification_channel_ids: string[] | null
          organization_id: string
          timezone: string | null
          updated_at: string
          updated_by: string | null
          version: number
          working_days: string[] | null
        }
        Insert: {
          ai_provider_id?: string | null
          configured?: boolean
          created_at?: string
          data_residency_id?: string | null
          holidays?: string[] | null
          maximum_session_age_minutes?: number | null
          mfa_enforcement_date?: string | null
          notification_channel_ids?: string[] | null
          organization_id: string
          timezone?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          working_days?: string[] | null
        }
        Update: {
          ai_provider_id?: string | null
          configured?: boolean
          created_at?: string
          data_residency_id?: string | null
          holidays?: string[] | null
          maximum_session_age_minutes?: number | null
          mfa_enforcement_date?: string | null
          notification_channel_ids?: string[] | null
          organization_id?: string
          timezone?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
          working_days?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      retention_authoritative_facts: {
        Row: {
          active: boolean
          evidence_class: string
          first_observed_at: string
          last_observed_at: string
          organization_id: string
          protect_through: string | null
          reason_kind: string
          required_retention_days: number
          source_record_id: string
        }
        Insert: {
          active?: boolean
          evidence_class: string
          first_observed_at?: string
          last_observed_at?: string
          organization_id: string
          protect_through?: string | null
          reason_kind: string
          required_retention_days: number
          source_record_id: string
        }
        Update: {
          active?: boolean
          evidence_class?: string
          first_observed_at?: string
          last_observed_at?: string
          organization_id?: string
          protect_through?: string | null
          reason_kind?: string
          required_retention_days?: number
          source_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_authoritative_facts_evidence_class_fkey"
            columns: ["evidence_class"]
            isOneToOne: false
            referencedRelation: "retention_evidence_classes"
            referencedColumns: ["identifier"]
          },
          {
            foreignKeyName: "retention_authoritative_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_authority_states: {
        Row: {
          authority_kind: string
          available: boolean
          last_reconciled_at: string | null
          organization_id: string
          safe_error_code: string | null
        }
        Insert: {
          authority_kind: string
          available?: boolean
          last_reconciled_at?: string | null
          organization_id: string
          safe_error_code?: string | null
        }
        Update: {
          authority_kind?: string
          available?: boolean
          last_reconciled_at?: string | null
          organization_id?: string
          safe_error_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_authority_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_cleanup_items: {
        Row: {
          attempt_count: number
          cleanup_run_id: string
          created_at: string
          evidence_class: string
          id: string
          observed_at: string
          organization_id: string
          protection_watermark: string
          safe_error_code: string | null
          source_record_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          cleanup_run_id: string
          created_at?: string
          evidence_class: string
          id?: string
          observed_at: string
          organization_id: string
          protection_watermark: string
          safe_error_code?: string | null
          source_record_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          cleanup_run_id?: string
          created_at?: string
          evidence_class?: string
          id?: string
          observed_at?: string
          organization_id?: string
          protection_watermark?: string
          safe_error_code?: string | null
          source_record_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_cleanup_items_cleanup_run_id_fkey"
            columns: ["cleanup_run_id"]
            isOneToOne: false
            referencedRelation: "retention_cleanup_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_cleanup_items_evidence_class_fkey"
            columns: ["evidence_class"]
            isOneToOne: false
            referencedRelation: "retention_evidence_classes"
            referencedColumns: ["identifier"]
          },
          {
            foreignKeyName: "retention_cleanup_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_cleanup_runs: {
        Row: {
          attempt_count: number
          available_at: string
          blocked_reasons: Json
          checkpoint_version: number
          completed_at: string | null
          created_at: string
          evidence_class: string
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          organization_id: string
          requested_by: string | null
          safe_diagnostics: Json | null
          safe_error_code: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          blocked_reasons?: Json
          checkpoint_version?: number
          completed_at?: string | null
          created_at?: string
          evidence_class: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          organization_id: string
          requested_by?: string | null
          safe_diagnostics?: Json | null
          safe_error_code?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          blocked_reasons?: Json
          checkpoint_version?: number
          completed_at?: string | null
          created_at?: string
          evidence_class?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          organization_id?: string
          requested_by?: string | null
          safe_diagnostics?: Json | null
          safe_error_code?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_cleanup_runs_evidence_class_fkey"
            columns: ["evidence_class"]
            isOneToOne: false
            referencedRelation: "retention_evidence_classes"
            referencedColumns: ["identifier"]
          },
          {
            foreignKeyName: "retention_cleanup_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_cleanup_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_evidence_classes: {
        Row: {
          default_requested_retention_days: number
          enabled: boolean
          identifier: string
        }
        Insert: {
          default_requested_retention_days?: number
          enabled?: boolean
          identifier: string
        }
        Update: {
          default_requested_retention_days?: number
          enabled?: boolean
          identifier?: string
        }
        Relationships: []
      }
      retention_floor_reasons: {
        Row: {
          evidence_class: string
          organization_id: string
          protect_through: string | null
          reason_kind: string
          required_retention_days: number
          snapshot_id: string
          source_record_id: string
        }
        Insert: {
          evidence_class: string
          organization_id: string
          protect_through?: string | null
          reason_kind: string
          required_retention_days: number
          snapshot_id: string
          source_record_id: string
        }
        Update: {
          evidence_class?: string
          organization_id?: string
          protect_through?: string | null
          reason_kind?: string
          required_retention_days?: number
          snapshot_id?: string
          source_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_floor_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_floor_reasons_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "retention_floor_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_floor_snapshots: {
        Row: {
          created_at: string
          effective_floor_days: number
          evidence_class: string
          id: string
          organization_id: string
          reason_digest: string
          snapshot_version: number
        }
        Insert: {
          created_at?: string
          effective_floor_days: number
          evidence_class: string
          id?: string
          organization_id: string
          reason_digest: string
          snapshot_version: number
        }
        Update: {
          created_at?: string
          effective_floor_days?: number
          evidence_class?: string
          id?: string
          organization_id?: string
          reason_digest?: string
          snapshot_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "retention_floor_snapshots_organization_id_evidence_class_fkey"
            columns: ["organization_id", "evidence_class"]
            isOneToOne: false
            referencedRelation: "organization_retention_policies"
            referencedColumns: ["organization_id", "evidence_class"]
          },
          {
            foreignKeyName: "retention_floor_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings_catalog: {
        Row: {
          category: string
          enabled: boolean
          identifier: string
          sort_order: number
        }
        Insert: {
          category: string
          enabled?: boolean
          identifier: string
          sort_order?: number
        }
        Update: {
          category?: string
          enabled?: boolean
          identifier?: string
          sort_order?: number
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
      backfill_organization_legal_entities: { Args: never; Returns: undefined }
      bump_session_epoch: { Args: { p_user_id: string }; Returns: undefined }
      checkpoint_organization_export_atomic: {
        Args: {
          p_completed_parts: number
          p_expected_checkpoint_version: number
          p_export_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_parts: Json
          p_total_parts: number
        }
        Returns: {
          checkpoint_version: number
          outcome: string
        }[]
      }
      claim_mfa_recovery: {
        Args: { p_code_hash: string; p_user_id: string }
        Returns: {
          auth_user_id: string | null
          operation_id: string | null
          outcome: string
          status: string | null
        }[]
      }
      claim_organization_deletion_artifact_work_atomic: {
        Args: { p_lease_owner: string; p_lease_seconds: number }
        Returns: {
          bucket_id: string
          object_prefix: string
          outcome: string
          work_id: string
        }[]
      }
      claim_organization_export_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          export_job_id: string
          lease_owner: string
          outcome: string
          snapshot: Json
        }[]
      }
      claim_organization_purge_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          blocked_reasons: Json
          checkpoint_version: number
          lease_owner: string
          outcome: string
          purge_job_id: string
        }[]
      }
      claim_retention_cleanup_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          blocked_reasons: Json
          checkpoint_version: number
          cleanup_run_id: string
          lease_owner: string
          outcome: string
        }[]
      }
      clear_login_attempts: { Args: { p_email: string }; Returns: undefined }
      complete_mfa_recovery: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      complete_organization_deletion_artifact_work_atomic: {
        Args: { p_lease_owner: string; p_work_id: string }
        Returns: {
          outcome: string
        }[]
      }
      complete_organization_export_atomic: {
        Args: {
          p_artifact_object_path?: string
          p_artifact_sha256: string
          p_expected_checkpoint_version: number
          p_export_job_id: string
          p_lease_owner: string
          p_manifest_file_count: number
          p_manifest_sha256: string
          p_organization_id: string
        }
        Returns: {
          export_job: Json
          outcome: string
        }[]
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
      complete_organization_purge_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_purge_job_id: string
        }
        Returns: {
          deletion_proof_id: string
          outcome: string
        }[]
      }
      complete_retention_cleanup_atomic: {
        Args: {
          p_cleanup_run_id: string
          p_expected_checkpoint_version: number
          p_item_results: Json
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          outcome: string
        }[]
      }
      consume_destructive_reauth_grant_atomic: {
        Args: {
          p_actor_user_id: string
          p_consumed_for: string
          p_grant_id: string
          p_lifecycle_version: number
          p_organization_id: string
          p_session_id: string
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
      create_destructive_reauth_grant_atomic: {
        Args: {
          p_actor_user_id: string
          p_expires_at: string
          p_lifecycle_version: number
          p_organization_id: string
          p_session_id: string
        }
        Returns: {
          expires_at: string
          grant_id: string
          outcome: string
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
      create_organization_legal_entity_atomic: {
        Args: {
          p_actor_user_id: string
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_display_name: string
          p_idempotency_key: string
          p_identifier: string
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_manufacturer_contact_email: string
          p_manufacturer_contact_name: string
          p_organization_id: string
          p_phone: string
          p_postal_code: string
          p_registered_address_country: string
          p_registration_identifier: string
          p_tax_identifier: string
        }
        Returns: {
          legal_entity: Json
          outcome: string
        }[]
      }
      deactivate_organization_atomic: {
        Args: {
          p_actor_user_id: string
          p_confirmation: string
          p_expected_version: number
          p_organization_id: string
          p_reauth_grant_id: string
          p_session_id: string
        }
        Returns: {
          lifecycle: Json
          outcome: string
        }[]
      }
      ensure_organization_branding_draft: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: undefined
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
      fail_organization_branding_asset_upload_atomic: {
        Args: {
          p_actor_user_id: string
          p_asset_id: string
          p_failure_code: string
          p_organization_id: string
          p_quarantined: boolean
        }
        Returns: {
          outcome: string
        }[]
      }
      fail_organization_deletion_artifact_work_atomic: {
        Args: {
          p_lease_owner: string
          p_retryable: boolean
          p_safe_error_code: string
          p_work_id: string
        }
        Returns: {
          outcome: string
          status: string
        }[]
      }
      fail_organization_export_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_export_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_pause?: boolean
          p_retryable: boolean
          p_safe_diagnostics?: Json
          p_safe_error_code: string
        }
        Returns: {
          outcome: string
          status: string
        }[]
      }
      fail_organization_purge_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_purge_job_id: string
          p_retryable: boolean
          p_safe_diagnostics?: Json
          p_safe_error_code: string
        }
        Returns: {
          outcome: string
          status: string
        }[]
      }
      fail_retention_cleanup_atomic: {
        Args: {
          p_cleanup_run_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
          p_safe_diagnostics?: Json
          p_safe_error_code: string
        }
        Returns: {
          outcome: string
          status: string
        }[]
      }
      finalize_organization_branding_asset_upload_atomic: {
        Args: {
          p_actor_user_id: string
          p_asset_id: string
          p_content_hash: string
          p_height: number
          p_input_bytes: number
          p_organization_id: string
          p_scanner_status: string
          p_width: number
        }
        Returns: {
          branding: Json
          draft: Json
          outcome: string
        }[]
      }
      get_current_user_id: { Args: never; Returns: string }
      get_mfa_recovery_status: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      get_organization_branding: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          branding: Json
          outcome: string
        }[]
      }
      get_organization_branding_assets: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          assets: Json
          outcome: string
        }[]
      }
      get_organization_branding_draft: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          branding: Json
          draft: Json
          outcome: string
        }[]
      }
      get_organization_branding_export_snapshot: {
        Args: { p_organization_id: string; p_version: number }
        Returns: {
          branding: Json
          outcome: string
        }[]
      }
      get_organization_branding_logo_render: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          object_key: string
          outcome: string
          sha256: string
        }[]
      }
      get_organization_legal_entities: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          legal_entities: Json
          outcome: string
        }[]
      }
      get_organization_legal_entity: {
        Args: {
          p_actor_user_id: string
          p_legal_entity_id: string
          p_organization_id: string
        }
        Returns: {
          legal_entity: Json
          outcome: string
        }[]
      }
      get_organization_lifecycle: {
        Args: { p_organization_id: string }
        Returns: {
          lifecycle: Json
          outcome: string
        }[]
      }
      get_organization_retention_policies: {
        Args: { p_organization_id: string }
        Returns: {
          outcome: string
          policies: Json
        }[]
      }
      get_organization_settings: {
        Args: { p_organization_id: string }
        Returns: {
          outcome: string
          settings: Json
        }[]
      }
      get_organization_settings_catalog: {
        Args: { p_organization_id: string }
        Returns: {
          catalog: Json
          outcome: string
        }[]
      }
      is_iso_3166_alpha_2: { Args: { p_country: string }; Returns: boolean }
      is_login_locked: { Args: { p_email: string }; Returns: string }
      m1_accept_invitation_atomic_legacy_unchecked: {
        Args: { p_email: string; p_token_hash: string; p_user_id: string }
        Returns: {
          invitation_id: string
          organization_id: string
          organization_name: string
          organization_slug: string
          outcome: string
        }[]
      }
      m1_canonical_text: { Args: { p_value: string }; Returns: string }
      m1_export_redact_jsonb: { Args: { p_value: Json }; Returns: Json }
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
      m1_normalize_lifecycle_blockers: {
        Args: { p_reasons: Json }
        Returns: Json
      }
      m1_normalize_text: { Args: { p_value: string }; Returns: string }
      m1_organization_lifecycle_json: {
        Args: { p_organization_id: string }
        Returns: Json
      }
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
      m1_retention_policy_json: {
        Args: { p_evidence_class: string; p_organization_id: string }
        Returns: Json
      }
      m1_settings_json: { Args: { p_organization_id: string }; Returns: Json }
      m1_v2_brand_text_color: {
        Args: { p_background: string }
        Returns: string
      }
      m1_v2_branding_asset_logo_json: {
        Args: { p_asset_id: string }
        Returns: Json
      }
      m1_v2_branding_draft_json: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      m1_v2_branding_draft_preview_json: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      m1_v2_branding_operation_digest: {
        Args: {
          p_expected_version: number
          p_operation: string
          p_request_digest: string
        }
        Returns: string
      }
      m1_v2_branding_version_json: {
        Args: { p_organization_id: string; p_version: number }
        Returns: Json
      }
      m1_v2_current_branding_json: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      m1_v2_hex_contrast: {
        Args: { p_first: string; p_second: string }
        Returns: number
      }
      m1_v2_hex_luminance: { Args: { p_color: string }; Returns: number }
      m1_v2_is_active_organization_member: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: boolean
      }
      m1_v2_is_active_organization_owner: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: boolean
      }
      m1_v2_legal_entity_dependency_json: {
        Args: { p_legal_entity_id: string; p_organization_id: string }
        Returns: Json
      }
      m1_v2_legal_entity_json: {
        Args: { p_legal_entity_id: string }
        Returns: Json
      }
      m1_v2_legal_entity_lifecycle_block_reason: {
        Args: { p_legal_entity_id: string; p_organization_id: string }
        Returns: string
      }
      m1_v2_legal_entity_request_digest: {
        Args: {
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_display_name: string
          p_identifier: string
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_manufacturer_contact_email: string
          p_manufacturer_contact_name: string
          p_phone: string
          p_postal_code: string
          p_registered_address_country: string
          p_registration_identifier: string
          p_tax_identifier: string
        }
        Returns: string
      }
      m1_v2_normalize_legal_identifier: {
        Args: { p_value: string }
        Returns: string
      }
      m1_v2_sentinel_branding_json: { Args: never; Returns: Json }
      mark_mfa_factors_removed: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      materialize_organization_export_snapshot_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_export_job_id: string
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          outcome: string
        }[]
      }
      publish_organization_branding_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_request_digest: string
        }
        Returns: {
          branding: Json
          idempotent: boolean
          outcome: string
        }[]
      }
      reconcile_organization_legal_entity_dependencies_atomic: {
        Args: {
          p_actor_user_id: string
          p_authority_kind: string
          p_available: boolean
          p_facts: Json
          p_legal_entity_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      reconcile_organization_onboarding: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: undefined
      }
      reconcile_organization_retention_atomic: {
        Args: {
          p_actor_user_id: string
          p_authority_available: boolean
          p_authority_kind: string
          p_facts: Json
          p_organization_id: string
        }
        Returns: {
          outcome: string
          policies: Json
        }[]
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
      record_invitation_delivery_onboarding_atomic_legacy_unchecked: {
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
      record_organization_export_artifact_snapshot_atomic: {
        Args: {
          p_artifact_key: string
          p_byte_size: number
          p_content_type: string
          p_expected_checkpoint_version: number
          p_export_job_id: string
          p_lease_owner: string
          p_metadata?: Json
          p_organization_id: string
          p_sha256: string
          p_snapshot_object_path: string
        }
        Returns: {
          outcome: string
        }[]
      }
      record_organization_export_download_atomic: {
        Args: {
          p_actor_user_id: string
          p_export_job_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
        }[]
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
      record_organization_onboarding_evidence_atomic_legacy_unchecked: {
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
      recover_organization_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_organization_id: string
          p_reauth_grant_id: string
          p_session_id: string
        }
        Returns: {
          lifecycle: Json
          outcome: string
        }[]
      }
      register_organization_session_atomic: {
        Args: {
          p_issued_at: string
          p_organization_id: string
          p_session_id: string
          p_user_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      remove_organization_branding_logo_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_request_digest: string
        }
        Returns: {
          branding: Json
          idempotent: boolean
          outcome: string
        }[]
      }
      request_organization_export_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id?: string
          p_idempotency_key: string
          p_organization_id: string
          p_request_digest: string
        }
        Returns: {
          export_job: Json
          export_job_id: string
          idempotent: boolean
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
      resend_invitation_atomic_legacy_unchecked: {
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
      reserve_organization_branding_asset_upload_atomic: {
        Args: {
          p_actor_user_id: string
          p_alt_text: string
          p_organization_id: string
        }
        Returns: {
          asset_id: string
          object_key: string
          outcome: string
        }[]
      }
      resolve_active_organization_legal_entity_context: {
        Args: { p_legal_entity_id: string; p_organization_id: string }
        Returns: {
          context: Json
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
      save_organization_branding_draft_atomic: {
        Args: {
          p_actor_user_id: string
          p_contact_text: string
          p_display_name: string
          p_expected_version: number
          p_footer_text: string
          p_logo_asset_id: string
          p_organization_id: string
          p_primary_color: string
          p_secondary_color: string
        }
        Returns: {
          branding: Json
          draft: Json
          outcome: string
        }[]
      }
      schedule_organization_purge_atomic: {
        Args: {
          p_actor_user_id: string
          p_confirmation: string
          p_expected_version: number
          p_organization_id: string
          p_reauth_grant_id: string
          p_session_id: string
        }
        Returns: {
          lifecycle: Json
          outcome: string
          purge_job_id: string
        }[]
      }
      switch_organization_atomic: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          outcome: string
        }[]
      }
      transition_organization_legal_entity_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_legal_entity_id: string
          p_organization_id: string
          p_status: string
        }
        Returns: {
          block_reason: string
          legal_entity: Json
          outcome: string
        }[]
      }
      update_organization_legal_entity_atomic: {
        Args: {
          p_actor_user_id: string
          p_address_line_1: string
          p_address_line_2: string
          p_administrative_area: string
          p_display_name: string
          p_expected_version: number
          p_identifier: string
          p_legal_entity_id: string
          p_legal_name: string
          p_locality: string
          p_main_establishment_country: string
          p_manufacturer_contact_email: string
          p_manufacturer_contact_name: string
          p_organization_id: string
          p_phone: string
          p_postal_code: string
          p_registered_address_country: string
          p_registration_identifier: string
          p_tax_identifier: string
        }
        Returns: {
          legal_entity: Json
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
      update_organization_retention_policy_atomic: {
        Args: {
          p_actor_user_id: string
          p_evidence_class: string
          p_expected_version: number
          p_organization_id: string
          p_requested_retention_days: number
        }
        Returns: {
          outcome: string
          policy: Json
        }[]
      }
      update_organization_settings_atomic: {
        Args: {
          p_actor_user_id: string
          p_ai_provider_id: string
          p_data_residency_id: string
          p_expected_version: number
          p_holidays: string[]
          p_maximum_session_age_minutes: number
          p_mfa_enforcement_date: string
          p_notification_channel_ids: string[]
          p_organization_id: string
          p_session_id: string
          p_timezone: string
          p_working_days: string[]
        }
        Returns: {
          outcome: string
          session_policy_tightened: boolean
          settings: Json
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
