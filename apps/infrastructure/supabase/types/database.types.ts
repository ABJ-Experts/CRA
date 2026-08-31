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
      connector_secrets: {
        Row: {
          ciphertext: string
          connector_id: string
          created_at: string
          id: string
          organization_id: string
          rotated_at: string
          rotated_by: string
        }
        Insert: {
          ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          organization_id: string
          rotated_at?: string
          rotated_by: string
        }
        Update: {
          ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          rotated_at?: string
          rotated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_secrets_organization_id_connector_id_fkey"
            columns: ["organization_id", "connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "connector_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_secrets_rotated_by_fkey"
            columns: ["rotated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          adapter_version: string
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          commit_policy: string
          connection_config: Json
          connector_type: string
          create_idempotency_key: string | null
          create_request_digest: string | null
          created_at: string
          created_by: string
          display_name: string
          enabled: boolean
          id: string
          last_test_error_code: string | null
          last_test_outcome: string | null
          last_tested_at: string | null
          mapping_version: string
          organization_id: string
          secret_ref: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          adapter_version: string
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          commit_policy?: string
          connection_config?: Json
          connector_type: string
          create_idempotency_key?: string | null
          create_request_digest?: string | null
          created_at?: string
          created_by: string
          display_name: string
          enabled?: boolean
          id?: string
          last_test_error_code?: string | null
          last_test_outcome?: string | null
          last_tested_at?: string | null
          mapping_version: string
          organization_id: string
          secret_ref?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          adapter_version?: string
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          commit_policy?: string
          connection_config?: Json
          connector_type?: string
          create_idempotency_key?: string | null
          create_request_digest?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          enabled?: boolean
          id?: string
          last_test_error_code?: string | null
          last_test_outcome?: string | null
          last_tested_at?: string | null
          mapping_version?: string
          organization_id?: string
          secret_ref?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "connectors_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connectors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connectors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connectors_secret_ref_fkey"
            columns: ["organization_id", "secret_ref"]
            isOneToOne: false
            referencedRelation: "connector_secrets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "connectors_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      field_authority_policies: {
        Row: {
          connector_id: string
          created_at: string
          created_by: string
          effective_from: string
          entity_type: string
          field_name: string
          id: string
          organization_id: string
          policy_value: string
          policy_version: number
          protected: boolean
          protected_reason: string | null
          superseded_at: string | null
          superseded_by_id: string | null
          supersedes_id: string | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          connector_id: string
          created_at?: string
          created_by: string
          effective_from?: string
          entity_type: string
          field_name: string
          id?: string
          organization_id: string
          policy_value: string
          policy_version?: number
          protected?: boolean
          protected_reason?: string | null
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          connector_id?: string
          created_at?: string
          created_by?: string
          effective_from?: string
          entity_type?: string
          field_name?: string
          id?: string
          organization_id?: string
          policy_value?: string
          policy_version?: number
          protected?: boolean
          protected_reason?: string | null
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_authority_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_authority_policies_organization_id_connector_id_fkey"
            columns: ["organization_id", "connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "field_authority_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_authority_policies_organization_id_superseded_by_id_fkey"
            columns: ["organization_id", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "field_authority_policies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "field_authority_policies_organization_id_supersedes_id_fkey"
            columns: ["organization_id", "supersedes_id"]
            isOneToOne: false
            referencedRelation: "field_authority_policies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "field_authority_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_impact_associations: {
        Row: {
          affected_product_id: string
          affected_release_id: string | null
          created_at: string
          first_evaluated_at: string
          id: string
          last_evaluated_at: string
          last_seen_job_id: string | null
          organization_id: string
          relationship_path_hash: string
          relationship_path_ids: string[]
          rule_version: string
          source_finding_id: string
          source_graph_version: number
          status: string
          superseded_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          affected_product_id: string
          affected_release_id?: string | null
          created_at?: string
          first_evaluated_at?: string
          id?: string
          last_evaluated_at?: string
          last_seen_job_id?: string | null
          organization_id: string
          relationship_path_hash: string
          relationship_path_ids?: string[]
          rule_version: string
          source_finding_id: string
          source_graph_version: number
          status?: string
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          affected_product_id?: string
          affected_release_id?: string | null
          created_at?: string
          first_evaluated_at?: string
          id?: string
          last_evaluated_at?: string
          last_seen_job_id?: string | null
          organization_id?: string
          relationship_path_hash?: string
          relationship_path_ids?: string[]
          rule_version?: string
          source_finding_id?: string
          source_graph_version?: number
          status?: string
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "finding_impact_associations_organization_id_affected_prod_fkey1"
            columns: [
              "organization_id",
              "affected_product_id",
              "affected_release_id",
            ]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "finding_impact_associations_organization_id_affected_produ_fkey"
            columns: ["organization_id", "affected_product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "finding_impact_associations_organization_id_affected_produ_fkey"
            columns: ["organization_id", "affected_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_impact_associations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_impact_associations_organization_id_last_seen_job__fkey"
            columns: ["organization_id", "last_seen_job_id"]
            isOneToOne: false
            referencedRelation: "finding_propagation_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_impact_associations_organization_id_source_finding_fkey"
            columns: ["organization_id", "source_finding_id"]
            isOneToOne: false
            referencedRelation: "finding_propagation_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      finding_product_impact_overrides: {
        Row: {
          affected_product_id: string
          affected_release_id: string | null
          created_at: string
          created_by: string
          effective_ends_at: string | null
          effective_starts_at: string
          end_idempotency_key: string | null
          end_idempotency_request_digest: string | null
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          organization_id: string
          override_state: string
          provenance: string
          reason: string
          source: string
          source_finding_id: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          affected_product_id: string
          affected_release_id?: string | null
          created_at?: string
          created_by: string
          effective_ends_at?: string | null
          effective_starts_at: string
          end_idempotency_key?: string | null
          end_idempotency_request_digest?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id: string
          override_state: string
          provenance: string
          reason: string
          source: string
          source_finding_id: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          affected_product_id?: string
          affected_release_id?: string | null
          created_at?: string
          created_by?: string
          effective_ends_at?: string | null
          effective_starts_at?: string
          end_idempotency_key?: string | null
          end_idempotency_request_digest?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id?: string
          override_state?: string
          provenance?: string
          reason?: string
          source?: string
          source_finding_id?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "finding_product_impact_overr_organization_id_affected_pro_fkey1"
            columns: [
              "organization_id",
              "affected_product_id",
              "affected_release_id",
            ]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "finding_product_impact_overri_organization_id_affected_pro_fkey"
            columns: ["organization_id", "affected_product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "finding_product_impact_overri_organization_id_affected_pro_fkey"
            columns: ["organization_id", "affected_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_product_impact_overri_organization_id_source_findi_fkey"
            columns: ["organization_id", "source_finding_id"]
            isOneToOne: false
            referencedRelation: "finding_propagation_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_product_impact_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_product_impact_overrides_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_product_impact_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_product_impact_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_propagation_jobs: {
        Row: {
          as_of: string
          checkpoint_version: number
          created_at: string
          cursor: string | null
          delivery_attempts: number
          due_at: string
          graph_version: number
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          organization_id: string
          processed_count: number
          requested_by: string
          rule_version: string
          source_baseline_revision_id: string | null
          source_finding_id: string
          source_release_id: string | null
          status: string
          superseded_count: number
          trigger_key: string
          updated_at: string
          upserted_count: number
        }
        Insert: {
          as_of: string
          checkpoint_version?: number
          created_at?: string
          cursor?: string | null
          delivery_attempts?: number
          due_at?: string
          graph_version: number
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          organization_id: string
          processed_count?: number
          requested_by: string
          rule_version: string
          source_baseline_revision_id?: string | null
          source_finding_id: string
          source_release_id?: string | null
          status?: string
          superseded_count?: number
          trigger_key: string
          updated_at?: string
          upserted_count?: number
        }
        Update: {
          as_of?: string
          checkpoint_version?: number
          created_at?: string
          cursor?: string | null
          delivery_attempts?: number
          due_at?: string
          graph_version?: number
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          organization_id?: string
          processed_count?: number
          requested_by?: string
          rule_version?: string
          source_baseline_revision_id?: string | null
          source_finding_id?: string
          source_release_id?: string | null
          status?: string
          superseded_count?: number
          trigger_key?: string
          updated_at?: string
          upserted_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "finding_propagation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_propagation_jobs_organization_id_source_baseline_r_fkey"
            columns: ["organization_id", "source_baseline_revision_id"]
            isOneToOne: false
            referencedRelation: "software_baselines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_propagation_jobs_organization_id_source_finding_id_fkey"
            columns: ["organization_id", "source_finding_id"]
            isOneToOne: false
            referencedRelation: "finding_propagation_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_propagation_jobs_organization_id_source_release_id_fkey"
            columns: ["organization_id", "source_release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_propagation_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_propagation_sources: {
        Row: {
          created_at: string
          created_by: string
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          organization_id: string
          provenance: string
          rule_version: string
          source: string
          source_baseline_revision_id: string | null
          source_finding_key: string
          source_product_id: string
          source_release_id: string | null
          source_system: string
          status: string
          update_idempotency_actor_id: string | null
          update_idempotency_key: string | null
          update_idempotency_request_digest: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id: string
          provenance: string
          rule_version: string
          source: string
          source_baseline_revision_id?: string | null
          source_finding_key: string
          source_product_id: string
          source_release_id?: string | null
          source_system: string
          status?: string
          update_idempotency_actor_id?: string | null
          update_idempotency_key?: string | null
          update_idempotency_request_digest?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id?: string
          provenance?: string
          rule_version?: string
          source?: string
          source_baseline_revision_id?: string | null
          source_finding_key?: string
          source_product_id?: string
          source_release_id?: string | null
          source_system?: string
          status?: string
          update_idempotency_actor_id?: string | null
          update_idempotency_key?: string | null
          update_idempotency_request_digest?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "finding_propagation_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_organization_id_source_baselin_fkey"
            columns: ["organization_id", "source_baseline_revision_id"]
            isOneToOne: false
            referencedRelation: "software_baselines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_organization_id_source_produc_fkey1"
            columns: [
              "organization_id",
              "source_product_id",
              "source_release_id",
            ]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_organization_id_source_product_fkey"
            columns: ["organization_id", "source_product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_organization_id_source_product_fkey"
            columns: ["organization_id", "source_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_update_idempotency_actor_id_fkey"
            columns: ["update_idempotency_actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_propagation_sources_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      member_state_reference_entries: {
        Row: {
          active: boolean
          country_code: string
          created_at: string
          name: string
          reference_version_id: string
        }
        Insert: {
          active?: boolean
          country_code: string
          created_at?: string
          name: string
          reference_version_id: string
        }
        Update: {
          active?: boolean
          country_code?: string
          created_at?: string
          name?: string
          reference_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_state_reference_entries_reference_version_id_fkey"
            columns: ["reference_version_id"]
            isOneToOne: false
            referencedRelation: "member_state_reference_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      member_state_reference_versions: {
        Row: {
          active: boolean
          created_at: string
          effective_from: string
          id: string
          reference_set_id: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          effective_from: string
          id?: string
          reference_set_id: string
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          reference_set_id?: string
          version?: number
        }
        Relationships: []
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
      organization_sbom_quality_settings: {
        Row: {
          bsi_profile_enabled: boolean
          bsi_ruleset_version: string
          config_version: number
          created_at: string
          created_by: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bsi_profile_enabled?: boolean
          bsi_ruleset_version?: string
          config_version?: number
          created_at?: string
          created_by?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bsi_profile_enabled?: boolean
          bsi_ruleset_version?: string
          config_version?: number
          created_at?: string
          created_by?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_sbom_quality_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_sbom_quality_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_sbom_quality_settings_updated_by_fkey"
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
          product_relationship_graph_version: number
          support_alert_intervals: number[]
          support_alert_intervals_updated_at: string
          support_alert_intervals_updated_by: string | null
          support_alert_intervals_version: number
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
          product_relationship_graph_version?: number
          support_alert_intervals?: number[]
          support_alert_intervals_updated_at?: string
          support_alert_intervals_updated_by?: string | null
          support_alert_intervals_version?: number
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
          product_relationship_graph_version?: number
          support_alert_intervals?: number[]
          support_alert_intervals_updated_at?: string
          support_alert_intervals_updated_by?: string | null
          support_alert_intervals_version?: number
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
            foreignKeyName: "organization_settings_support_alert_intervals_updated_by_fkey"
            columns: ["support_alert_intervals_updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      product_create_idempotencies: {
        Row: {
          actor_user_id: string
          created_at: string
          idempotency_key: string
          organization_id: string
          payload_digest: string
          product_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          idempotency_key: string
          organization_id: string
          payload_digest: string
          product_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          idempotency_key?: string
          organization_id?: string
          payload_digest?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_create_idempotencies_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_create_idempotencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_create_idempotencies_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_create_idempotencies_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      product_external_identities: {
        Row: {
          connector_id: string
          cra_product_id: string
          cra_release_id: string | null
          created_at: string
          created_by: string
          entity_type: string
          external_display_label: string | null
          external_id: string
          external_id_normalized: string | null
          id: string
          linked_at: string
          linked_by: string
          match_confidence: string
          match_method: string
          organization_id: string
          superseded_at: string | null
          superseded_by_id: string | null
          supersedes_id: string | null
          supersession_reason: string | null
          unlink_reason: string | null
          unlinked_at: string | null
          unlinked_by: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          connector_id: string
          cra_product_id: string
          cra_release_id?: string | null
          created_at?: string
          created_by: string
          entity_type: string
          external_display_label?: string | null
          external_id: string
          external_id_normalized?: string | null
          id?: string
          linked_at?: string
          linked_by: string
          match_confidence: string
          match_method: string
          organization_id: string
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          supersession_reason?: string | null
          unlink_reason?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          connector_id?: string
          cra_product_id?: string
          cra_release_id?: string | null
          created_at?: string
          created_by?: string
          entity_type?: string
          external_display_label?: string | null
          external_id?: string
          external_id_normalized?: string | null
          id?: string
          linked_at?: string
          linked_by?: string
          match_confidence?: string
          match_method?: string
          organization_id?: string
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          supersession_reason?: string | null
          unlink_reason?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_external_identities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_external_identities_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_external_identities_organization_id_connector_id_fkey"
            columns: ["organization_id", "connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_external_identities_organization_id_cra_product_id_fkey"
            columns: ["organization_id", "cra_product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_external_identities_organization_id_cra_product_id_fkey"
            columns: ["organization_id", "cra_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_external_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_external_identities_organization_id_superseded_by__fkey"
            columns: ["organization_id", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "product_external_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_external_identities_organization_id_supersedes_id_fkey"
            columns: ["organization_id", "supersedes_id"]
            isOneToOne: false
            referencedRelation: "product_external_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_external_identities_unlinked_by_fkey"
            columns: ["unlinked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_external_identities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_external_identity_release_fkey"
            columns: ["organization_id", "cra_product_id", "cra_release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
        ]
      }
      product_import_jobs: {
        Row: {
          actor_user_id: string
          byte_size: number
          canceled_at: string | null
          cancellation_reason: string | null
          checkpoint_row_number: number
          commit_actor_user_id: string | null
          commit_idempotency_key: string | null
          commit_request_digest: string | null
          committed_at: string | null
          committed_row_count: number
          content_hash: string
          correlation_id: string
          create_count: number
          created_at: string
          dry_run_completed_at: string | null
          error_code: string | null
          expires_at: string
          failed_count: number
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          next_attempt_at: string
          organization_id: string
          original_filename: string
          processed_row_count: number
          report_deleted_at: string | null
          report_object_path: string | null
          retention_until: string
          retry_count: number
          row_count: number
          schema_version: string
          skipped_count: number
          source_deleted_at: string | null
          source_object_path: string
          status: string
          unchanged_count: number
          update_count: number
          updated_at: string
          upload_idempotency_key: string
          upload_request_digest: string
          warning_count: number
          work_kind: string
        }
        Insert: {
          actor_user_id: string
          byte_size: number
          canceled_at?: string | null
          cancellation_reason?: string | null
          checkpoint_row_number?: number
          commit_actor_user_id?: string | null
          commit_idempotency_key?: string | null
          commit_request_digest?: string | null
          committed_at?: string | null
          committed_row_count?: number
          content_hash: string
          correlation_id: string
          create_count?: number
          created_at?: string
          dry_run_completed_at?: string | null
          error_code?: string | null
          expires_at: string
          failed_count?: number
          id: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          next_attempt_at?: string
          organization_id: string
          original_filename: string
          processed_row_count?: number
          report_deleted_at?: string | null
          report_object_path?: string | null
          retention_until: string
          retry_count?: number
          row_count?: number
          schema_version: string
          skipped_count?: number
          source_deleted_at?: string | null
          source_object_path: string
          status: string
          unchanged_count?: number
          update_count?: number
          updated_at?: string
          upload_idempotency_key: string
          upload_request_digest: string
          warning_count?: number
          work_kind?: string
        }
        Update: {
          actor_user_id?: string
          byte_size?: number
          canceled_at?: string | null
          cancellation_reason?: string | null
          checkpoint_row_number?: number
          commit_actor_user_id?: string | null
          commit_idempotency_key?: string | null
          commit_request_digest?: string | null
          committed_at?: string | null
          committed_row_count?: number
          content_hash?: string
          correlation_id?: string
          create_count?: number
          created_at?: string
          dry_run_completed_at?: string | null
          error_code?: string | null
          expires_at?: string
          failed_count?: number
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          next_attempt_at?: string
          organization_id?: string
          original_filename?: string
          processed_row_count?: number
          report_deleted_at?: string | null
          report_object_path?: string | null
          retention_until?: string
          retry_count?: number
          row_count?: number
          schema_version?: string
          skipped_count?: number
          source_deleted_at?: string | null
          source_object_path?: string
          status?: string
          unchanged_count?: number
          update_count?: number
          updated_at?: string
          upload_idempotency_key?: string
          upload_request_digest?: string
          warning_count?: number
          work_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_import_jobs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_import_jobs_commit_actor_user_id_fkey"
            columns: ["commit_actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_import_rows: {
        Row: {
          committed_at: string | null
          created_at: string
          expected_product_version: number | null
          expected_release_version: number | null
          id: string
          import_id: string
          issues: Json
          organization_id: string
          product_id: string | null
          product_internal_code: string | null
          product_internal_code_normalized: string | null
          proposed: Json
          proposed_action: string
          release_id: string | null
          release_version: string | null
          release_version_normalized: string | null
          result: string
          row_hash: string
          row_type: string | null
          source_row_number: number
          updated_at: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          expected_product_version?: number | null
          expected_release_version?: number | null
          id?: string
          import_id: string
          issues?: Json
          organization_id: string
          product_id?: string | null
          product_internal_code?: string | null
          product_internal_code_normalized?: string | null
          proposed?: Json
          proposed_action: string
          release_id?: string | null
          release_version?: string | null
          release_version_normalized?: string | null
          result: string
          row_hash: string
          row_type?: string | null
          source_row_number: number
          updated_at?: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          expected_product_version?: number | null
          expected_release_version?: number | null
          id?: string
          import_id?: string
          issues?: Json
          organization_id?: string
          product_id?: string | null
          product_internal_code?: string | null
          product_internal_code_normalized?: string | null
          proposed?: Json
          proposed_action?: string
          release_id?: string | null
          release_version?: string | null
          release_version_normalized?: string | null
          result?: string
          row_hash?: string
          row_type?: string | null
          source_row_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_import_rows_organization_id_import_id_fkey"
            columns: ["organization_id", "import_id"]
            isOneToOne: false
            referencedRelation: "product_import_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_import_rows_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_import_rows_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_import_rows_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      product_legal_entity_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          id: string
          legal_entity_id: string
          legal_entity_snapshot: Json
          legal_entity_version: number
          organization_id: string
          product_id: string
          reason: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          id?: string
          legal_entity_id: string
          legal_entity_snapshot: Json
          legal_entity_version: number
          organization_id: string
          product_id: string
          reason?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          id?: string
          legal_entity_id?: string
          legal_entity_snapshot?: Json
          legal_entity_version?: number
          organization_id?: string
          product_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_legal_entity_assignme_organization_id_legal_entity_fkey"
            columns: ["organization_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "organization_legal_entities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_legal_entity_assignment_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_legal_entity_assignment_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_legal_entity_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_lifecycle_dependency_facts: {
        Row: {
          active: boolean
          authority_kind: string
          baseline_revision_id: string | null
          export_order_key: string | null
          organization_id: string
          product_id: string | null
          reconciled_at: string
          reconciled_by: string
          record_id: string
          release_id: string | null
          subject_kind: string
        }
        Insert: {
          active?: boolean
          authority_kind: string
          baseline_revision_id?: string | null
          export_order_key?: string | null
          organization_id: string
          product_id?: string | null
          reconciled_at?: string
          reconciled_by: string
          record_id: string
          release_id?: string | null
          subject_kind?: string
        }
        Update: {
          active?: boolean
          authority_kind?: string
          baseline_revision_id?: string | null
          export_order_key?: string | null
          organization_id?: string
          product_id?: string | null
          reconciled_at?: string
          reconciled_by?: string
          record_id?: string
          release_id?: string | null
          subject_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_dependencies_release_product_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_lifecycle_dependency_fa_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_lifecycle_dependency_fa_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_lifecycle_dependency_fa_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_lifecycle_dependency_facts_baseline_fkey"
            columns: ["organization_id", "baseline_revision_id"]
            isOneToOne: false
            referencedRelation: "software_baselines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_lifecycle_dependency_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_lifecycle_dependency_facts_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_regulatory_outbox_events: {
        Row: {
          alert_threshold_days: number | null
          checkpoint_version: number
          correlation_id: string
          delivered_at: string | null
          delivered_to_user_id: string | null
          delivery_attempts: number
          delivery_cursor: string | null
          delivery_state: string
          due_at: string | null
          event_key: string
          event_type: string
          graph_version: number | null
          id: string
          last_delivery_error: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          missed: boolean
          obsolete_at: string | null
          occurred_at: string
          organization_id: string
          payload: Json
          product_id: string
          release_id: string | null
          support_period_id: string | null
          support_period_revision: number | null
        }
        Insert: {
          alert_threshold_days?: number | null
          checkpoint_version?: number
          correlation_id: string
          delivered_at?: string | null
          delivered_to_user_id?: string | null
          delivery_attempts?: number
          delivery_cursor?: string | null
          delivery_state?: string
          due_at?: string | null
          event_key: string
          event_type: string
          graph_version?: number | null
          id?: string
          last_delivery_error?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          missed?: boolean
          obsolete_at?: string | null
          occurred_at?: string
          organization_id: string
          payload: Json
          product_id: string
          release_id?: string | null
          support_period_id?: string | null
          support_period_revision?: number | null
        }
        Update: {
          alert_threshold_days?: number | null
          checkpoint_version?: number
          correlation_id?: string
          delivered_at?: string | null
          delivered_to_user_id?: string | null
          delivery_attempts?: number
          delivery_cursor?: string | null
          delivery_state?: string
          due_at?: string | null
          event_key?: string
          event_type?: string
          graph_version?: number | null
          id?: string
          last_delivery_error?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          missed?: boolean
          obsolete_at?: string | null
          occurred_at?: string
          organization_id?: string
          payload?: Json
          product_id?: string
          release_id?: string | null
          support_period_id?: string | null
          support_period_revision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_regulatory_outbox_eve_organization_id_product_id_r_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_regulatory_outbox_events_delivered_to_user_id_fkey"
            columns: ["delivered_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_regulatory_outbox_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_regulatory_outbox_support_period_fk"
            columns: ["organization_id", "support_period_id"]
            isOneToOne: false
            referencedRelation: "product_support_periods"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      product_relationships: {
        Row: {
          baseline_revision_id: string | null
          created_at: string
          created_by: string
          effective_ends_at: string | null
          effective_starts_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          graph_version: number
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          organization_id: string
          provenance: string
          quantity: number | null
          reason: string
          relationship_type: string
          source: string
          source_product_id: string | null
          source_release_id: string | null
          source_type: string | null
          superseded_by_id: string | null
          target_product_id: string
          target_release_id: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          baseline_revision_id?: string | null
          created_at?: string
          created_by: string
          effective_ends_at?: string | null
          effective_starts_at: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          graph_version: number
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id: string
          provenance: string
          quantity?: number | null
          reason: string
          relationship_type: string
          source: string
          source_product_id?: string | null
          source_release_id?: string | null
          source_type?: string | null
          superseded_by_id?: string | null
          target_product_id: string
          target_release_id?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          baseline_revision_id?: string | null
          created_at?: string
          created_by?: string
          effective_ends_at?: string | null
          effective_starts_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          graph_version?: number
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id?: string
          provenance?: string
          quantity?: number | null
          reason?: string
          relationship_type?: string
          source?: string
          source_product_id?: string | null
          source_release_id?: string | null
          source_type?: string | null
          superseded_by_id?: string | null
          target_product_id?: string
          target_release_id?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_relationships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relationships_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_baseline_revision_id_fkey"
            columns: ["organization_id", "baseline_revision_id"]
            isOneToOne: false
            referencedRelation: "software_baselines"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_source_product_id_fkey"
            columns: ["organization_id", "source_product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_source_product_id_fkey"
            columns: ["organization_id", "source_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_source_product_id_so_fkey"
            columns: [
              "organization_id",
              "source_product_id",
              "source_release_id",
            ]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_superseded_by_id_fkey"
            columns: ["organization_id", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "product_relationships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_target_product_id_fkey"
            columns: ["organization_id", "target_product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_target_product_id_fkey"
            columns: ["organization_id", "target_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_relationships_organization_id_target_product_id_ta_fkey"
            columns: [
              "organization_id",
              "target_product_id",
              "target_release_id",
            ]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_relationships_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_release_create_idempotencies: {
        Row: {
          actor_user_id: string
          created_at: string
          idempotency_key: string
          organization_id: string
          payload_digest: string
          release_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          idempotency_key: string
          organization_id: string
          payload_digest: string
          release_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          idempotency_key?: string
          organization_id?: string
          payload_digest?: string
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_release_create_idempote_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_release_create_idempotencies_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_release_create_idempotencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_release_market_availability: {
        Row: {
          available_at: string
          available_by: string
          country_code: string
          created_at: string
          id: string
          organization_id: string
          product_id: string
          reference_version_id: string
          release_id: string
          unavailable_at: string | null
          unavailable_by: string | null
          updated_at: string
        }
        Insert: {
          available_at?: string
          available_by: string
          country_code: string
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          reference_version_id: string
          release_id: string
          unavailable_at?: string | null
          unavailable_by?: string | null
          updated_at?: string
        }
        Update: {
          available_at?: string
          available_by?: string
          country_code?: string
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          reference_version_id?: string
          release_id?: string
          unavailable_at?: string | null
          unavailable_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_release_market_availa_organization_id_product_id_r_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_release_market_availa_reference_version_id_country_fkey"
            columns: ["reference_version_id", "country_code"]
            isOneToOne: false
            referencedRelation: "member_state_reference_entries"
            referencedColumns: ["reference_version_id", "country_code"]
          },
          {
            foreignKeyName: "product_release_market_availability_available_by_fkey"
            columns: ["available_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_release_market_availability_unavailable_by_fkey"
            columns: ["unavailable_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_releases: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          label: string
          legal_entity_id: string
          legal_entity_snapshot: Json
          legal_entity_version: number
          lifecycle: string
          organization_id: string
          placed_on_market_at: string | null
          product_id: string
          release_version: string
          release_version_normalized: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          label: string
          legal_entity_id: string
          legal_entity_snapshot: Json
          legal_entity_version: number
          lifecycle?: string
          organization_id: string
          placed_on_market_at?: string | null
          product_id: string
          release_version: string
          release_version_normalized?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          label?: string
          legal_entity_id?: string
          legal_entity_snapshot?: Json
          legal_entity_version?: number
          lifecycle?: string
          organization_id?: string
          placed_on_market_at?: string | null
          product_id?: string
          release_version?: string
          release_version_normalized?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_releases_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_releases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_releases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_releases_organization_id_legal_entity_id_fkey"
            columns: ["organization_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "organization_legal_entities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_releases_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_releases_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_releases_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_security_update_artifacts: {
        Row: {
          artifact_type: string
          availability_explanation: Json
          availability_rule_version: string
          availability_status: string
          availability_until: string | null
          availability_winning_rule: string | null
          byte_size: number
          cleanup_completed_at: string | null
          cleanup_completed_by: string | null
          cleanup_scheduled_at: string | null
          cleanup_scheduled_by: string | null
          computed_availability_until: string | null
          content_type: string
          created_at: string
          created_by: string
          distribution_kind: string
          distribution_reference: string | null
          file_name: string
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          integrity_status: string
          issued_at: string
          issued_candidate_at: string | null
          non_reduction_applied: boolean
          object_key: string | null
          organization_id: string
          product_id: string
          publication_status: string
          published_at: string | null
          published_by: string | null
          published_external_references: Json
          release_id: string
          replaced_at: string | null
          replaced_by: string | null
          replacement_artifact_id: string | null
          replacement_reason: string | null
          review_reason: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          sha256: string
          signature_metadata: Json
          support_candidate_at: string | null
          support_period_id: string | null
          support_period_revision: number | null
          supported_platform: string
          title: string
          update_version: string
          updated_at: string
          updated_by: string
          upload_status: string
          version: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          artifact_type: string
          availability_explanation?: Json
          availability_rule_version?: string
          availability_status?: string
          availability_until?: string | null
          availability_winning_rule?: string | null
          byte_size: number
          cleanup_completed_at?: string | null
          cleanup_completed_by?: string | null
          cleanup_scheduled_at?: string | null
          cleanup_scheduled_by?: string | null
          computed_availability_until?: string | null
          content_type: string
          created_at?: string
          created_by: string
          distribution_kind?: string
          distribution_reference?: string | null
          file_name: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          integrity_status?: string
          issued_at: string
          issued_candidate_at?: string | null
          non_reduction_applied?: boolean
          object_key?: string | null
          organization_id: string
          product_id: string
          publication_status?: string
          published_at?: string | null
          published_by?: string | null
          published_external_references?: Json
          release_id: string
          replaced_at?: string | null
          replaced_by?: string | null
          replacement_artifact_id?: string | null
          replacement_reason?: string | null
          review_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sha256: string
          signature_metadata?: Json
          support_candidate_at?: string | null
          support_period_id?: string | null
          support_period_revision?: number | null
          supported_platform: string
          title: string
          update_version: string
          updated_at?: string
          updated_by: string
          upload_status?: string
          version?: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          artifact_type?: string
          availability_explanation?: Json
          availability_rule_version?: string
          availability_status?: string
          availability_until?: string | null
          availability_winning_rule?: string | null
          byte_size?: number
          cleanup_completed_at?: string | null
          cleanup_completed_by?: string | null
          cleanup_scheduled_at?: string | null
          cleanup_scheduled_by?: string | null
          computed_availability_until?: string | null
          content_type?: string
          created_at?: string
          created_by?: string
          distribution_kind?: string
          distribution_reference?: string | null
          file_name?: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          integrity_status?: string
          issued_at?: string
          issued_candidate_at?: string | null
          non_reduction_applied?: boolean
          object_key?: string | null
          organization_id?: string
          product_id?: string
          publication_status?: string
          published_at?: string | null
          published_by?: string | null
          published_external_references?: Json
          release_id?: string
          replaced_at?: string | null
          replaced_by?: string | null
          replacement_artifact_id?: string | null
          replacement_reason?: string | null
          review_reason?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sha256?: string
          signature_metadata?: Json
          support_candidate_at?: string | null
          support_period_id?: string | null
          support_period_revision?: number | null
          supported_platform?: string
          title?: string
          update_version?: string
          updated_at?: string
          updated_by?: string
          upload_status?: string
          version?: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_security_update_artifact_product_release_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_security_update_artifact_replacement_release_fkey"
            columns: [
              "organization_id",
              "product_id",
              "release_id",
              "replacement_artifact_id",
            ]
            isOneToOne: false
            referencedRelation: "product_security_update_artifacts"
            referencedColumns: [
              "organization_id",
              "product_id",
              "release_id",
              "id",
            ]
          },
          {
            foreignKeyName: "product_security_update_artifact_support_period_fkey"
            columns: ["organization_id", "support_period_id"]
            isOneToOne: false
            referencedRelation: "product_support_periods"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_cleanup_completed_by_fkey"
            columns: ["cleanup_completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_cleanup_scheduled_by_fkey"
            columns: ["cleanup_scheduled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_security_update_artifacts_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_substantial_modification_assessments: {
        Row: {
          answers: Json
          completeness_state: string
          created_at: string
          created_by: string
          description: string | null
          detected_or_assessed_at: string | null
          determination: string | null
          evidence_references: Json
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          introduced_at: string | null
          modification_id: string
          modification_identifier: string | null
          organization_id: string
          override_reason: string | null
          policy_suggestion: string | null
          policy_version: string
          previous_state: string | null
          product_id: string
          rationale: string | null
          required_follow_up_actions: Json | null
          resulting_state: string | null
          review_rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          status: string
          superseded_at: string | null
          superseded_by_id: string | null
          supersedes_id: string | null
          technical_scope: string | null
          title: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          answers?: Json
          completeness_state?: string
          created_at?: string
          created_by: string
          description?: string | null
          detected_or_assessed_at?: string | null
          determination?: string | null
          evidence_references?: Json
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          introduced_at?: string | null
          modification_id: string
          modification_identifier?: string | null
          organization_id: string
          override_reason?: string | null
          policy_suggestion?: string | null
          policy_version?: string
          previous_state?: string | null
          product_id: string
          rationale?: string | null
          required_follow_up_actions?: Json | null
          resulting_state?: string | null
          review_rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision: number
          status?: string
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          technical_scope?: string | null
          title?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          answers?: Json
          completeness_state?: string
          created_at?: string
          created_by?: string
          description?: string | null
          detected_or_assessed_at?: string | null
          determination?: string | null
          evidence_references?: Json
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          introduced_at?: string | null
          modification_id?: string
          modification_identifier?: string | null
          organization_id?: string
          override_reason?: string | null
          policy_suggestion?: string | null
          policy_version?: string
          previous_state?: string | null
          product_id?: string
          rationale?: string | null
          required_follow_up_actions?: Json | null
          resulting_state?: string | null
          review_rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          status?: string
          superseded_at?: string | null
          superseded_by_id?: string | null
          supersedes_id?: string | null
          technical_scope?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_substantial_modification_assessmen_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessment_product_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessment_product_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessment_superseded_by_fkey"
            columns: ["organization_id", "product_id", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "product_substantial_modification_assessments"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessment_supersedes_fkey"
            columns: ["organization_id", "product_id", "supersedes_id"]
            isOneToOne: false
            referencedRelation: "product_substantial_modification_assessments"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_substantial_modification_assessments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_substantial_modification_releases: {
        Row: {
          assessment_id: string
          created_at: string
          created_by: string
          organization_id: string
          product_id: string
          release_id: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          created_by: string
          organization_id: string
          product_id: string
          release_id: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          created_by?: string
          organization_id?: string
          product_id?: string
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_substantial_modification_release_assessment_product_fke"
            columns: ["organization_id", "product_id", "assessment_id"]
            isOneToOne: false
            referencedRelation: "product_substantial_modification_assessments"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_substantial_modification_release_product_release_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_substantial_modification_releases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_substantial_modification_releases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_support_periods: {
        Row: {
          created_at: string
          created_by: string
          decision_actor_id: string
          effective_at: string
          expected_lifetime_justification: string
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          organization_id: string
          product_id: string
          release_id: string | null
          scope_revision: number
          superseded_at: string | null
          superseded_by_id: string | null
          support_ends_at: string
          support_starts_at: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          decision_actor_id: string
          effective_at?: string
          expected_lifetime_justification: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id: string
          product_id: string
          release_id?: string | null
          scope_revision: number
          superseded_at?: string | null
          superseded_by_id?: string | null
          support_ends_at: string
          support_starts_at: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          decision_actor_id?: string
          effective_at?: string
          expected_lifetime_justification?: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id?: string
          product_id?: string
          release_id?: string | null
          scope_revision?: number
          superseded_at?: string | null
          superseded_by_id?: string | null
          support_ends_at?: string
          support_starts_at?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_support_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_support_periods_decision_actor_id_fkey"
            columns: ["decision_actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_support_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_support_periods_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_retention_alert_operations"
            referencedColumns: ["organization_id", "product_id"]
          },
          {
            foreignKeyName: "product_support_periods_organization_id_product_id_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_support_periods_organization_id_product_id_release_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "product_support_periods_organization_id_superseded_by_id_fkey"
            columns: ["organization_id", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "product_support_periods"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "product_support_periods_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          internal_code: string
          internal_code_normalized: string | null
          legal_entity_id: string
          legal_entity_snapshot: Json
          legal_entity_version: number
          name: string
          organization_id: string
          product_type: string
          responsible_owner_id: string
          retention_protection_until: string | null
          retention_recalculated_at: string | null
          retention_recalculated_by: string | null
          retention_rule_version: string | null
          retention_status: string
          retention_until: string | null
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          internal_code: string
          internal_code_normalized?: string | null
          legal_entity_id: string
          legal_entity_snapshot: Json
          legal_entity_version: number
          name: string
          organization_id: string
          product_type: string
          responsible_owner_id: string
          retention_protection_until?: string | null
          retention_recalculated_at?: string | null
          retention_recalculated_by?: string | null
          retention_rule_version?: string | null
          retention_status?: string
          retention_until?: string | null
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          internal_code?: string
          internal_code_normalized?: string | null
          legal_entity_id?: string
          legal_entity_snapshot?: Json
          legal_entity_version?: number
          name?: string
          organization_id?: string
          product_type?: string
          responsible_owner_id?: string
          retention_protection_until?: string | null
          retention_recalculated_at?: string | null
          retention_recalculated_by?: string | null
          retention_rule_version?: string | null
          retention_status?: string
          retention_until?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_legal_entity_id_fkey"
            columns: ["organization_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "organization_legal_entities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "products_responsible_owner_id_fkey"
            columns: ["responsible_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_retention_recalculated_by_fkey"
            columns: ["retention_recalculated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      sbom_ci_credentials: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          last_used_at: string | null
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          token_hash: string
          token_prefix: string
          token_salt: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id: string
          label: string
          last_used_at?: string | null
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token_hash: string
          token_prefix: string
          token_salt: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          last_used_at?: string | null
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token_hash?: string
          token_prefix?: string
          token_salt?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_ci_credentials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_ci_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_ci_credentials_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_component_dependencies: {
        Row: {
          child_component_id: string | null
          child_reference: string
          created_at: string
          document_id: string
          edge_state: string
          id: string
          omission_code: string | null
          omission_message: string | null
          organization_id: string
          parent_component_id: string | null
          parent_reference: string
          source_byte_end: number
          source_line: number | null
          source_offset: number
          source_path: string
          updated_at: string
        }
        Insert: {
          child_component_id?: string | null
          child_reference: string
          created_at?: string
          document_id: string
          edge_state?: string
          id?: string
          omission_code?: string | null
          omission_message?: string | null
          organization_id: string
          parent_component_id?: string | null
          parent_reference: string
          source_byte_end: number
          source_line?: number | null
          source_offset: number
          source_path: string
          updated_at?: string
        }
        Update: {
          child_component_id?: string | null
          child_reference?: string
          created_at?: string
          document_id?: string
          edge_state?: string
          id?: string
          omission_code?: string | null
          omission_message?: string | null
          organization_id?: string
          parent_component_id?: string | null
          parent_reference?: string
          source_byte_end?: number
          source_line?: number | null
          source_offset?: number
          source_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_component_dependencies_child_fkey"
            columns: ["organization_id", "document_id", "child_component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "document_id", "id"]
          },
          {
            foreignKeyName: "sbom_component_dependencies_document_fkey"
            columns: ["organization_id", "document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_component_dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_component_dependencies_parent_fkey"
            columns: ["organization_id", "document_id", "parent_component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "document_id", "id"]
          },
        ]
      }
      sbom_component_identities: {
        Row: {
          canonical_value: string | null
          component_id: string
          created_at: string
          document_id: string
          id: string
          identity_type: string
          organization_id: string
          original_value: string
          updated_at: string
        }
        Insert: {
          canonical_value?: string | null
          component_id: string
          created_at?: string
          document_id: string
          id?: string
          identity_type: string
          organization_id: string
          original_value: string
          updated_at?: string
        }
        Update: {
          canonical_value?: string | null
          component_id?: string
          created_at?: string
          document_id?: string
          id?: string
          identity_type?: string
          organization_id?: string
          original_value?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_component_identities_component_fkey"
            columns: ["organization_id", "document_id", "component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "document_id", "id"]
          },
          {
            foreignKeyName: "sbom_component_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_components: {
        Row: {
          canonical_parent_component_id: string | null
          canonical_purl: string | null
          cpe: string | null
          created_at: string
          depth: number
          document_id: string
          document_local_ref: string
          ecosystem: string | null
          hashes: Json
          id: string
          license_expression: string | null
          license_values: Json
          normalized_name: string
          normalized_version: string | null
          organization_id: string
          original_name: string
          original_purl: string | null
          original_version: string | null
          scope: string | null
          source_byte_end: number
          source_line: number | null
          source_offset: number
          source_path: string
          supplier: string | null
          supplier_values: Json
          updated_at: string
        }
        Insert: {
          canonical_parent_component_id?: string | null
          canonical_purl?: string | null
          cpe?: string | null
          created_at?: string
          depth?: number
          document_id: string
          document_local_ref: string
          ecosystem?: string | null
          hashes?: Json
          id?: string
          license_expression?: string | null
          license_values?: Json
          normalized_name: string
          normalized_version?: string | null
          organization_id: string
          original_name: string
          original_purl?: string | null
          original_version?: string | null
          scope?: string | null
          source_byte_end: number
          source_line?: number | null
          source_offset: number
          source_path: string
          supplier?: string | null
          supplier_values?: Json
          updated_at?: string
        }
        Update: {
          canonical_parent_component_id?: string | null
          canonical_purl?: string | null
          cpe?: string | null
          created_at?: string
          depth?: number
          document_id?: string
          document_local_ref?: string
          ecosystem?: string | null
          hashes?: Json
          id?: string
          license_expression?: string | null
          license_values?: Json
          normalized_name?: string
          normalized_version?: string | null
          organization_id?: string
          original_name?: string
          original_purl?: string | null
          original_version?: string | null
          scope?: string | null
          source_byte_end?: number
          source_line?: number | null
          source_offset?: number
          source_path?: string
          supplier?: string | null
          supplier_values?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_components_document_fkey"
            columns: ["organization_id", "document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_components_parent_fkey"
            columns: [
              "organization_id",
              "document_id",
              "canonical_parent_component_id",
            ]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "document_id", "id"]
          },
        ]
      }
      sbom_composite_component_provenance: {
        Row: {
          composite_component_ref: string
          created_at: string
          field_name: string | null
          id: string
          merge_timestamp: string
          organization_id: string
          review_conflict_id: string | null
          review_id: string
          source_component_id: string | null
          source_component_ref: string | null
          source_document_id: string
          source_id: string
          supplier_submission_id: string | null
        }
        Insert: {
          composite_component_ref: string
          created_at?: string
          field_name?: string | null
          id?: string
          merge_timestamp?: string
          organization_id: string
          review_conflict_id?: string | null
          review_id: string
          source_component_id?: string | null
          source_component_ref?: string | null
          source_document_id: string
          source_id: string
          supplier_submission_id?: string | null
        }
        Update: {
          composite_component_ref?: string
          created_at?: string
          field_name?: string | null
          id?: string
          merge_timestamp?: string
          organization_id?: string
          review_conflict_id?: string | null
          review_id?: string
          source_component_id?: string | null
          source_component_ref?: string | null
          source_document_id?: string
          source_id?: string
          supplier_submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sbom_composite_component_prov_organization_id_review_confl_fkey"
            columns: ["organization_id", "review_conflict_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_conflicts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_component_prov_organization_id_source_compo_fkey"
            columns: ["organization_id", "source_component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_component_prov_organization_id_source_docum_fkey"
            columns: ["organization_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_component_prov_organization_id_supplier_sub_fkey"
            columns: ["organization_id", "supplier_submission_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_submissions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_component_provena_organization_id_review_id_fkey"
            columns: ["organization_id", "review_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_reviews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_component_provena_organization_id_source_id_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_component_provenance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_composite_conflicts: {
        Row: {
          candidates: Json
          conflict_type: string
          created_at: string
          field_name: string | null
          id: string
          identity_key: string
          organization_id: string
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_id: string
          selected_source_component_id: string | null
          updated_at: string
        }
        Insert: {
          candidates: Json
          conflict_type: string
          created_at?: string
          field_name?: string | null
          id?: string
          identity_key: string
          organization_id: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id: string
          selected_source_component_id?: string | null
          updated_at?: string
        }
        Update: {
          candidates?: Json
          conflict_type?: string
          created_at?: string
          field_name?: string | null
          id?: string
          identity_key?: string
          organization_id?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string
          selected_source_component_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_composite_conflicts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_composite_conflicts_organization_id_review_id_fkey"
            columns: ["organization_id", "review_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_reviews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_conflicts_organization_id_selected_source_c_fkey"
            columns: ["organization_id", "selected_source_component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_composite_dependency_provenance: {
        Row: {
          composite_child_ref: string
          composite_parent_ref: string
          created_at: string
          id: string
          merge_timestamp: string
          organization_id: string
          review_id: string
          review_relationship_id: string | null
          source_dependency_id: string
          source_document_id: string
          source_id: string
          supplier_submission_id: string | null
        }
        Insert: {
          composite_child_ref: string
          composite_parent_ref: string
          created_at?: string
          id?: string
          merge_timestamp?: string
          organization_id: string
          review_id: string
          review_relationship_id?: string | null
          source_dependency_id: string
          source_document_id: string
          source_id: string
          supplier_submission_id?: string | null
        }
        Update: {
          composite_child_ref?: string
          composite_parent_ref?: string
          created_at?: string
          id?: string
          merge_timestamp?: string
          organization_id?: string
          review_id?: string
          review_relationship_id?: string | null
          source_dependency_id?: string
          source_document_id?: string
          source_id?: string
          supplier_submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sbom_composite_dependency_pro_organization_id_review_relat_fkey"
            columns: ["organization_id", "review_relationship_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_unresolved_relationships"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_dependency_pro_organization_id_source_depen_fkey"
            columns: ["organization_id", "source_dependency_id"]
            isOneToOne: false
            referencedRelation: "sbom_component_dependencies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_dependency_pro_organization_id_source_docum_fkey"
            columns: ["organization_id", "source_document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_dependency_pro_organization_id_supplier_sub_fkey"
            columns: ["organization_id", "supplier_submission_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_submissions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_dependency_proven_organization_id_review_id_fkey"
            columns: ["organization_id", "review_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_reviews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_dependency_proven_organization_id_source_id_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_dependency_provenance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_composite_review_inputs: {
        Row: {
          created_at: string
          document_id: string
          id: string
          organization_id: string
          release_id: string
          review_id: string
          source_id: string
          source_sha256: string
          supplier_submission_id: string | null
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          organization_id: string
          release_id: string
          review_id: string
          source_id: string
          source_sha256: string
          supplier_submission_id?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          organization_id?: string
          release_id?: string
          review_id?: string
          source_id?: string
          source_sha256?: string
          supplier_submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sbom_composite_review_inputs_organization_id_document_id_s_fkey"
            columns: ["organization_id", "document_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_document_sources"
            referencedColumns: ["organization_id", "document_id", "source_id"]
          },
          {
            foreignKeyName: "sbom_composite_review_inputs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_composite_review_inputs_organization_id_review_id_fkey"
            columns: ["organization_id", "review_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_reviews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_review_inputs_organization_id_source_id_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_review_inputs_organization_id_supplier_subm_fkey"
            columns: ["organization_id", "supplier_submission_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_submissions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_composite_reviews: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          created_by: string
          failure_code: string | null
          failure_message: string | null
          generated_at: string | null
          generated_document_id: string | null
          generated_source_id: string | null
          id: string
          input_set_digest: string
          lease_expires_at: string | null
          lease_owner: string | null
          merge_rules_version: string
          organization_id: string
          product_id: string
          provenance_manifest_sha256: string | null
          release_id: string
          resolution_digest: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          created_by: string
          failure_code?: string | null
          failure_message?: string | null
          generated_at?: string | null
          generated_document_id?: string | null
          generated_source_id?: string | null
          id: string
          input_set_digest: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          merge_rules_version: string
          organization_id: string
          product_id: string
          provenance_manifest_sha256?: string | null
          release_id: string
          resolution_digest?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string
          failure_code?: string | null
          failure_message?: string | null
          generated_at?: string | null
          generated_document_id?: string | null
          generated_source_id?: string | null
          id?: string
          input_set_digest?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          merge_rules_version?: string
          organization_id?: string
          product_id?: string
          provenance_manifest_sha256?: string | null
          release_id?: string
          resolution_digest?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_composite_reviews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_composite_reviews_lease_owner_fkey"
            columns: ["lease_owner"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_composite_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_composite_reviews_organization_id_generated_document__fkey"
            columns: ["organization_id", "generated_document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_reviews_organization_id_generated_source_id_fkey"
            columns: ["organization_id", "generated_source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_reviews_organization_id_product_id_release__fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
        ]
      }
      sbom_composite_unresolved_relationships: {
        Row: {
          created_at: string
          detail: Json
          disposition: string | null
          id: string
          organization_id: string
          relationship_key: string
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_id: string
          source_dependency_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          detail: Json
          disposition?: string | null
          id?: string
          organization_id: string
          relationship_key: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id: string
          source_dependency_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          disposition?: string | null
          id?: string
          organization_id?: string
          relationship_key?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string
          source_dependency_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_composite_unresolved_rel_organization_id_source_depen_fkey"
            columns: ["organization_id", "source_dependency_id"]
            isOneToOne: false
            referencedRelation: "sbom_component_dependencies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_unresolved_relati_organization_id_review_id_fkey"
            columns: ["organization_id", "review_id"]
            isOneToOne: false
            referencedRelation: "sbom_composite_reviews"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_composite_unresolved_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_composite_unresolved_relationships_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_diff_component_changes: {
        Row: {
          baseline_component_id: string | null
          baseline_version: string | null
          canonical_package_identity: string | null
          change_key: string
          change_type: string
          created_at: string
          current_component_id: string | null
          current_version: string | null
          ecosystem: string | null
          explanation: string
          id: string
          organization_id: string
          report_id: string
          updated_at: string
        }
        Insert: {
          baseline_component_id?: string | null
          baseline_version?: string | null
          canonical_package_identity?: string | null
          change_key: string
          change_type: string
          created_at?: string
          current_component_id?: string | null
          current_version?: string | null
          ecosystem?: string | null
          explanation: string
          id?: string
          organization_id: string
          report_id: string
          updated_at?: string
        }
        Update: {
          baseline_component_id?: string | null
          baseline_version?: string | null
          canonical_package_identity?: string | null
          change_key?: string
          change_type?: string
          created_at?: string
          current_component_id?: string | null
          current_version?: string | null
          ecosystem?: string | null
          explanation?: string
          id?: string
          organization_id?: string
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_diff_component_changes_organization_id_baseline_compo_fkey"
            columns: ["organization_id", "baseline_component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_diff_component_changes_organization_id_current_compon_fkey"
            columns: ["organization_id", "current_component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_diff_component_changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_diff_component_changes_organization_id_report_id_fkey"
            columns: ["organization_id", "report_id"]
            isOneToOne: false
            referencedRelation: "sbom_diff_reports"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_diff_reports: {
        Row: {
          attempt_count: number
          baseline_document_id: string
          baseline_source_id: string
          checkpoint: Json
          comparator_version: string
          completed_at: string | null
          created_at: string
          document_id: string
          error_code: string | null
          error_message: string | null
          finding_delta_state: string
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          next_attempt_at: string
          organization_id: string
          progress_change_count: number
          progress_percent: number
          progress_stage: string
          release_id: string
          source_id: string
          state: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          baseline_document_id: string
          baseline_source_id: string
          checkpoint?: Json
          comparator_version?: string
          completed_at?: string | null
          created_at?: string
          document_id: string
          error_code?: string | null
          error_message?: string | null
          finding_delta_state?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          organization_id: string
          progress_change_count?: number
          progress_percent?: number
          progress_stage?: string
          release_id: string
          source_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          baseline_document_id?: string
          baseline_source_id?: string
          checkpoint?: Json
          comparator_version?: string
          completed_at?: string | null
          created_at?: string
          document_id?: string
          error_code?: string | null
          error_message?: string | null
          finding_delta_state?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          organization_id?: string
          progress_change_count?: number
          progress_percent?: number
          progress_stage?: string
          release_id?: string
          source_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_diff_reports_organization_id_baseline_document_id_bas_fkey"
            columns: [
              "organization_id",
              "baseline_document_id",
              "baseline_source_id",
            ]
            isOneToOne: false
            referencedRelation: "sbom_document_sources"
            referencedColumns: ["organization_id", "document_id", "source_id"]
          },
          {
            foreignKeyName: "sbom_diff_reports_organization_id_baseline_source_id_fkey"
            columns: ["organization_id", "baseline_source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_diff_reports_organization_id_document_id_source_id_fkey"
            columns: ["organization_id", "document_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_document_sources"
            referencedColumns: ["organization_id", "document_id", "source_id"]
          },
          {
            foreignKeyName: "sbom_diff_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_diff_reports_organization_id_source_id_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_document_sources: {
        Row: {
          created_at: string
          document_id: string
          id: string
          organization_id: string
          raw_object_id: string
          release_id: string
          source_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          organization_id: string
          raw_object_id: string
          release_id: string
          source_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          organization_id?: string
          raw_object_id?: string
          release_id?: string
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_document_sources_document_fkey"
            columns: ["organization_id", "document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_document_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_document_sources_raw_object_fkey"
            columns: ["organization_id", "raw_object_id"]
            isOneToOne: false
            referencedRelation: "sbom_raw_objects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_document_sources_source_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_documents: {
        Row: {
          checkpoint_batch: number
          checkpoint_source_offset: number
          completed_at: string | null
          component_count: number
          created_at: string
          dependency_count: number
          diagnostics: Json
          document_sha256: string
          error_code: string | null
          error_message: string | null
          format: string
          id: string
          ingest_job_id: string
          maximum_depth: number
          normalizer_name: string
          normalizer_version: string
          omitted_diagnostic_count: number
          organization_id: string
          parser_name: string
          parser_version: string
          progress_component_count: number
          progress_dependency_count: number
          progress_stage: string
          raw_object_id: string
          serialization: string
          source_id: string
          specification_version: string
          state: string
          updated_at: string
          validation_status: string
          warning_count: number
        }
        Insert: {
          checkpoint_batch?: number
          checkpoint_source_offset?: number
          completed_at?: string | null
          component_count?: number
          created_at?: string
          dependency_count?: number
          diagnostics?: Json
          document_sha256: string
          error_code?: string | null
          error_message?: string | null
          format: string
          id?: string
          ingest_job_id: string
          maximum_depth?: number
          normalizer_name: string
          normalizer_version: string
          omitted_diagnostic_count?: number
          organization_id: string
          parser_name: string
          parser_version: string
          progress_component_count?: number
          progress_dependency_count?: number
          progress_stage?: string
          raw_object_id: string
          serialization: string
          source_id: string
          specification_version: string
          state?: string
          updated_at?: string
          validation_status: string
          warning_count?: number
        }
        Update: {
          checkpoint_batch?: number
          checkpoint_source_offset?: number
          completed_at?: string | null
          component_count?: number
          created_at?: string
          dependency_count?: number
          diagnostics?: Json
          document_sha256?: string
          error_code?: string | null
          error_message?: string | null
          format?: string
          id?: string
          ingest_job_id?: string
          maximum_depth?: number
          normalizer_name?: string
          normalizer_version?: string
          omitted_diagnostic_count?: number
          organization_id?: string
          parser_name?: string
          parser_version?: string
          progress_component_count?: number
          progress_dependency_count?: number
          progress_stage?: string
          raw_object_id?: string
          serialization?: string
          source_id?: string
          specification_version?: string
          state?: string
          updated_at?: string
          validation_status?: string
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sbom_documents_job_fkey"
            columns: ["organization_id", "ingest_job_id"]
            isOneToOne: false
            referencedRelation: "sbom_ingest_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_documents_raw_object_fkey"
            columns: ["organization_id", "raw_object_id"]
            isOneToOne: false
            referencedRelation: "sbom_raw_objects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_documents_source_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_ingest_jobs: {
        Row: {
          actor_credential_id: string | null
          actor_user_id: string | null
          attempt_count: number
          completed_at: string | null
          correlation_id: string
          created_at: string
          dead_lettered_at: string | null
          detected_format: string | null
          detected_serialization: string | null
          detected_spec_version: string | null
          error_code: string | null
          id: string
          idempotency_key: string
          input_sha256: string
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          next_attempt_at: string
          organization_id: string
          progress_percent: number
          progress_stage: string
          release_id: string
          replay_idempotency_key: string | null
          replayed_at: string | null
          replayed_by: string | null
          source_id: string
          status: string
          updated_at: string
          validation_completed_at: string | null
          validation_report: Json | null
          validation_status: string
          validator_name: string | null
          validator_schema_asset_sha256: string | null
          validator_version: string | null
        }
        Insert: {
          actor_credential_id?: string | null
          actor_user_id?: string | null
          attempt_count?: number
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          dead_lettered_at?: string | null
          detected_format?: string | null
          detected_serialization?: string | null
          detected_spec_version?: string | null
          error_code?: string | null
          id?: string
          idempotency_key: string
          input_sha256: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          organization_id: string
          progress_percent?: number
          progress_stage?: string
          release_id: string
          replay_idempotency_key?: string | null
          replayed_at?: string | null
          replayed_by?: string | null
          source_id: string
          status?: string
          updated_at?: string
          validation_completed_at?: string | null
          validation_report?: Json | null
          validation_status?: string
          validator_name?: string | null
          validator_schema_asset_sha256?: string | null
          validator_version?: string | null
        }
        Update: {
          actor_credential_id?: string | null
          actor_user_id?: string | null
          attempt_count?: number
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          dead_lettered_at?: string | null
          detected_format?: string | null
          detected_serialization?: string | null
          detected_spec_version?: string | null
          error_code?: string | null
          id?: string
          idempotency_key?: string
          input_sha256?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          organization_id?: string
          progress_percent?: number
          progress_stage?: string
          release_id?: string
          replay_idempotency_key?: string | null
          replayed_at?: string | null
          replayed_by?: string | null
          source_id?: string
          status?: string
          updated_at?: string
          validation_completed_at?: string | null
          validation_report?: Json | null
          validation_status?: string
          validator_name?: string | null
          validator_schema_asset_sha256?: string | null
          validator_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sbom_ingest_jobs_actor_credential_fkey"
            columns: ["organization_id", "actor_credential_id"]
            isOneToOne: false
            referencedRelation: "sbom_ci_credentials"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_ingest_jobs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_ingest_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_ingest_jobs_replayed_by_fkey"
            columns: ["replayed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_ingest_jobs_source_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: true
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_quality_findings: {
        Row: {
          actual_condition: string | null
          category: string
          code: string
          component_id: string | null
          created_at: string
          dimension: string | null
          document_id: string
          expected_condition: string | null
          finding_key: string
          id: string
          organization_id: string
          remediation: string
          report_id: string
          rule_id: string | null
          severity: string
          source_offset: number | null
          source_path: string | null
          updated_at: string
        }
        Insert: {
          actual_condition?: string | null
          category: string
          code: string
          component_id?: string | null
          created_at?: string
          dimension?: string | null
          document_id: string
          expected_condition?: string | null
          finding_key: string
          id?: string
          organization_id: string
          remediation: string
          report_id: string
          rule_id?: string | null
          severity: string
          source_offset?: number | null
          source_path?: string | null
          updated_at?: string
        }
        Update: {
          actual_condition?: string | null
          category?: string
          code?: string
          component_id?: string | null
          created_at?: string
          dimension?: string | null
          document_id?: string
          expected_condition?: string | null
          finding_key?: string
          id?: string
          organization_id?: string
          remediation?: string
          report_id?: string
          rule_id?: string | null
          severity?: string
          source_offset?: number | null
          source_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_quality_findings_component_fkey"
            columns: ["organization_id", "document_id", "component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "document_id", "id"]
          },
          {
            foreignKeyName: "sbom_quality_findings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_quality_findings_report_fkey"
            columns: ["organization_id", "report_id"]
            isOneToOne: false
            referencedRelation: "sbom_quality_reports"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_quality_reports: {
        Row: {
          attempt_count: number
          baseline: Json | null
          baseline_report_id: string | null
          bsi_ruleset_version: string
          completed_at: string | null
          config_version: number
          created_at: string
          dimension_scores: Json | null
          document_id: string
          error_code: string | null
          error_message: string | null
          formula_version: string
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          next_attempt_at: string
          organization_id: string
          profile_enabled: boolean
          profile_summary: Json | null
          progress_finding_count: number
          progress_message: string
          progress_percent: number
          progress_stage: string
          quality_status: string | null
          raw_inputs: Json | null
          regression_state: string
          regression_summary: Json | null
          release_id: string
          source_id: string
          state: string
          total_score: number | null
          updated_at: string
          weights: Json | null
        }
        Insert: {
          attempt_count?: number
          baseline?: Json | null
          baseline_report_id?: string | null
          bsi_ruleset_version: string
          completed_at?: string | null
          config_version: number
          created_at?: string
          dimension_scores?: Json | null
          document_id: string
          error_code?: string | null
          error_message?: string | null
          formula_version: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          organization_id: string
          profile_enabled: boolean
          profile_summary?: Json | null
          progress_finding_count?: number
          progress_message?: string
          progress_percent?: number
          progress_stage?: string
          quality_status?: string | null
          raw_inputs?: Json | null
          regression_state?: string
          regression_summary?: Json | null
          release_id: string
          source_id: string
          state?: string
          total_score?: number | null
          updated_at?: string
          weights?: Json | null
        }
        Update: {
          attempt_count?: number
          baseline?: Json | null
          baseline_report_id?: string | null
          bsi_ruleset_version?: string
          completed_at?: string | null
          config_version?: number
          created_at?: string
          dimension_scores?: Json | null
          document_id?: string
          error_code?: string | null
          error_message?: string | null
          formula_version?: string
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          organization_id?: string
          profile_enabled?: boolean
          profile_summary?: Json | null
          progress_finding_count?: number
          progress_message?: string
          progress_percent?: number
          progress_stage?: string
          quality_status?: string | null
          raw_inputs?: Json | null
          regression_state?: string
          regression_summary?: Json | null
          release_id?: string
          source_id?: string
          state?: string
          total_score?: number | null
          updated_at?: string
          weights?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sbom_quality_reports_baseline_fkey"
            columns: ["organization_id", "baseline_report_id"]
            isOneToOne: false
            referencedRelation: "sbom_quality_reports"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_quality_reports_document_source_fkey"
            columns: ["organization_id", "document_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_document_sources"
            referencedColumns: ["organization_id", "document_id", "source_id"]
          },
          {
            foreignKeyName: "sbom_quality_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_quality_reports_source_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_raw_objects: {
        Row: {
          byte_size: number
          created_at: string
          id: string
          media_type: string
          organization_id: string
          sha256: string
          storage_bucket: string
          storage_key: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          id?: string
          media_type: string
          organization_id: string
          sha256: string
          storage_bucket?: string
          storage_key: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          id?: string
          media_type?: string
          organization_id?: string
          sha256?: string
          storage_bucket?: string
          storage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_raw_objects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sbom_sources: {
        Row: {
          actor_credential_id: string | null
          actor_user_id: string | null
          correlation_id: string
          created_at: string
          declared_byte_size: number
          declared_format: string | null
          declared_media_type: string
          declared_sha256: string
          declared_spec_version: string | null
          deduplicated_from_source_id: string | null
          id: string
          idempotency_key: string
          organization_id: string
          original_filename: string
          product_id: string
          raw_object_id: string | null
          rejected_at: string | null
          rejection_code: string | null
          release_id: string
          request_digest: string
          source_kind: string
          staging_storage_key: string
          status: string
          supersedes_source_id: string | null
          upload_expires_at: string
          verified_at: string | null
        }
        Insert: {
          actor_credential_id?: string | null
          actor_user_id?: string | null
          correlation_id: string
          created_at?: string
          declared_byte_size: number
          declared_format?: string | null
          declared_media_type: string
          declared_sha256: string
          declared_spec_version?: string | null
          deduplicated_from_source_id?: string | null
          id: string
          idempotency_key: string
          organization_id: string
          original_filename: string
          product_id: string
          raw_object_id?: string | null
          rejected_at?: string | null
          rejection_code?: string | null
          release_id: string
          request_digest: string
          source_kind: string
          staging_storage_key: string
          status?: string
          supersedes_source_id?: string | null
          upload_expires_at: string
          verified_at?: string | null
        }
        Update: {
          actor_credential_id?: string | null
          actor_user_id?: string | null
          correlation_id?: string
          created_at?: string
          declared_byte_size?: number
          declared_format?: string | null
          declared_media_type?: string
          declared_sha256?: string
          declared_spec_version?: string | null
          deduplicated_from_source_id?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          original_filename?: string
          product_id?: string
          raw_object_id?: string | null
          rejected_at?: string | null
          rejection_code?: string | null
          release_id?: string
          request_digest?: string
          source_kind?: string
          staging_storage_key?: string
          status?: string
          supersedes_source_id?: string | null
          upload_expires_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sbom_sources_actor_credential_fkey"
            columns: ["organization_id", "actor_credential_id"]
            isOneToOne: false
            referencedRelation: "sbom_ci_credentials"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_sources_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_sources_deduplicated_same_release_fkey"
            columns: [
              "organization_id",
              "release_id",
              "deduplicated_from_source_id",
            ]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "release_id", "id"]
          },
          {
            foreignKeyName: "sbom_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_sources_raw_object_fkey"
            columns: ["organization_id", "raw_object_id"]
            isOneToOne: false
            referencedRelation: "sbom_raw_objects"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_sources_release_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "sbom_sources_supersedes_same_release_fkey"
            columns: ["organization_id", "release_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "release_id", "id"]
          },
        ]
      }
      sbom_supplier_invitations: {
        Row: {
          consumed_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_digest: string
          request_id: string
          revoked_at: string | null
          session_expires_at: string | null
          session_token_hash: string | null
          status: string
          token_hash: string
          token_prefix: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_digest: string
          request_id: string
          revoked_at?: string | null
          session_expires_at?: string | null
          session_token_hash?: string | null
          status?: string
          token_hash: string
          token_prefix: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_digest?: string
          request_id?: string
          revoked_at?: string | null
          session_expires_at?: string | null
          session_token_hash?: string | null
          status?: string
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_supplier_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_supplier_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_supplier_invitations_organization_id_request_id_fkey"
            columns: ["organization_id", "request_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_requests"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sbom_supplier_requests: {
        Row: {
          allowed_component_ref: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          product_id: string
          release_id: string
          request_digest: string
          status: string
          supplier_display_name: string
          updated_at: string
        }
        Insert: {
          allowed_component_ref: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          product_id: string
          release_id: string
          request_digest: string
          status?: string
          supplier_display_name: string
          updated_at?: string
        }
        Update: {
          allowed_component_ref?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          product_id?: string
          release_id?: string
          request_digest?: string
          status?: string
          supplier_display_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_supplier_requests_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_supplier_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_supplier_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_supplier_requests_organization_id_product_id_release__fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
        ]
      }
      sbom_supplier_submissions: {
        Row: {
          created_at: string
          decision_reason: string | null
          id: string
          idempotency_key: string
          invitation_id: string
          organization_id: string
          request_digest: string
          request_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string
          status: string
          superseded_by_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision_reason?: string | null
          id: string
          idempotency_key: string
          invitation_id: string
          organization_id: string
          request_digest: string
          request_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id: string
          status?: string
          superseded_by_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision_reason?: string | null
          id?: string
          idempotency_key?: string
          invitation_id?: string
          organization_id?: string
          request_digest?: string
          request_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string
          status?: string
          superseded_by_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sbom_supplier_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sbom_supplier_submissions_organization_id_invitation_id_fkey"
            columns: ["organization_id", "invitation_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_invitations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_supplier_submissions_organization_id_request_id_fkey"
            columns: ["organization_id", "request_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_requests"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_supplier_submissions_organization_id_source_id_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: true
            referencedRelation: "sbom_sources"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_supplier_submissions_organization_id_superseded_by_id_fkey"
            columns: ["organization_id", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "sbom_supplier_submissions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sbom_supplier_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      software_baseline_release_memberships: {
        Row: {
          assigned_at: string
          assigned_by: string
          baseline_id: string
          baseline_revision_id: string
          created_at: string
          effective_ends_at: string | null
          effective_starts_at: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          organization_id: string
          product_id: string
          provenance: string
          release_id: string
          source: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          baseline_id: string
          baseline_revision_id: string
          created_at?: string
          effective_ends_at?: string | null
          effective_starts_at: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id: string
          product_id: string
          provenance: string
          release_id: string
          source: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          baseline_id?: string
          baseline_revision_id?: string
          created_at?: string
          effective_ends_at?: string | null
          effective_starts_at?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          organization_id?: string
          product_id?: string
          provenance?: string
          release_id?: string
          source?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "software_baseline_release_mem_organization_id_baseline_rev_fkey"
            columns: ["organization_id", "baseline_revision_id", "baseline_id"]
            isOneToOne: false
            referencedRelation: "software_baselines"
            referencedColumns: ["organization_id", "id", "baseline_id"]
          },
          {
            foreignKeyName: "software_baseline_release_mem_organization_id_product_id_r_fkey"
            columns: ["organization_id", "product_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "product_id", "id"]
          },
          {
            foreignKeyName: "software_baseline_release_memberships_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "software_baseline_release_memberships_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "software_baseline_release_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "software_baseline_release_memberships_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      software_baselines: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          baseline_id: string
          created_at: string
          created_by: string
          description: string | null
          effective_ends_at: string | null
          effective_starts_at: string
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          identifier: string
          identifier_normalized: string | null
          is_current: boolean
          name: string
          organization_id: string
          provenance: string
          revision_number: number
          revision_summary: string
          source: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          baseline_id: string
          created_at?: string
          created_by: string
          description?: string | null
          effective_ends_at?: string | null
          effective_starts_at: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          identifier: string
          identifier_normalized?: string | null
          is_current?: boolean
          name: string
          organization_id: string
          provenance: string
          revision_number: number
          revision_summary: string
          source: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          baseline_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          effective_ends_at?: string | null
          effective_starts_at?: string
          id?: string
          idempotency_key?: string | null
          idempotency_request_digest?: string | null
          identifier?: string
          identifier_normalized?: string | null
          is_current?: boolean
          name?: string
          organization_id?: string
          provenance?: string
          revision_number?: number
          revision_summary?: string
          source?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "software_baselines_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "software_baselines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "software_baselines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "software_baselines_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_conflicts: {
        Row: {
          authority_policy_id: string | null
          authority_policy_snapshot: Json
          conflict_kind: string
          connector_id: string
          correlation_id: string
          cra_value: Json
          cra_value_observed_at: string
          cra_value_source: string
          created_at: string
          detected_at: string
          entity_id: string | null
          entity_type: string
          external_identity_id: string | null
          external_value: Json
          external_value_hash: string
          external_value_observed_at: string
          field_path: string
          id: string
          organization_id: string
          permitted_actions: string[]
          plan_item_id: string | null
          resolution_chosen_action: string | null
          resolution_reason: string | null
          resolution_status: string
          resolution_value: Json | null
          resolved_against_external_value_hash: string | null
          resolved_at: string | null
          resolved_by: string | null
          supersedes_conflict_id: string | null
          sync_run_id: string
          updated_at: string
          version: number
        }
        Insert: {
          authority_policy_id?: string | null
          authority_policy_snapshot: Json
          conflict_kind?: string
          connector_id: string
          correlation_id: string
          cra_value: Json
          cra_value_observed_at: string
          cra_value_source: string
          created_at?: string
          detected_at?: string
          entity_id?: string | null
          entity_type: string
          external_identity_id?: string | null
          external_value: Json
          external_value_hash: string
          external_value_observed_at: string
          field_path: string
          id?: string
          organization_id: string
          permitted_actions?: string[]
          plan_item_id?: string | null
          resolution_chosen_action?: string | null
          resolution_reason?: string | null
          resolution_status?: string
          resolution_value?: Json | null
          resolved_against_external_value_hash?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          supersedes_conflict_id?: string | null
          sync_run_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          authority_policy_id?: string | null
          authority_policy_snapshot?: Json
          conflict_kind?: string
          connector_id?: string
          correlation_id?: string
          cra_value?: Json
          cra_value_observed_at?: string
          cra_value_source?: string
          created_at?: string
          detected_at?: string
          entity_id?: string | null
          entity_type?: string
          external_identity_id?: string | null
          external_value?: Json
          external_value_hash?: string
          external_value_observed_at?: string
          field_path?: string
          id?: string
          organization_id?: string
          permitted_actions?: string[]
          plan_item_id?: string | null
          resolution_chosen_action?: string | null
          resolution_reason?: string | null
          resolution_status?: string
          resolution_value?: Json | null
          resolved_against_external_value_hash?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          supersedes_conflict_id?: string | null
          sync_run_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_organization_id_authority_policy_id_fkey"
            columns: ["organization_id", "authority_policy_id"]
            isOneToOne: false
            referencedRelation: "field_authority_policies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_conflicts_organization_id_connector_id_fkey"
            columns: ["organization_id", "connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_conflicts_organization_id_external_identity_id_fkey"
            columns: ["organization_id", "external_identity_id"]
            isOneToOne: false
            referencedRelation: "product_external_identities"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_conflicts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_conflicts_organization_id_supersedes_conflict_id_fkey"
            columns: ["organization_id", "supersedes_conflict_id"]
            isOneToOne: false
            referencedRelation: "sync_conflicts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_conflicts_organization_id_sync_run_id_fkey"
            columns: ["organization_id", "sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_conflicts_plan_item_fkey"
            columns: ["organization_id", "plan_item_id"]
            isOneToOne: false
            referencedRelation: "sync_run_plan_items"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_connector_cursors: {
        Row: {
          circuit_opened_at: string | null
          circuit_state: string
          connector_id: string
          consecutive_failure_count: number
          cursor: string | null
          cursor_issued_at: string | null
          last_committed_at: string | null
          last_committed_run_id: string | null
          last_full_reconciliation_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          circuit_opened_at?: string | null
          circuit_state?: string
          connector_id: string
          consecutive_failure_count?: number
          cursor?: string | null
          cursor_issued_at?: string | null
          last_committed_at?: string | null
          last_committed_run_id?: string | null
          last_full_reconciliation_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          circuit_opened_at?: string | null
          circuit_state?: string
          connector_id?: string
          consecutive_failure_count?: number
          cursor?: string | null
          cursor_issued_at?: string | null
          last_committed_at?: string | null
          last_committed_run_id?: string | null
          last_full_reconciliation_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_connector_cursors_organization_id_connector_id_fkey"
            columns: ["organization_id", "connector_id"]
            isOneToOne: true
            referencedRelation: "connectors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_connector_cursors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_connector_cursors_organization_id_last_committed_run__fkey"
            columns: ["organization_id", "last_committed_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sync_run_plan_items: {
        Row: {
          applied_at: string | null
          cra_product_id: string | null
          cra_release_id: string | null
          created_at: string
          entity_type: string
          expected_version: number | null
          external_id: string
          field_diffs: Json
          id: string
          issues: Json
          organization_id: string
          proposed_action: string
          sync_run_id: string
        }
        Insert: {
          applied_at?: string | null
          cra_product_id?: string | null
          cra_release_id?: string | null
          created_at?: string
          entity_type: string
          expected_version?: number | null
          external_id: string
          field_diffs?: Json
          id?: string
          issues?: Json
          organization_id: string
          proposed_action: string
          sync_run_id: string
        }
        Update: {
          applied_at?: string | null
          cra_product_id?: string | null
          cra_release_id?: string | null
          created_at?: string
          entity_type?: string
          expected_version?: number | null
          external_id?: string
          field_diffs?: Json
          id?: string
          issues?: Json
          organization_id?: string
          proposed_action?: string
          sync_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_run_plan_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_run_plan_items_organization_id_sync_run_id_fkey"
            columns: ["organization_id", "sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          adapter_version: string
          canceled_at: string | null
          cancellation_reason: string | null
          checkpoint_cursor: string | null
          commit_actor_user_id: string | null
          commit_idempotency_key: string | null
          commit_request_digest: string | null
          committed_at: string | null
          conflict_count: number
          connector_id: string
          correlation_id: string
          create_count: number
          created_at: string
          cursor_from: string | null
          cursor_to: string | null
          cycle_blocked_count: number
          error_code: string | null
          estimated_graph_impact: Json
          expires_at: string
          fetch_content_hash: string | null
          id: string
          lease_expires_at: string | null
          lease_owner: string | null
          mapping_version: string
          next_attempt_at: string
          organization_id: string
          plan_basis_digest: string | null
          processed_count: number
          reconciliation_kind: string
          retry_count: number
          row_count: number
          skip_count: number
          status: string
          tombstone_count: number
          trigger_idempotency_key: string
          trigger_request_digest: string
          unchanged_count: number
          update_count: number
          updated_at: string
          work_kind: string
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          adapter_version: string
          canceled_at?: string | null
          cancellation_reason?: string | null
          checkpoint_cursor?: string | null
          commit_actor_user_id?: string | null
          commit_idempotency_key?: string | null
          commit_request_digest?: string | null
          committed_at?: string | null
          conflict_count?: number
          connector_id: string
          correlation_id: string
          create_count?: number
          created_at?: string
          cursor_from?: string | null
          cursor_to?: string | null
          cycle_blocked_count?: number
          error_code?: string | null
          estimated_graph_impact?: Json
          expires_at?: string
          fetch_content_hash?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          mapping_version: string
          next_attempt_at?: string
          organization_id: string
          plan_basis_digest?: string | null
          processed_count?: number
          reconciliation_kind: string
          retry_count?: number
          row_count?: number
          skip_count?: number
          status?: string
          tombstone_count?: number
          trigger_idempotency_key: string
          trigger_request_digest: string
          unchanged_count?: number
          update_count?: number
          updated_at?: string
          work_kind?: string
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          adapter_version?: string
          canceled_at?: string | null
          cancellation_reason?: string | null
          checkpoint_cursor?: string | null
          commit_actor_user_id?: string | null
          commit_idempotency_key?: string | null
          commit_request_digest?: string | null
          committed_at?: string | null
          conflict_count?: number
          connector_id?: string
          correlation_id?: string
          create_count?: number
          created_at?: string
          cursor_from?: string | null
          cursor_to?: string | null
          cycle_blocked_count?: number
          error_code?: string | null
          estimated_graph_impact?: Json
          expires_at?: string
          fetch_content_hash?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          mapping_version?: string
          next_attempt_at?: string
          organization_id?: string
          plan_basis_digest?: string | null
          processed_count?: number
          reconciliation_kind?: string
          retry_count?: number
          row_count?: number
          skip_count?: number
          status?: string
          tombstone_count?: number
          trigger_idempotency_key?: string
          trigger_request_digest?: string
          unchanged_count?: number
          update_count?: number
          updated_at?: string
          work_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_commit_actor_user_id_fkey"
            columns: ["commit_actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_organization_id_connector_id_fkey"
            columns: ["organization_id", "connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "sync_runs_organization_id_fkey"
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
      vulnerabilities: {
        Row: {
          canonical_id: string
          created_at: string
          id: string
          lifecycle_state: string
          modified_at: string | null
          published_at: string | null
          severity: Json
          summary: string | null
          title: string | null
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          canonical_id: string
          created_at?: string
          id?: string
          lifecycle_state?: string
          modified_at?: string | null
          published_at?: string | null
          severity?: Json
          summary?: string | null
          title?: string | null
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          canonical_id?: string
          created_at?: string
          id?: string
          lifecycle_state?: string
          modified_at?: string | null
          published_at?: string | null
          severity?: Json
          summary?: string | null
          title?: string | null
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      vulnerability_affected_ranges: {
        Row: {
          configuration_negated: boolean
          configuration_operator: string | null
          configuration_path: string | null
          cpe_edition: string | null
          cpe_language: string | null
          cpe_part: string | null
          cpe_product: string | null
          cpe_update: string | null
          cpe_vendor: string | null
          cpe_version: string | null
          cpe_vulnerable: boolean | null
          created_at: string
          ecosystem: string | null
          event_sequence: Json
          id: string
          package_name: string | null
          purl_name: string | null
          purl_namespace: string | null
          purl_type: string | null
          range_type: string | null
          range_value: Json
          source_record_version_id: string
          version_end_excluding: string | null
          version_end_including: string | null
          version_start_excluding: string | null
          version_start_including: string | null
          vulnerability_id: string
        }
        Insert: {
          configuration_negated?: boolean
          configuration_operator?: string | null
          configuration_path?: string | null
          cpe_edition?: string | null
          cpe_language?: string | null
          cpe_part?: string | null
          cpe_product?: string | null
          cpe_update?: string | null
          cpe_vendor?: string | null
          cpe_version?: string | null
          cpe_vulnerable?: boolean | null
          created_at?: string
          ecosystem?: string | null
          event_sequence?: Json
          id?: string
          package_name?: string | null
          purl_name?: string | null
          purl_namespace?: string | null
          purl_type?: string | null
          range_type?: string | null
          range_value: Json
          source_record_version_id: string
          version_end_excluding?: string | null
          version_end_including?: string | null
          version_start_excluding?: string | null
          version_start_including?: string | null
          vulnerability_id: string
        }
        Update: {
          configuration_negated?: boolean
          configuration_operator?: string | null
          configuration_path?: string | null
          cpe_edition?: string | null
          cpe_language?: string | null
          cpe_part?: string | null
          cpe_product?: string | null
          cpe_update?: string | null
          cpe_vendor?: string | null
          cpe_version?: string | null
          cpe_vulnerable?: boolean | null
          created_at?: string
          ecosystem?: string | null
          event_sequence?: Json
          id?: string
          package_name?: string | null
          purl_name?: string | null
          purl_namespace?: string | null
          purl_type?: string | null
          range_type?: string | null
          range_value?: Json
          source_record_version_id?: string
          version_end_excluding?: string | null
          version_end_including?: string | null
          version_start_excluding?: string | null
          version_start_including?: string | null
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_affected_ranges_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_affected_ranges_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_aliases: {
        Row: {
          alias: string
          created_at: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          source_record_version_id?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_aliases_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_aliases_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_component_occurrences: {
        Row: {
          canonical_cpe: string | null
          canonical_purl: string | null
          component_id: string
          component_identity: string
          component_version: string | null
          cpe_part: string | null
          cpe_product: string | null
          cpe_vendor: string | null
          cpe_version: string | null
          created_at: string
          document_id: string
          first_evaluated_at: string
          id: string
          identity_kind: string
          last_evaluated_at: string
          organization_id: string
          purl_name: string | null
          purl_namespace: string | null
          purl_type: string | null
          release_id: string
          updated_at: string
        }
        Insert: {
          canonical_cpe?: string | null
          canonical_purl?: string | null
          component_id: string
          component_identity: string
          component_version?: string | null
          cpe_part?: string | null
          cpe_product?: string | null
          cpe_vendor?: string | null
          cpe_version?: string | null
          created_at?: string
          document_id: string
          first_evaluated_at?: string
          id?: string
          identity_kind?: string
          last_evaluated_at?: string
          organization_id: string
          purl_name?: string | null
          purl_namespace?: string | null
          purl_type?: string | null
          release_id: string
          updated_at?: string
        }
        Update: {
          canonical_cpe?: string | null
          canonical_purl?: string | null
          component_id?: string
          component_identity?: string
          component_version?: string | null
          cpe_part?: string | null
          cpe_product?: string | null
          cpe_vendor?: string | null
          cpe_version?: string | null
          created_at?: string
          document_id?: string
          first_evaluated_at?: string
          id?: string
          identity_kind?: string
          last_evaluated_at?: string
          organization_id?: string
          purl_name?: string | null
          purl_namespace?: string | null
          purl_type?: string | null
          release_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_component_occur_organization_id_document_id__fkey"
            columns: ["organization_id", "document_id", "component_id"]
            isOneToOne: false
            referencedRelation: "sbom_components"
            referencedColumns: ["organization_id", "document_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_component_occurre_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_component_occurrences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_enrichments: {
        Row: {
          created_at: string
          enrichment: Json
          enrichment_type: string
          feed_key: string
          id: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Insert: {
          created_at?: string
          enrichment: Json
          enrichment_type: string
          feed_key: string
          id?: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Update: {
          created_at?: string
          enrichment?: Json
          enrichment_type?: string
          feed_key?: string
          id?: string
          source_record_version_id?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_enrichments_feed_key_fkey"
            columns: ["feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_enrichments_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_enrichments_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_feed_configs: {
        Row: {
          checkpoint: Json
          created_at: string
          current_promotion_sequence: number
          disabled_reason: string | null
          enabled: boolean
          feed_key: string
          freshness_state: string
          last_attempt_at: string | null
          last_bundle_payload_sha256: string | null
          last_complete_snapshot_at: string | null
          last_failure_at: string | null
          last_failure_code: string | null
          last_failure_reason: string | null
          last_record_count: number
          last_source_snapshot_at: string | null
          last_success_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          next_scheduled_at: string
          schedule_interval_seconds: number
          stale_threshold_seconds: number
          sync_state: string
          updated_at: string
          upstream_cursor: string | null
          upstream_etag: string | null
        }
        Insert: {
          checkpoint?: Json
          created_at?: string
          current_promotion_sequence?: number
          disabled_reason?: string | null
          enabled?: boolean
          feed_key: string
          freshness_state?: string
          last_attempt_at?: string | null
          last_bundle_payload_sha256?: string | null
          last_complete_snapshot_at?: string | null
          last_failure_at?: string | null
          last_failure_code?: string | null
          last_failure_reason?: string | null
          last_record_count?: number
          last_source_snapshot_at?: string | null
          last_success_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          next_scheduled_at?: string
          schedule_interval_seconds: number
          stale_threshold_seconds: number
          sync_state?: string
          updated_at?: string
          upstream_cursor?: string | null
          upstream_etag?: string | null
        }
        Update: {
          checkpoint?: Json
          created_at?: string
          current_promotion_sequence?: number
          disabled_reason?: string | null
          enabled?: boolean
          feed_key?: string
          freshness_state?: string
          last_attempt_at?: string | null
          last_bundle_payload_sha256?: string | null
          last_complete_snapshot_at?: string | null
          last_failure_at?: string | null
          last_failure_code?: string | null
          last_failure_reason?: string | null
          last_record_count?: number
          last_source_snapshot_at?: string | null
          last_success_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          next_scheduled_at?: string
          schedule_interval_seconds?: number
          stale_threshold_seconds?: number
          sync_state?: string
          updated_at?: string
          upstream_cursor?: string | null
          upstream_etag?: string | null
        }
        Relationships: []
      }
      vulnerability_feed_events: {
        Row: {
          actor_user_id: string | null
          bundle_import_id: string | null
          correlation_id: string | null
          created_at: string
          detail: Json
          event_type: string
          feed_key: string
          id: string
          run_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          bundle_import_id?: string | null
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          event_type: string
          feed_key: string
          id?: string
          run_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          bundle_import_id?: string | null
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          event_type?: string
          feed_key?: string
          id?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_feed_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_events_bundle_import_fkey"
            columns: ["bundle_import_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_offline_bundle_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_events_feed_key_fkey"
            columns: ["feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_feed_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_feed_promotion_snapshots: {
        Row: {
          bundle_import_id: string | null
          completed_at: string
          created_at: string
          feed_key: string
          promotion_sequence: number
          run_id: string
          source_record_count: number
          source_snapshot_at: string | null
        }
        Insert: {
          bundle_import_id?: string | null
          completed_at: string
          created_at?: string
          feed_key: string
          promotion_sequence: number
          run_id: string
          source_record_count: number
          source_snapshot_at?: string | null
        }
        Update: {
          bundle_import_id?: string | null
          completed_at?: string
          created_at?: string
          feed_key?: string
          promotion_sequence?: number
          run_id?: string
          source_record_count?: number
          source_snapshot_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_feed_promotion_snapshots_bundle_import_fkey"
            columns: ["bundle_import_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_offline_bundle_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_promotion_snapshots_feed_key_fkey"
            columns: ["feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_feed_promotion_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "vulnerability_feed_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_feed_snapshot_source_records: {
        Row: {
          created_at: string
          feed_key: string
          promotion_sequence: number
          record_state: string
          source_record_id: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Insert: {
          created_at?: string
          feed_key: string
          promotion_sequence: number
          record_state: string
          source_record_id: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Update: {
          created_at?: string
          feed_key?: string
          promotion_sequence?: number
          record_state?: string
          source_record_id?: string
          source_record_version_id?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_feed_snapshot_so_feed_key_promotion_sequence_fkey"
            columns: ["feed_key", "promotion_sequence"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_promotion_snapshots"
            referencedColumns: ["feed_key", "promotion_sequence"]
          },
          {
            foreignKeyName: "vulnerability_feed_snapshot_sourc_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_snapshot_source_record_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_snapshot_source_record_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_feed_staged_records: {
        Row: {
          canonical_id: string
          normalized_payload: Json
          raw_payload: Json
          received_at: string
          record_sha256: string
          record_state: string
          run_id: string
          source_record_key: string
          source_update_marker: string | null
          source_updated_at: string | null
        }
        Insert: {
          canonical_id: string
          normalized_payload: Json
          raw_payload: Json
          received_at?: string
          record_sha256: string
          record_state?: string
          run_id: string
          source_record_key: string
          source_update_marker?: string | null
          source_updated_at?: string | null
        }
        Update: {
          canonical_id?: string
          normalized_payload?: Json
          raw_payload?: Json
          received_at?: string
          record_sha256?: string
          record_state?: string
          run_id?: string
          source_record_key?: string
          source_update_marker?: string | null
          source_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_feed_staged_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_feed_sync_runs: {
        Row: {
          attempt_count: number
          bundle_import_id: string | null
          bundle_payload_sha256: string | null
          checkpoint: Json
          completed_at: string | null
          correlation_id: string
          created_at: string
          dead_lettered_at: string | null
          expected_record_count: number | null
          failure_code: string | null
          failure_reason: string | null
          feed_key: string
          id: string
          idempotency_key: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          next_attempt_at: string
          promotion_sequence: number | null
          records_promoted: number
          records_received: number
          replay_idempotency_key: string | null
          replayed_at: string | null
          replayed_by: string | null
          requested_by: string | null
          run_kind: string
          source_schema_version: string | null
          source_snapshot_at: string | null
          staging_complete: boolean
          started_at: string | null
          status: string
          updated_at: string
          upstream_cursor: string | null
          upstream_etag: string | null
        }
        Insert: {
          attempt_count?: number
          bundle_import_id?: string | null
          bundle_payload_sha256?: string | null
          checkpoint?: Json
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          dead_lettered_at?: string | null
          expected_record_count?: number | null
          failure_code?: string | null
          failure_reason?: string | null
          feed_key: string
          id?: string
          idempotency_key?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          promotion_sequence?: number | null
          records_promoted?: number
          records_received?: number
          replay_idempotency_key?: string | null
          replayed_at?: string | null
          replayed_by?: string | null
          requested_by?: string | null
          run_kind: string
          source_schema_version?: string | null
          source_snapshot_at?: string | null
          staging_complete?: boolean
          started_at?: string | null
          status?: string
          updated_at?: string
          upstream_cursor?: string | null
          upstream_etag?: string | null
        }
        Update: {
          attempt_count?: number
          bundle_import_id?: string | null
          bundle_payload_sha256?: string | null
          checkpoint?: Json
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          dead_lettered_at?: string | null
          expected_record_count?: number | null
          failure_code?: string | null
          failure_reason?: string | null
          feed_key?: string
          id?: string
          idempotency_key?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_attempt_at?: string
          promotion_sequence?: number | null
          records_promoted?: number
          records_received?: number
          replay_idempotency_key?: string | null
          replayed_at?: string | null
          replayed_by?: string | null
          requested_by?: string | null
          run_kind?: string
          source_schema_version?: string | null
          source_snapshot_at?: string | null
          staging_complete?: boolean
          started_at?: string | null
          status?: string
          updated_at?: string
          upstream_cursor?: string | null
          upstream_etag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_feed_sync_runs_bundle_import_fkey"
            columns: ["bundle_import_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_offline_bundle_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_sync_runs_feed_key_fkey"
            columns: ["feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_feed_sync_runs_replayed_by_fkey"
            columns: ["replayed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_feed_sync_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_finding_component_occurrences: {
        Row: {
          created_at: string
          finding_id: string
          first_detected_at: string
          last_evaluated_at: string
          last_seen_job_id: string | null
          occurrence_id: string
          organization_id: string
          state: string
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          finding_id: string
          first_detected_at?: string
          last_evaluated_at?: string
          last_seen_job_id?: string | null
          occurrence_id: string
          organization_id: string
          state?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          finding_id?: string
          first_detected_at?: string
          last_evaluated_at?: string
          last_seen_job_id?: string | null
          occurrence_id?: string
          organization_id?: string
          state?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_finding_compone_organization_id_last_seen_jo_fkey"
            columns: ["organization_id", "last_seen_job_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_match_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_finding_component_occurrence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_finding_component_occurrences_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_finding_component_occurrences_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_component_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_finding_review_events: {
        Row: {
          created_at: string
          finding_id: string
          id: string
          material_fingerprint: string
          max_notification_attempts: number
          notification_attempts: number
          notification_due_at: string
          notification_error_code: string | null
          notification_error_message: string | null
          notification_last_attempt_at: string | null
          notification_lease_expires_at: string | null
          notification_lease_owner: string | null
          notification_status: string
          notified_at: string | null
          organization_id: string
          prior_state: Json
          proposed_state: Json
          review_state: string
          source_record_id: string
          source_record_version_id: string
          transition_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          finding_id: string
          id?: string
          material_fingerprint: string
          max_notification_attempts?: number
          notification_attempts?: number
          notification_due_at?: string
          notification_error_code?: string | null
          notification_error_message?: string | null
          notification_last_attempt_at?: string | null
          notification_lease_expires_at?: string | null
          notification_lease_owner?: string | null
          notification_status?: string
          notified_at?: string | null
          organization_id: string
          prior_state: Json
          proposed_state: Json
          review_state?: string
          source_record_id: string
          source_record_version_id: string
          transition_kind: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          finding_id?: string
          id?: string
          material_fingerprint?: string
          max_notification_attempts?: number
          notification_attempts?: number
          notification_due_at?: string
          notification_error_code?: string | null
          notification_error_message?: string | null
          notification_last_attempt_at?: string | null
          notification_lease_expires_at?: string | null
          notification_lease_owner?: string | null
          notification_status?: string
          notified_at?: string | null
          organization_id?: string
          prior_state?: Json
          proposed_state?: Json
          review_state?: string
          source_record_id?: string
          source_record_version_id?: string
          transition_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_finding_review_ev_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_finding_review_even_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_finding_review_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_finding_review_events_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_findings: {
        Row: {
          affected_range: Json
          affected_range_id: string
          automatic_verdict: string
          canonical_advisory_id: string
          closed_at: string | null
          closure_reason: string | null
          comparator_name: string
          comparator_version: string
          component_identity: string
          confidence: number
          confidence_explanation: string
          confidence_table_version: string
          created_at: string
          evaluated_component_value: string
          event_sequence: Json
          first_detected_at: string
          human_assessed_at: string | null
          human_assessed_by: string | null
          human_rationale: string | null
          human_verdict: string | null
          id: string
          last_evaluated_at: string
          last_seen_job_id: string | null
          match_method: string
          organization_id: string
          proposed_state: Json
          reconciliation_conflict: Json
          reevaluation_state: string
          release_id: string
          source_feed_key: string
          source_record_id: string
          source_record_version_id: string
          status: string
          superseded_at: string | null
          updated_at: string
          vulnerability_id: string
        }
        Insert: {
          affected_range: Json
          affected_range_id: string
          automatic_verdict?: string
          canonical_advisory_id: string
          closed_at?: string | null
          closure_reason?: string | null
          comparator_name: string
          comparator_version: string
          component_identity: string
          confidence: number
          confidence_explanation: string
          confidence_table_version: string
          created_at?: string
          evaluated_component_value: string
          event_sequence: Json
          first_detected_at?: string
          human_assessed_at?: string | null
          human_assessed_by?: string | null
          human_rationale?: string | null
          human_verdict?: string | null
          id?: string
          last_evaluated_at?: string
          last_seen_job_id?: string | null
          match_method: string
          organization_id: string
          proposed_state?: Json
          reconciliation_conflict?: Json
          reevaluation_state?: string
          release_id: string
          source_feed_key: string
          source_record_id: string
          source_record_version_id: string
          status?: string
          superseded_at?: string | null
          updated_at?: string
          vulnerability_id: string
        }
        Update: {
          affected_range?: Json
          affected_range_id?: string
          automatic_verdict?: string
          canonical_advisory_id?: string
          closed_at?: string | null
          closure_reason?: string | null
          comparator_name?: string
          comparator_version?: string
          component_identity?: string
          confidence?: number
          confidence_explanation?: string
          confidence_table_version?: string
          created_at?: string
          evaluated_component_value?: string
          event_sequence?: Json
          first_detected_at?: string
          human_assessed_at?: string | null
          human_assessed_by?: string | null
          human_rationale?: string | null
          human_verdict?: string | null
          id?: string
          last_evaluated_at?: string
          last_seen_job_id?: string | null
          match_method?: string
          organization_id?: string
          proposed_state?: Json
          reconciliation_conflict?: Json
          reevaluation_state?: string
          release_id?: string
          source_feed_key?: string
          source_record_id?: string
          source_record_version_id?: string
          status?: string
          superseded_at?: string | null
          updated_at?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_findings_affected_range_id_fkey"
            columns: ["affected_range_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_affected_ranges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_human_assessed_by_fkey"
            columns: ["human_assessed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_organization_id_last_seen_job_id_fkey"
            columns: ["organization_id", "last_seen_job_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_match_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_findings_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_findings_source_feed_key_fkey"
            columns: ["source_feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_findings_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_findings_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_kev_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          delivered_at: string | null
          delivery_attempts: number
          delivery_status: string
          external_obligation_id: string | null
          id: string
          kev_listing_date: string | null
          kev_source_record_id: string
          kev_source_record_version_id: string
          last_delivery_error_code: string | null
          last_delivery_error_message: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lifecycle_state: string
          material_fingerprint: string
          max_delivery_attempts: number
          organization_id: string
          release_id: string
          reporting_idempotency_key: string | null
          reporting_intent_opened_at: string | null
          reporting_intent_opened_by: string | null
          reporting_status: string
          resolution_reason: string | null
          resolved_at: string | null
          severity: string
          state: string
          triggering_finding_id: string
          updated_at: string
          vulnerability_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_attempts?: number
          delivery_status?: string
          external_obligation_id?: string | null
          id?: string
          kev_listing_date?: string | null
          kev_source_record_id: string
          kev_source_record_version_id: string
          last_delivery_error_code?: string | null
          last_delivery_error_message?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lifecycle_state: string
          material_fingerprint: string
          max_delivery_attempts?: number
          organization_id: string
          release_id: string
          reporting_idempotency_key?: string | null
          reporting_intent_opened_at?: string | null
          reporting_intent_opened_by?: string | null
          reporting_status?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          severity?: string
          state?: string
          triggering_finding_id: string
          updated_at?: string
          vulnerability_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_attempts?: number
          delivery_status?: string
          external_obligation_id?: string | null
          id?: string
          kev_listing_date?: string | null
          kev_source_record_id?: string
          kev_source_record_version_id?: string
          last_delivery_error_code?: string | null
          last_delivery_error_message?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lifecycle_state?: string
          material_fingerprint?: string
          max_delivery_attempts?: number
          organization_id?: string
          release_id?: string
          reporting_idempotency_key?: string | null
          reporting_intent_opened_at?: string | null
          reporting_intent_opened_by?: string | null
          reporting_status?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          severity?: string
          state?: string
          triggering_finding_id?: string
          updated_at?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_kev_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_kev_source_record_id_fkey"
            columns: ["kev_source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_kev_source_record_version_id_fkey"
            columns: ["kev_source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_reporting_intent_opened_by_fkey"
            columns: ["reporting_intent_opened_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_triggering_finding_fkey"
            columns: ["triggering_finding_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_triggering_finding_id_fkey"
            columns: ["triggering_finding_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_kev_alerts_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_match_evaluations: {
        Row: {
          affected_range: Json | null
          affected_range_id: string | null
          comparator_name: string | null
          comparator_version: string | null
          created_at: string
          evaluated_at: string
          evaluated_component_value: string
          event_sequence: Json | null
          id: string
          match_job_id: string
          match_method: string
          occurrence_id: string
          organization_id: string
          outcome: string
          review_code: string | null
          source_feed_key: string
          source_record_id: string | null
          source_record_version_id: string | null
          vulnerability_id: string | null
        }
        Insert: {
          affected_range?: Json | null
          affected_range_id?: string | null
          comparator_name?: string | null
          comparator_version?: string | null
          created_at?: string
          evaluated_at: string
          evaluated_component_value: string
          event_sequence?: Json | null
          id?: string
          match_job_id: string
          match_method: string
          occurrence_id: string
          organization_id: string
          outcome: string
          review_code?: string | null
          source_feed_key: string
          source_record_id?: string | null
          source_record_version_id?: string | null
          vulnerability_id?: string | null
        }
        Update: {
          affected_range?: Json | null
          affected_range_id?: string | null
          comparator_name?: string | null
          comparator_version?: string | null
          created_at?: string
          evaluated_at?: string
          evaluated_component_value?: string
          event_sequence?: Json | null
          id?: string
          match_job_id?: string
          match_method?: string
          occurrence_id?: string
          organization_id?: string
          outcome?: string
          review_code?: string | null
          source_feed_key?: string
          source_record_id?: string | null
          source_record_version_id?: string | null
          vulnerability_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_match_evaluatio_organization_id_match_job_id_fkey"
            columns: ["organization_id", "match_job_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_match_jobs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_affected_range_id_fkey"
            columns: ["affected_range_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_affected_ranges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_component_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_source_feed_key_fkey"
            columns: ["source_feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_match_evaluations_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_match_jobs: {
        Row: {
          checkpoint_component_id: string | null
          checkpoint_source_offset: number
          checkpoint_version: number
          completed_at: string | null
          correlation_id: string
          created_at: string
          dead_lettered_at: string | null
          delivery_attempts: number
          document_id: string
          due_at: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          matched_component_count: number
          max_attempts: number
          mirror_captured_at: string | null
          nvd_mirror_captured_at: string | null
          nvd_promotion_sequence: number
          organization_id: string
          osv_promotion_sequence: number
          processed_component_count: number
          release_id: string
          requested_by: string | null
          reviewable_component_count: number
          started_at: string | null
          status: string
          trigger_key: string
          updated_at: string
          vendor_csaf_mirror_captured_at: string | null
          vendor_csaf_promotion_sequence: number
        }
        Insert: {
          checkpoint_component_id?: string | null
          checkpoint_source_offset?: number
          checkpoint_version?: number
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          dead_lettered_at?: string | null
          delivery_attempts?: number
          document_id: string
          due_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          matched_component_count?: number
          max_attempts?: number
          mirror_captured_at?: string | null
          nvd_mirror_captured_at?: string | null
          nvd_promotion_sequence?: number
          organization_id: string
          osv_promotion_sequence: number
          processed_component_count?: number
          release_id: string
          requested_by?: string | null
          reviewable_component_count?: number
          started_at?: string | null
          status?: string
          trigger_key: string
          updated_at?: string
          vendor_csaf_mirror_captured_at?: string | null
          vendor_csaf_promotion_sequence?: number
        }
        Update: {
          checkpoint_component_id?: string | null
          checkpoint_source_offset?: number
          checkpoint_version?: number
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          dead_lettered_at?: string | null
          delivery_attempts?: number
          document_id?: string
          due_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          matched_component_count?: number
          max_attempts?: number
          mirror_captured_at?: string | null
          nvd_mirror_captured_at?: string | null
          nvd_promotion_sequence?: number
          organization_id?: string
          osv_promotion_sequence?: number
          processed_component_count?: number
          release_id?: string
          requested_by?: string | null
          reviewable_component_count?: number
          started_at?: string | null
          status?: string
          trigger_key?: string
          updated_at?: string
          vendor_csaf_mirror_captured_at?: string | null
          vendor_csaf_promotion_sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_match_jobs_organization_id_document_id_fkey"
            columns: ["organization_id", "document_id"]
            isOneToOne: false
            referencedRelation: "sbom_documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_match_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_match_jobs_organization_id_release_id_fkey"
            columns: ["organization_id", "release_id"]
            isOneToOne: false
            referencedRelation: "product_releases"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_match_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_matching_accuracy_metrics: {
        Row: {
          accuracy_run_id: string
          ecosystem: string
          false_negative_count: number
          false_positive_count: number
          match_method: string
          release_key: string
          source_feed_key: string
          total_cases: number
        }
        Insert: {
          accuracy_run_id: string
          ecosystem: string
          false_negative_count: number
          false_positive_count: number
          match_method: string
          release_key: string
          source_feed_key: string
          total_cases: number
        }
        Update: {
          accuracy_run_id?: string
          ecosystem?: string
          false_negative_count?: number
          false_positive_count?: number
          match_method?: string
          release_key?: string
          source_feed_key?: string
          total_cases?: number
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_matching_accuracy_metrics_accuracy_run_id_fkey"
            columns: ["accuracy_run_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_matching_accuracy_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_matching_accuracy_metrics_source_feed_key_fkey"
            columns: ["source_feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
        ]
      }
      vulnerability_matching_accuracy_runs: {
        Row: {
          accuracy_score: number
          code_revision: string
          comparator_registry_version: string
          confidence_table_version: string
          created_at: string
          dataset_digest: string
          dataset_version: string
          executed_at: string
          false_negative_count: number
          false_positive_count: number
          id: string
          passed: boolean
          runner_metadata: Json
          total_cases: number
        }
        Insert: {
          accuracy_score: number
          code_revision: string
          comparator_registry_version: string
          confidence_table_version: string
          created_at?: string
          dataset_digest: string
          dataset_version: string
          executed_at?: string
          false_negative_count: number
          false_positive_count: number
          id?: string
          passed: boolean
          runner_metadata?: Json
          total_cases: number
        }
        Update: {
          accuracy_score?: number
          code_revision?: string
          comparator_registry_version?: string
          confidence_table_version?: string
          created_at?: string
          dataset_digest?: string
          dataset_version?: string
          executed_at?: string
          false_negative_count?: number
          false_positive_count?: number
          id?: string
          passed?: boolean
          runner_metadata?: Json
          total_cases?: number
        }
        Relationships: []
      }
      vulnerability_offline_bundle_imports: {
        Row: {
          actor_user_id: string
          bundle_id: string
          bundle_version: string
          completed_at: string | null
          correlation_id: string
          created_at: string
          failure_code: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          manifest_sha256: string
          payload_inventory: Json
          promotion_started_at: string | null
          signed_manifest: Json
          signing_key_id: string
          staging_worker_id: string
          status: string
          updated_at: string
          verification_receipt: Json
        }
        Insert: {
          actor_user_id: string
          bundle_id: string
          bundle_version: string
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          manifest_sha256: string
          payload_inventory: Json
          promotion_started_at?: string | null
          signed_manifest: Json
          signing_key_id: string
          staging_worker_id: string
          status?: string
          updated_at?: string
          verification_receipt: Json
        }
        Update: {
          actor_user_id?: string
          bundle_id?: string
          bundle_version?: string
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          manifest_sha256?: string
          payload_inventory?: Json
          promotion_started_at?: string | null
          signed_manifest?: Json
          signing_key_id?: string
          staging_worker_id?: string
          status?: string
          updated_at?: string
          verification_receipt?: Json
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_offline_bundle_imports_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_reachability_results: {
        Row: {
          analyzer_id: string
          analyzer_version: string
          build_format: string
          component_identity: string
          confidence_explanation: string
          confidence_level: string
          confidence_score: number
          created_at: string
          dependency_graph_fingerprint: string | null
          ecosystem: string
          evidence_path: Json
          executed_at: string
          finding_id: string
          freshness: string
          id: string
          idempotency_key: string
          input_artifacts: Json
          input_fingerprint: string
          limitations: Json
          material_fingerprint: string
          occurrence_id: string
          organization_id: string
          source_record_version_id: string
          stale_at: string | null
          stale_reasons: Json
          superseded_by_result_id: string | null
          verdict: string
          vulnerable_symbol: string | null
        }
        Insert: {
          analyzer_id: string
          analyzer_version: string
          build_format: string
          component_identity: string
          confidence_explanation: string
          confidence_level: string
          confidence_score: number
          created_at?: string
          dependency_graph_fingerprint?: string | null
          ecosystem: string
          evidence_path: Json
          executed_at: string
          finding_id: string
          freshness?: string
          id?: string
          idempotency_key: string
          input_artifacts: Json
          input_fingerprint: string
          limitations?: Json
          material_fingerprint: string
          occurrence_id: string
          organization_id: string
          source_record_version_id: string
          stale_at?: string | null
          stale_reasons?: Json
          superseded_by_result_id?: string | null
          verdict: string
          vulnerable_symbol?: string | null
        }
        Update: {
          analyzer_id?: string
          analyzer_version?: string
          build_format?: string
          component_identity?: string
          confidence_explanation?: string
          confidence_level?: string
          confidence_score?: number
          created_at?: string
          dependency_graph_fingerprint?: string | null
          ecosystem?: string
          evidence_path?: Json
          executed_at?: string
          finding_id?: string
          freshness?: string
          id?: string
          idempotency_key?: string
          input_artifacts?: Json
          input_fingerprint?: string
          limitations?: Json
          material_fingerprint?: string
          occurrence_id?: string
          organization_id?: string
          source_record_version_id?: string
          stale_at?: string | null
          stale_reasons?: Json
          superseded_by_result_id?: string | null
          verdict?: string
          vulnerable_symbol?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_reachability_re_organization_id_occurrence_i_fkey"
            columns: ["organization_id", "occurrence_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_component_occurrences"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_reachability_resu_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "vulnerability_reachability_result_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_reachability_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_reachability_results_superseded_by_result_id_fkey"
            columns: ["superseded_by_result_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_reachability_results"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_reevaluation_jobs: {
        Row: {
          checkpoint: Json
          checkpoint_version: number
          completed_at: string | null
          correlation_id: string
          created_at: string
          dead_lettered_at: string | null
          delivery_attempts: number
          due_at: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          organization_id: string | null
          processed_count: number
          scope: string
          source_matching_fingerprint: string
          source_record_id: string
          source_record_version_id: string
          started_at: string | null
          status: string
          trigger_key: string
          updated_at: string
          vulnerability_id: string
        }
        Insert: {
          checkpoint?: Json
          checkpoint_version?: number
          completed_at?: string | null
          correlation_id: string
          created_at?: string
          dead_lettered_at?: string | null
          delivery_attempts?: number
          due_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          organization_id?: string | null
          processed_count?: number
          scope: string
          source_matching_fingerprint: string
          source_record_id: string
          source_record_version_id: string
          started_at?: string | null
          status?: string
          trigger_key: string
          updated_at?: string
          vulnerability_id: string
        }
        Update: {
          checkpoint?: Json
          checkpoint_version?: number
          completed_at?: string | null
          correlation_id?: string
          created_at?: string
          dead_lettered_at?: string | null
          delivery_attempts?: number
          due_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          organization_id?: string | null
          processed_count?: number
          scope?: string
          source_matching_fingerprint?: string
          source_record_id?: string
          source_record_version_id?: string
          started_at?: string | null
          status?: string
          trigger_key?: string
          updated_at?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_reevaluation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_reevaluation_jobs_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_reevaluation_jobs_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_reevaluation_jobs_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_references: {
        Row: {
          created_at: string
          id: string
          reference_type: string
          reference_url: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reference_type?: string
          reference_url: string
          source_record_version_id: string
          vulnerability_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reference_type?: string
          reference_url?: string
          source_record_version_id?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_references_source_record_version_id_fkey"
            columns: ["source_record_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_references_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_source_record_versions: {
        Row: {
          id: string
          matching_fingerprint: string | null
          normalized_payload: Json
          promoted_at: string
          raw_payload: Json
          reconciliation_detail: Json
          record_sha256: string
          record_state: string
          run_id: string
          source_record_id: string
          source_update_marker: string | null
          source_updated_at: string | null
        }
        Insert: {
          id?: string
          matching_fingerprint?: string | null
          normalized_payload: Json
          promoted_at?: string
          raw_payload: Json
          reconciliation_detail?: Json
          record_sha256: string
          record_state: string
          run_id: string
          source_record_id: string
          source_update_marker?: string | null
          source_updated_at?: string | null
        }
        Update: {
          id?: string
          matching_fingerprint?: string | null
          normalized_payload?: Json
          promoted_at?: string
          raw_payload?: Json
          reconciliation_detail?: Json
          record_sha256?: string
          record_state?: string
          run_id?: string
          source_record_id?: string
          source_update_marker?: string | null
          source_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_source_record_versions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_source_record_versions_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_records"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_source_records: {
        Row: {
          created_at: string
          current_version_id: string | null
          feed_key: string
          first_seen_at: string
          id: string
          last_seen_at: string
          record_state: string
          source_record_key: string
          source_update_marker: string | null
          source_updated_at: string | null
          updated_at: string
          vulnerability_id: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          feed_key: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          record_state?: string
          source_record_key: string
          source_update_marker?: string | null
          source_updated_at?: string | null
          updated_at?: string
          vulnerability_id: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          feed_key?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          record_state?: string
          source_record_key?: string
          source_update_marker?: string | null
          source_updated_at?: string | null
          updated_at?: string
          vulnerability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_source_records_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "vulnerability_source_record_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_source_records_feed_key_fkey"
            columns: ["feed_key"]
            isOneToOne: false
            referencedRelation: "vulnerability_feed_configs"
            referencedColumns: ["feed_key"]
          },
          {
            foreignKeyName: "vulnerability_source_records_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      m2_product_relationship_operations: {
        Row: {
          active_component_links: number | null
          active_variant_relationships: number | null
          historical_relationships: number | null
          organization_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_retention_alert_operations: {
        Row: {
          current_alert_lag: string | null
          dead_letter_count: number | null
          missed_delivery_count: number | null
          organization_id: string | null
          product_id: string | null
          retention_status: string | null
          retrying_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      acknowledge_vulnerability_kev_alert_atomic:
        | {
            Args: {
              p_actor_user_id: string
              p_alert_id: string
              p_document_id: string
              p_organization_id: string
            }
            Returns: {
              alert: Json
              outcome: string
            }[]
          }
        | {
            Args: {
              p_actor_user_id: string
              p_alert_id: string
              p_document_id: string
              p_idempotency_key: string
              p_organization_id: string
            }
            Returns: {
              alert: Json
              outcome: string
            }[]
          }
      add_product_release_market_availability_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_country_code: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      append_software_baseline_revision_atomic: {
        Args: {
          p_actor_user_id: string
          p_baseline_id: string
          p_correlation_id: string
          p_description: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_expected_version: number
          p_idempotency_key: string
          p_name: string
          p_organization_id: string
          p_provenance: string
          p_revision_summary: string
          p_source: string
        }
        Returns: {
          baseline: Json
          outcome: string
        }[]
      }
      archive_connector_atomic: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_expected_version: number
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          connector: Json
          outcome: string
        }[]
      }
      archive_product_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
        }
        Returns: {
          outcome: string
          product: Json
        }[]
      }
      archive_product_release_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      archive_software_baseline_atomic: {
        Args: {
          p_actor_user_id: string
          p_baseline_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          baseline: Json
          outcome: string
        }[]
      }
      assign_product_legal_entity_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_legal_entity_id: string
          p_organization_id: string
          p_product_id: string
          p_reason: string
        }
        Returns: {
          outcome: string
          product: Json
        }[]
      }
      assign_software_baseline_membership_atomic: {
        Args: {
          p_actor_user_id: string
          p_baseline_id: string
          p_baseline_revision_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_expected_baseline_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_product_id: string
          p_provenance: string
          p_release_id: string
          p_source: string
        }
        Returns: {
          membership: Json
          outcome: string
        }[]
      }
      attach_sbom_composite_generated_source_atomic: {
        Args: {
          p_organization_id: string
          p_review_id: string
          p_source_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      backfill_organization_legal_entities: { Args: never; Returns: undefined }
      begin_product_security_update_artifact_cleanup_atomic: {
        Args: {
          p_artifact_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          object_key: string
          outcome: string
        }[]
      }
      begin_sbom_document_normalization_atomic: {
        Args: {
          p_format: string
          p_job_id: string
          p_normalizer_name: string
          p_normalizer_version: string
          p_organization_id: string
          p_parser_name: string
          p_parser_version: string
          p_serialization: string
          p_specification_version: string
          p_validation_report: Json
          p_worker_id: string
        }
        Returns: {
          document: Json
          outcome: string
        }[]
      }
      begin_security_update_artifact_cleanup_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          object_key: string
          outcome: string
        }[]
      }
      begin_sync_run_atomic: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_correlation_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_reconciliation_kind: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
      bump_session_epoch: { Args: { p_user_id: string }; Returns: undefined }
      cancel_product_import_job: {
        Args: {
          p_actor_user_id: string
          p_import_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      cancel_sync_run_atomic: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_reason: string
          p_sync_run_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
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
      checkpoint_product_import_job: {
        Args: {
          p_checkpoint_row_number: number
          p_import_id: string
          p_lease_seconds: number
          p_organization_id: string
          p_processed_row_count: number
          p_status: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      checkpoint_product_relationship_graph_event_atomic: {
        Args: {
          p_delivery_cursor: string
          p_event_id: string
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          delivery_cursor: string
          error_code: string
          event_id: string
          event_key: string
          graph_version: number
          lease_owner: string
          organization_id: string
          outcome: string
          product_id: string
          retry_count: number
        }[]
      }
      checkpoint_sbom_ingest_job: {
        Args: {
          p_job_id: string
          p_lease_seconds: number
          p_organization_id: string
          p_progress_percent: number
          p_progress_stage: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      checkpoint_vulnerability_feed_sync: {
        Args: {
          p_checkpoint: Json
          p_cursor: string
          p_etag: string
          p_lease_seconds?: number
          p_page_complete: boolean
          p_records_received: number
          p_run_id: string
          p_worker_id: string
        }
        Returns: string
      }
      claim_finding_propagation_job_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          as_of: string
          checkpoint_version: number
          cursor: string
          graph_version: number
          job_id: string
          outcome: string
          retry_count: number
          rule_version: string
          source_baseline_revision_id: string
          source_finding_id: string
          source_release_id: string
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
      claim_product_import_job: {
        Args: {
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
          work: Json
        }[]
      }
      claim_product_import_job_by_id: {
        Args: {
          p_import_id: string
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
          work: Json
        }[]
      }
      claim_product_relationship_graph_event_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          delivery_cursor: string
          error_code: string
          event_id: string
          event_key: string
          graph_version: number
          lease_owner: string
          organization_id: string
          outcome: string
          product_id: string
          retry_count: number
        }[]
      }
      claim_product_security_update_artifact_work_atomic: {
        Args: {
          p_event_type: string
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          artifact: Json
          checkpoint_version: number
          delivery_id: string
          lease_owner: string
          outcome: string
        }[]
      }
      claim_product_support_alert_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          delivery_id: string
          event: Json
          lease_owner: string
          outcome: string
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
      claim_sbom_composite_generation: {
        Args: {
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          work: Json
        }[]
      }
      claim_sbom_diff_report: {
        Args: {
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          work: Json
        }[]
      }
      claim_sbom_ingest_job: {
        Args: {
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
          work: Json
        }[]
      }
      claim_sbom_quality_report: {
        Args: {
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          work: Json
        }[]
      }
      claim_sync_run: {
        Args: {
          p_lease_seconds: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
      claim_vulnerability_feed_sync: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          attempt_count: number
          checkpoint: Json
          correlation_id: string
          feed_key: string
          last_complete_snapshot_at: string
          last_success_at: string
          lease_expires_at: string
          run_id: string
          run_kind: string
          upstream_cursor: string
          upstream_etag: string
        }[]
      }
      claim_vulnerability_finding_review_notification: {
        Args: {
          p_lease_seconds?: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          review_event: Json
        }[]
      }
      claim_vulnerability_kev_alert_delivery: {
        Args: {
          p_lease_seconds?: number
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          alert: Json
          outcome: string
        }[]
      }
      claim_vulnerability_match_job_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      claim_vulnerability_reevaluation_discovery_job_atomic: {
        Args: { p_lease_owner: string; p_lease_seconds: number }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      claim_vulnerability_reevaluation_job_atomic: {
        Args: {
          p_lease_owner: string
          p_lease_seconds: number
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      clear_login_attempts: { Args: { p_email: string }; Returns: undefined }
      commit_product_import_atomic: {
        Args: {
          p_actor_user_id: string
          p_content_hash: string
          p_idempotency_key: string
          p_import_id: string
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      commit_product_import_rows_atomic: {
        Args: {
          p_actor_user_id: string
          p_content_hash: string
          p_idempotency_key: string
          p_import_id: string
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      commit_sync_run_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_fetch_content_hash: string
          p_idempotency_key: string
          p_organization_id: string
          p_sync_run_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
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
      complete_product_import_dry_run: {
        Args: {
          p_content_hash: string
          p_create_count: number
          p_error_code: string
          p_failed_count: number
          p_import_id: string
          p_organization_id: string
          p_report_object_path: string
          p_row_count: number
          p_skipped_count: number
          p_unchanged_count: number
          p_update_count: number
          p_warning_count: number
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      complete_product_relationship_graph_event_atomic: {
        Args: {
          p_event_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          error_code: string
          event_id: string
          event_key: string
          graph_version: number
          lease_owner: string
          organization_id: string
          outcome: string
          product_id: string
          retry_count: number
        }[]
      }
      complete_product_security_update_artifact_cleanup_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_object_removed: boolean
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      complete_product_security_update_artifact_work_atomic: {
        Args: {
          p_delivery_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      complete_product_support_alert_delivery_atomic: {
        Args: {
          p_delivery_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_recipient_user_id: string
        }
        Returns: {
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
      complete_sbom_ingest_job: {
        Args: {
          p_job_id: string
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      complete_security_update_artifact_cleanup_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_object_removed: boolean
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      complete_vulnerability_feed_staging: {
        Args: {
          p_expected_record_count: number
          p_run_id: string
          p_worker_id: string
        }
        Returns: string
      }
      complete_vulnerability_finding_review_notification: {
        Args: {
          p_delivered: boolean
          p_error_code?: string
          p_error_message?: string
          p_organization_id: string
          p_review_event_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      complete_vulnerability_kev_alert_delivery: {
        Args: {
          p_alert_id: string
          p_delivered: boolean
          p_error_code?: string
          p_error_message?: string
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      confirm_vulnerability_offline_bundle_import: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_import_id: string
        }
        Returns: {
          import: Json
          outcome: string
        }[]
      }
      connector_compliance_metrics_snapshot: {
        Args: { p_organization_id: string }
        Returns: {
          connector_circuit_open_count: number
          connector_count: number
          connector_dead_letter_count: number
          connector_open_conflict_count: number
          connector_retry_count: number
          connector_stale_count: number
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
      consume_supplier_sbom_invitation_atomic: {
        Args: {
          p_session_expires_at: string
          p_session_token_hash: string
          p_token_hash: string
        }
        Returns: {
          outcome: string
          session: Json
        }[]
      }
      correct_product_release_market_availability_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_version: number
          p_from_country_code: string
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_release_id: string
          p_to_country_code: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      correct_product_release_placed_on_market_at_atomic: {
        Args: {
          p_actor_user_id: string
          p_corrected_placed_on_market_at: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      create_connector_atomic: {
        Args: {
          p_actor_user_id: string
          p_adapter_version: string
          p_commit_policy: string
          p_connection_config: Json
          p_connector_type: string
          p_display_name: string
          p_idempotency_key: string
          p_mapping_version: string
          p_organization_id: string
        }
        Returns: {
          connector: Json
          outcome: string
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
      create_finding_product_impact_override_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_idempotency_key: string
          p_organization_id: string
          p_override_state: string
          p_product_id: string
          p_provenance: string
          p_reason: string
          p_release_id: string
          p_source: string
          p_source_finding_id: string
        }
        Returns: {
          outcome: string
          override: Json
        }[]
      }
      create_or_resume_sbom_document_normalization_atomic: {
        Args: {
          p_document_id: string
          p_format: string
          p_job_id: string
          p_normalizer_name: string
          p_normalizer_version: string
          p_organization_id: string
          p_parser_name: string
          p_parser_version: string
          p_serialization: string
          p_specification_version: string
          p_worker_id: string
        }
        Returns: {
          document: Json
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
      create_product_atomic: {
        Args: {
          p_actor_user_id: string
          p_description: string
          p_idempotency_key: string
          p_internal_code: string
          p_legal_entity_id: string
          p_name: string
          p_organization_id: string
          p_product_type: string
          p_responsible_owner_id: string
        }
        Returns: {
          outcome: string
          product: Json
        }[]
      }
      create_product_component_link_atomic: {
        Args: {
          p_actor_user_id: string
          p_component_product_id: string
          p_component_release_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_expected_graph_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_parent_product_id: string
          p_parent_release_id: string
          p_provenance: string
          p_quantity: number
          p_reason: string
          p_source: string
        }
        Returns: {
          graph_version: number
          outcome: string
          relationship: Json
        }[]
      }
      create_product_import_job: {
        Args: {
          p_actor_user_id: string
          p_byte_size: number
          p_content_hash: string
          p_correlation_id: string
          p_import_id: string
          p_organization_id: string
          p_original_filename: string
          p_source_object_path: string
          p_upload_idempotency_key: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      create_product_release_atomic: {
        Args: {
          p_actor_user_id: string
          p_description: string
          p_idempotency_key: string
          p_label: string
          p_organization_id: string
          p_product_id: string
          p_release_version: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      create_product_substantial_modification_assessment_atomic: {
        Args: {
          p_actor_user_id: string
          p_answers: Json
          p_correlation_id: string
          p_description: string
          p_detected_or_assessed_at: string
          p_evidence_references: Json
          p_idempotency_key: string
          p_introduced_at: string
          p_modification_id: string
          p_modification_identifier: string
          p_organization_id: string
          p_previous_state: string
          p_product_id: string
          p_rationale: string
          p_release_ids: string[]
          p_required_follow_up_actions: Json
          p_resulting_state: string
          p_suggestion: string
          p_technical_scope: string
          p_title: string
        }
        Returns: {
          assessment: Json
          outcome: string
        }[]
      }
      create_product_substantial_modification_assessment_draft_atomic: {
        Args: {
          p_actor_user_id: string
          p_answers: Json
          p_completeness_state: string
          p_correlation_id: string
          p_description: string
          p_detected_or_assessed_at: string
          p_evidence_references: Json
          p_idempotency_key: string
          p_introduced_at: string
          p_modification_id: string
          p_modification_identifier: string
          p_organization_id: string
          p_previous_state: string
          p_product_id: string
          p_rationale: string
          p_release_ids: string[]
          p_required_follow_up_actions: Json
          p_resulting_state: string
          p_technical_scope: string
          p_title: string
        }
        Returns: {
          assessment: Json
          outcome: string
        }[]
      }
      create_product_support_period_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_lifetime_justification: string
          p_idempotency_key: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_support_ends_at: string
          p_support_starts_at: string
        }
        Returns: {
          outcome: string
          support_period: Json
        }[]
      }
      create_product_variant_relationship_atomic: {
        Args: {
          p_actor_user_id: string
          p_base_release_id: string
          p_baseline_revision_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_expected_graph_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_provenance: string
          p_reason: string
          p_source: string
          p_variant_product_id: string
          p_variant_release_id: string
        }
        Returns: {
          graph_version: number
          outcome: string
          relationship: Json
        }[]
      }
      create_sbom_ci_credential_atomic: {
        Args: {
          p_actor_user_id: string
          p_credential_id: string
          p_label: string
          p_organization_id: string
          p_token_hash: string
          p_token_prefix: string
          p_token_salt: string
        }
        Returns: {
          credential: Json
          outcome: string
        }[]
      }
      create_sbom_composite_review_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_input_set_digest: string
          p_inputs: Json
          p_merge_rules_version: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_review_id: string
        }
        Returns: {
          outcome: string
          review: Json
        }[]
      }
      create_software_baseline_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_description: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_idempotency_key: string
          p_identifier: string
          p_name: string
          p_organization_id: string
          p_provenance: string
          p_revision_summary: string
          p_source: string
        }
        Returns: {
          baseline: Json
          outcome: string
        }[]
      }
      create_supplier_sbom_invitation_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expires_at: string
          p_idempotency_key: string
          p_invitation_id: string
          p_organization_id: string
          p_request_digest: string
          p_request_id: string
          p_token_hash: string
        }
        Returns: {
          invitation: Json
          outcome: string
        }[]
      }
      create_supplier_sbom_request_atomic: {
        Args: {
          p_actor_user_id: string
          p_allowed_component_ref: string
          p_correlation_id: string
          p_expires_at: string
          p_idempotency_key: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_request_digest: string
          p_request_id: string
          p_supplier_display_name: string
        }
        Returns: {
          outcome: string
          request: Json
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
      describe_product_relationship_graph_event_atomic: {
        Args: {
          p_event_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          event: Json
          outcome: string
        }[]
      }
      download_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      end_finding_product_impact_override_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_override_id: string
          p_reason: string
        }
        Returns: {
          outcome: string
          override: Json
        }[]
      }
      end_product_component_link_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_expected_graph_version: number
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_relationship_id: string
        }
        Returns: {
          graph_version: number
          outcome: string
          relationship: Json
        }[]
      }
      end_product_variant_relationship_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_expected_graph_version: number
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_relationship_id: string
        }
        Returns: {
          graph_version: number
          outcome: string
          relationship: Json
        }[]
      }
      end_software_baseline_membership_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_expected_version: number
          p_membership_id: string
          p_organization_id: string
          p_product_id: string
          p_reason: string
        }
        Returns: {
          membership: Json
          outcome: string
        }[]
      }
      enqueue_finding_propagation_source_page_atomic: {
        Args: {
          p_as_of: string
          p_cursor: string
          p_event_key: string
          p_graph_version: number
          p_organization_id: string
          p_page_size: number
          p_scope_kind: string
          p_source_baseline_revision_id: string
          p_source_product_id: string
          p_source_release_id: string
        }
        Returns: {
          next_cursor: string
          outcome: string
          source_count: number
        }[]
      }
      enqueue_sbom_diff_report_atomic: {
        Args: {
          p_baseline_source_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          report: Json
        }[]
      }
      enqueue_sbom_quality_assessment_atomic: {
        Args: {
          p_document_id: string
          p_job_id: string
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          report: Json
        }[]
      }
      enqueue_sbom_quality_report_atomic: {
        Args: {
          p_document_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          report: Json
        }[]
      }
      enqueue_vulnerability_match_job_atomic: {
        Args: {
          p_correlation_id: string
          p_document_id: string
          p_organization_id: string
          p_release_id: string
          p_requested_by?: string
        }
        Returns: {
          job_id: string
          outcome: string
        }[]
      }
      enqueue_vulnerability_reevaluation_for_source_version: {
        Args: { p_correlation_id: string; p_source_record_version_id: string }
        Returns: {
          job_id: string
          outcome: string
        }[]
      }
      ensure_organization_branding_draft: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: undefined
      }
      ensure_sbom_component_diff_identities_atomic: {
        Args: {
          p_document_id: string
          p_limit: number
          p_organization_id: string
        }
        Returns: {
          inserted_count: number
          outcome: string
        }[]
      }
      expire_product_import_jobs: {
        Args: { p_batch_size: number; p_organization_id: string }
        Returns: {
          expired_count: number
        }[]
      }
      expire_stale_invitations: { Args: never; Returns: number }
      fail_finding_propagation_job_atomic: {
        Args: {
          p_error_code: string
          p_expected_checkpoint_version: number
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
        }
        Returns: {
          checkpoint_version: number
          error_code: string
          outcome: string
        }[]
      }
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
      fail_product_import_job: {
        Args: {
          p_error_code: string
          p_import_id: string
          p_organization_id: string
          p_retryable: boolean
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      fail_product_relationship_graph_event_atomic: {
        Args: {
          p_error_code: string
          p_event_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
        }
        Returns: {
          checkpoint_version: number
          error_code: string
          event_id: string
          event_key: string
          graph_version: number
          lease_owner: string
          organization_id: string
          outcome: string
          product_id: string
          retry_count: number
        }[]
      }
      fail_product_security_update_artifact_work_atomic: {
        Args: {
          p_code: string
          p_delivery_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
        }
        Returns: {
          outcome: string
        }[]
      }
      fail_product_support_alert_delivery_atomic: {
        Args: {
          p_code: string
          p_delivery_id: string
          p_expected_checkpoint_version: number
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
        }
        Returns: {
          outcome: string
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
      fail_sbom_composite_generation_atomic: {
        Args: {
          p_error_code: string
          p_message: string
          p_organization_id: string
          p_review_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      fail_sbom_diff_report: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_organization_id: string
          p_report_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      fail_sbom_ingest_job: {
        Args: {
          p_error_code: string
          p_job_id: string
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      fail_sbom_quality_report: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_organization_id: string
          p_report_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      fail_sync_run_atomic: {
        Args: {
          p_error_code: string
          p_organization_id: string
          p_sync_run_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
      fail_vulnerability_feed_sync: {
        Args: {
          p_failure_code: string
          p_failure_reason: string
          p_retry_after_seconds?: number
          p_run_id: string
          p_worker_id: string
        }
        Returns: string
      }
      fail_vulnerability_match_job_atomic: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_expected_checkpoint_version: number
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
        }
        Returns: {
          checkpoint_version: number
          error_code: string
          outcome: string
        }[]
      }
      fail_vulnerability_reevaluation_discovery_job_atomic: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_expected_checkpoint_version: number
          p_job_id: string
          p_lease_owner: string
          p_retryable: boolean
        }
        Returns: {
          checkpoint_version: number
          outcome: string
        }[]
      }
      fail_vulnerability_reevaluation_job_atomic: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_expected_checkpoint_version: number
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_retryable: boolean
        }
        Returns: {
          checkpoint_version: number
          outcome: string
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
      finalize_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_integrity_status: string
          p_organization_id: string
          p_product_id: string
          p_verified_byte_size: number
          p_verified_content_type: string
          p_verified_sha256: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      finalize_product_security_update_artifact_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_integrity_status: string
          p_organization_id: string
          p_product_id: string
          p_verified_byte_size: number
          p_verified_content_type: string
          p_verified_sha256: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      finalize_sbom_document_normalization_atomic: {
        Args: {
          p_document_id: string
          p_job_id: string
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          document: Json
          outcome: string
        }[]
      }
      finalize_sbom_source_atomic:
        | {
            Args: {
              p_actor_credential_id: string
              p_actor_user_id: string
              p_actual_byte_size: number
              p_actual_media_type: string
              p_actual_sha256: string
              p_correlation_id: string
              p_organization_id: string
              p_source_id: string
            }
            Returns: {
              job: Json
              outcome: string
              source: Json
            }[]
          }
        | {
            Args: {
              p_actor_credential_id: string
              p_actor_user_id: string
              p_actual_byte_size: number
              p_actual_media_type: string
              p_actual_sha256: string
              p_correlation_id: string
              p_idempotency_key: string
              p_organization_id: string
              p_source_id: string
            }
            Returns: {
              job: Json
              outcome: string
              source: Json
            }[]
          }
      finalize_sbom_source_deduplicated_atomic: {
        Args: {
          p_actor_credential_id: string
          p_actor_user_id: string
          p_actual_byte_size: number
          p_actual_media_type: string
          p_actual_sha256: string
          p_correlation_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          job: Json
          outcome: string
          source: Json
        }[]
      }
      finalize_supplier_sbom_submission_atomic: {
        Args: {
          p_actual_byte_size: number
          p_actual_media_type: string
          p_actual_sha256: string
          p_correlation_id: string
          p_idempotency_key: string
          p_session_token_hash: string
          p_source_id: string
        }
        Returns: {
          job: Json
          outcome: string
          source: Json
          submission: Json
        }[]
      }
      generate_sbom_composite_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_review_id: string
        }
        Returns: {
          outcome: string
          review: Json
        }[]
      }
      get_current_user_id: { Args: never; Returns: string }
      get_finding_product_impact_summary: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          summary: Json
        }[]
      }
      get_m2_member_states: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          member_states: Json
          outcome: string
        }[]
      }
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
      get_organization_branding_published_logo_render: {
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
      get_organization_sbom_quality_settings: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          outcome: string
          result: Json
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
      get_organization_support_alert_intervals: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          intervals: Json
          outcome: string
        }[]
      }
      get_product: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          outcome: string
          product: Json
        }[]
      }
      get_product_component_links: {
        Args: {
          p_actor_user_id: string
          p_as_of?: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          links: Json
          outcome: string
        }[]
      }
      get_product_import_cleanup_candidates: {
        Args: { p_batch_size: number; p_organization_id: string }
        Returns: {
          import_id: string
          report_object_path: string
          source_object_path: string
        }[]
      }
      get_product_import_job: {
        Args: {
          p_actor_user_id: string
          p_import_id: string
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      get_product_relationship_graph: {
        Args: {
          p_actor_user_id: string
          p_as_of: string
          p_include_ended: boolean
          p_max_depth: number
          p_organization_id: string
          p_product_id: string
          p_root_release_id: string
        }
        Returns: {
          graph: Json
          outcome: string
        }[]
      }
      get_product_relationship_propagation_candidates: {
        Args: {
          p_actor_user_id: string
          p_as_of: string
          p_cursor: string
          p_graph_version: number
          p_organization_id: string
          p_page_size: number
          p_source_baseline_revision_id: string
          p_source_release_id: string
        }
        Returns: {
          candidates: Json
          outcome: string
        }[]
      }
      get_product_relationship_propagation_candidates_system: {
        Args: {
          p_as_of: string
          p_cursor: string
          p_graph_version: number
          p_organization_id: string
          p_page_size: number
          p_source_baseline_revision_id: string
          p_source_release_id: string
        }
        Returns: {
          candidates: Json
          outcome: string
        }[]
      }
      get_product_relationship_propagation_events: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_delivery_state: string
          p_organization_id: string
          p_page_size: number
          p_product_id: string
        }
        Returns: {
          events: Json
          outcome: string
        }[]
      }
      get_product_release: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      get_product_release_lifecycle_timeline: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          timeline: Json
        }[]
      }
      get_product_release_market_availability: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          market_availability: Json
          outcome: string
        }[]
      }
      get_product_retention_calculation: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          outcome: string
          retention: Json
        }[]
      }
      get_product_retention_worker_now: {
        Args: never
        Returns: {
          database_now: string
          outcome: string
        }[]
      }
      get_product_security_update_artifact: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      get_product_software_baseline_memberships: {
        Args: {
          p_actor_user_id: string
          p_as_of?: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          memberships: Json
          outcome: string
        }[]
      }
      get_product_substantial_modification_assessment: {
        Args: {
          p_actor_user_id: string
          p_assessment_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          assessment: Json
          outcome: string
        }[]
      }
      get_product_support_alert_history: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          alerts: Json
          outcome: string
        }[]
      }
      get_product_support_alert_owner_or_admin_recipient: {
        Args: { p_organization_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_product_support_alert_product_owner_recipient: {
        Args: { p_organization_id: string; p_product_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_product_support_periods: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          outcome: string
          support_periods: Json
        }[]
      }
      get_product_variant_relationships: {
        Args: {
          p_actor_user_id: string
          p_as_of?: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          outcome: string
          relationships: Json
        }[]
      }
      get_sbom_composite_review: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_review_id: string
        }
        Returns: {
          outcome: string
          review: Json
        }[]
      }
      get_sbom_diff_findings:
        | {
            Args: {
              p_actor_user_id: string
              p_organization_id: string
              p_report_id: string
            }
            Returns: {
              outcome: string
              result: Json
            }[]
          }
        | {
            Args: {
              p_actor_user_id: string
              p_cursor: string
              p_limit: number
              p_organization_id: string
              p_report_id: string
            }
            Returns: {
              outcome: string
              result: Json
            }[]
          }
      get_sbom_diff_report: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_report_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_sbom_document: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_sbom_ingest_job: {
        Args: {
          p_actor_user_id: string
          p_job_id: string
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      get_sbom_quality_report: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_sbom_quality_settings: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_sbom_source_diff_report: {
        Args: {
          p_actor_user_id: string
          p_baseline_source_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_sbom_source_download: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          storage_bucket: string
          storage_key: string
        }[]
      }
      get_sbom_source_for_completion: {
        Args: {
          p_actor_credential_id: string
          p_actor_user_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          source: Json
          storage_bucket: string
          storage_key: string
        }[]
      }
      get_sbom_validation_report: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          report: Json
          source: Json
        }[]
      }
      get_software_baseline_history: {
        Args: {
          p_actor_user_id: string
          p_baseline_id: string
          p_organization_id: string
        }
        Returns: {
          baselines: Json
          outcome: string
        }[]
      }
      get_supplier_sbom_submission_upload: {
        Args: {
          p_idempotency_key: string
          p_session_token_hash: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          source: Json
        }[]
      }
      get_supplier_sbom_submission_upload_atomic: {
        Args: { p_session_token_hash: string; p_source_id: string }
        Returns: {
          outcome: string
          reservation: Json
        }[]
      }
      get_vulnerability_csaf_reconciliation_detail: {
        Args: { p_canonical_id: string }
        Returns: Json
      }
      get_vulnerability_finding_advisory_review: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_finding_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_vulnerability_finding_reachability_evidence: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_finding_id: string
          p_include_stale?: boolean
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_vulnerability_finding_review_notification_details: {
        Args: { p_event_id: string; p_organization_id: string }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_vulnerability_kev_alert_notification_details: {
        Args: { p_alert_id: string; p_organization_id: string }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_vulnerability_match_status: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      get_vulnerability_offline_bundle_import: {
        Args: { p_import_id: string }
        Returns: {
          import: Json
          outcome: string
        }[]
      }
      is_iso_3166_alpha_2: { Args: { p_country: string }; Returns: boolean }
      is_login_locked: { Args: { p_email: string }; Returns: string }
      link_external_identity_atomic: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_cra_product_id: string
          p_cra_release_id: string
          p_entity_type: string
          p_external_display_label: string
          p_external_id: string
          p_match_method: string
          p_organization_id: string
        }
        Returns: {
          mapping: Json
          outcome: string
        }[]
      }
      list_due_finding_propagation_job_organizations: {
        Args: never
        Returns: {
          organization_id: string
        }[]
      }
      list_due_product_import_organizations: {
        Args: { p_limit: number }
        Returns: {
          oldest_due_at: string
          organization_id: string
        }[]
      }
      list_due_product_relationship_graph_event_organizations: {
        Args: never
        Returns: {
          organization_id: string
        }[]
      }
      list_due_product_security_update_artifact_organizations: {
        Args: never
        Returns: {
          organization_id: string
        }[]
      }
      list_due_product_support_alert_organizations: {
        Args: never
        Returns: {
          organization_id: string
        }[]
      }
      list_due_sbom_composite_generation_organizations: {
        Args: { p_limit: number }
        Returns: {
          organization_id: string
        }[]
      }
      list_due_sbom_diff_organizations: {
        Args: { p_limit: number }
        Returns: {
          oldest_due_at: string
          organization_id: string
        }[]
      }
      list_due_sbom_ingest_organizations: {
        Args: { p_limit: number }
        Returns: {
          oldest_due_at: string
          organization_id: string
        }[]
      }
      list_due_sbom_quality_organizations: {
        Args: { p_limit: number }
        Returns: {
          organization_id: string
        }[]
      }
      list_due_sync_run_organizations: {
        Args: { p_limit: number }
        Returns: {
          oldest_due_at: string
          organization_id: string
        }[]
      }
      list_due_vulnerability_finding_review_notification_orgs: {
        Args: { p_limit?: number }
        Returns: {
          organization_id: string
        }[]
      }
      list_due_vulnerability_kev_alert_organizations: {
        Args: { p_limit?: number }
        Returns: {
          organization_id: string
        }[]
      }
      list_due_vulnerability_match_organizations: {
        Args: { p_limit?: number }
        Returns: {
          organization_id: string
        }[]
      }
      list_due_vulnerability_reevaluation_organizations: {
        Args: { p_limit?: number }
        Returns: {
          organization_id: string
        }[]
      }
      list_field_authority_policies: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
          policies: Json
        }[]
      }
      list_product_import_jobs: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_page: number
          p_page_size: number
          p_status: string
        }
        Returns: {
          imports: Json
          outcome: string
        }[]
      }
      list_product_import_rows: {
        Args: {
          p_actor_user_id: string
          p_import_id: string
          p_organization_id: string
          p_page: number
          p_page_size: number
          p_result: string
        }
        Returns: {
          outcome: string
          rows: Json
        }[]
      }
      list_product_releases: {
        Args: {
          p_actor_user_id: string
          p_archived: boolean
          p_lifecycle: string
          p_organization_id: string
          p_page: number
          p_page_size: number
          p_product_id: string
        }
        Returns: {
          outcome: string
          releases: Json
        }[]
      }
      list_product_security_update_artifacts: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_page: number
          p_page_size: number
          p_product_id: string
          p_publication_status: string
          p_release_id: string
        }
        Returns: {
          artifacts: Json
          outcome: string
        }[]
      }
      list_product_substantial_modification_assessments: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_page: number
          p_page_size: number
          p_product_id: string
          p_release_id: string
          p_status: string
        }
        Returns: {
          assessments: Json
          outcome: string
        }[]
      }
      list_products: {
        Args: {
          p_actor_user_id: string
          p_archived: boolean
          p_organization_id: string
          p_page: number
          p_page_size: number
          p_product_type: string
          p_q: string
          p_responsible_owner_id: string
        }
        Returns: {
          outcome: string
          products: Json
        }[]
      }
      list_sbom_dependency_tree: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_document_id: string
          p_limit: number
          p_organization_id: string
          p_parent_component_id: string
          p_q: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_sbom_diff_component_changes: {
        Args: {
          p_actor_user_id: string
          p_change_type: string
          p_cursor: string
          p_ecosystem: string
          p_limit: number
          p_organization_id: string
          p_q: string
          p_report_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_sbom_diff_component_facts: {
        Args: {
          p_cursor: string
          p_limit: number
          p_organization_id: string
          p_report_id: string
          p_side: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_sbom_documents_for_release: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_limit: number
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_sbom_quality_component_facts: {
        Args: {
          p_cursor: string
          p_document_id: string
          p_limit: number
          p_organization_id: string
          p_report_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_sbom_quality_findings: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_kind: string
          p_limit: number
          p_organization_id: string
          p_severity: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_sbom_sources_for_release: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_limit: number
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          next_cursor: string
          outcome: string
          sources: Json
        }[]
      }
      list_software_baselines: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_include_archived: boolean
          p_organization_id: string
          p_page_size: number
          p_query: string
        }
        Returns: {
          baselines: Json
          outcome: string
        }[]
      }
      list_supplier_sbom_requests: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_limit: number
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_state: string
        }
        Returns: {
          next_cursor: string
          outcome: string
          requests: Json
        }[]
      }
      list_supplier_sbom_submissions: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_limit: number
          p_organization_id: string
          p_request_id: string
          p_state: string
        }
        Returns: {
          next_cursor: string
          outcome: string
          submissions: Json
        }[]
      }
      list_vulnerability_enriched_findings_for_document_page: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_include_low_confidence: boolean
          p_organization_id: string
          p_page?: number
          p_page_size?: number
          p_q?: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_vulnerability_enriched_findings_for_document_page_baseline: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_include_low_confidence: boolean
          p_organization_id: string
          p_page?: number
          p_page_size?: number
          p_q?: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_vulnerability_enriched_findings_for_document_page_intellig: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_include_low_confidence: boolean
          p_organization_id: string
          p_page?: number
          p_page_size?: number
          p_q?: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_vulnerability_feed_sync_runs: {
        Args: { p_feed_key?: string; p_limit?: number; p_offset?: number }
        Returns: {
          attempt_count: number
          completed_at: string
          correlation_id: string
          created_at: string
          dead_lettered_at: string
          failure_code: string
          failure_reason: string
          feed_key: string
          id: string
          max_attempts: number
          next_attempt_at: string
          records_promoted: number
          records_received: number
          run_kind: string
          started_at: string
          status: string
          total_count: number
          updated_at: string
        }[]
      }
      list_vulnerability_finding_reevaluation_history: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_finding_id: string
          p_organization_id: string
          p_page?: number
          p_page_size?: number
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_vulnerability_findings_for_document: {
        Args: {
          p_actor_user_id: string
          p_cursor?: string
          p_document_id: string
          p_include_low_confidence: boolean
          p_limit?: number
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_vulnerability_match_components: {
        Args: {
          p_job_id: string
          p_lease_owner: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: {
          component: Json
        }[]
      }
      list_vulnerability_match_csaf_cpe_candidates: {
        Args: {
          p_cpe_part: string
          p_cpe_product: string
          p_cpe_vendor: string
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          candidate: Json
        }[]
      }
      list_vulnerability_match_csaf_purl_candidates: {
        Args: {
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_purl_name: string
          p_purl_namespace: string
          p_purl_type: string
        }
        Returns: {
          candidate: Json
        }[]
      }
      list_vulnerability_match_nvd_candidates: {
        Args: {
          p_cpe_part: string
          p_cpe_product: string
          p_cpe_vendor: string
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
        }
        Returns: {
          candidate: Json
        }[]
      }
      list_vulnerability_match_osv_candidates: {
        Args: {
          p_ecosystem: string
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_purl_name: string
          p_purl_namespace: string
          p_purl_type: string
        }
        Returns: {
          candidate: Json
        }[]
      }
      list_vulnerability_match_results_for_document_page: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_include_low_confidence: boolean
          p_include_reviewable: boolean
          p_organization_id: string
          p_page?: number
          p_page_size?: number
          p_q?: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      list_vulnerability_reevaluation_candidate_organizations: {
        Args: {
          p_after_organization_id?: string
          p_job_id: string
          p_lease_owner: string
          p_limit?: number
        }
        Returns: {
          organization_id: string
        }[]
      }
      list_vulnerability_reevaluation_candidates: {
        Args: {
          p_job_id: string
          p_lease_owner: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: {
          candidate: Json
        }[]
      }
      list_vulnerability_reevaluation_candidates_m4_06: {
        Args: {
          p_job_id: string
          p_lease_owner: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: {
          candidate: Json
        }[]
      }
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
      m2_active_member: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: boolean
      }
      m2_active_support_period: {
        Args: {
          p_organization_id: string
          p_product_id: string
          p_release_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          decision_actor_id: string
          effective_at: string
          expected_lifetime_justification: string
          id: string
          idempotency_key: string | null
          idempotency_request_digest: string | null
          organization_id: string
          product_id: string
          release_id: string | null
          scope_revision: number
          superseded_at: string | null
          superseded_by_id: string | null
          support_ends_at: string
          support_starts_at: string
          updated_at: string
          updated_by: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "product_support_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      m2_assert_no_legacy_release_lifecycle: { Args: never; Returns: undefined }
      m2_audit_release_command_rejection: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_attempt: Json
          p_before: Json
          p_correlation_id: string
          p_error_code: string
          p_organization_id: string
          p_release_id: string
        }
        Returns: undefined
      }
      m2_baseline_membership_json: {
        Args: {
          p_membership: Database["public"]["Tables"]["software_baseline_release_memberships"]["Row"]
        }
        Returns: Json
      }
      m2_bump_relationship_graph: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: number
      }
      m2_component_link_preview: {
        Args: {
          p_component_product_id: string
          p_effective_at: string
          p_excluding_relationship_id?: string
          p_graph_version: number
          p_organization_id: string
          p_parent_product_id: string
        }
        Returns: Json
      }
      m2_emit_product_regulatory_event: {
        Args: {
          p_correlation_id: string
          p_event_type: string
          p_organization_id: string
          p_payload: Json
          p_product_id: string
          p_release_id: string
          p_release_version: number
        }
        Returns: string
      }
      m2_finding_override_json: {
        Args: {
          p_override: Database["public"]["Tables"]["finding_product_impact_overrides"]["Row"]
        }
        Returns: Json
      }
      m2_lock_relationship_graph: {
        Args: {
          p_actor_user_id: string
          p_expected_graph_version: number
          p_organization_id: string
        }
        Returns: {
          graph_version: number
          outcome: string
        }[]
      }
      m2_market_availability_item_json: {
        Args: {
          p_availability: Database["public"]["Tables"]["product_release_market_availability"]["Row"]
        }
        Returns: Json
      }
      m2_market_availability_json: {
        Args: { p_organization_id: string; p_release_id: string }
        Returns: Json
      }
      m2_member_states_json: { Args: never; Returns: Json }
      m2_normalize_retention_calculation: {
        Args: { p_calculation: Json }
        Returns: Json
      }
      m2_parse_utc_z: { Args: { p_value: string }; Returns: string }
      m2_product_import_job_export_json: {
        Args: {
          p_job: Database["public"]["Tables"]["product_import_jobs"]["Row"]
        }
        Returns: Json
      }
      m2_product_import_row_export_json: {
        Args: {
          p_row: Database["public"]["Tables"]["product_import_rows"]["Row"]
        }
        Returns: Json
      }
      m2_product_json: {
        Args: { p_organization_id: string; p_product_id: string }
        Returns: Json
      }
      m2_product_relationship_json: {
        Args: {
          p_relationship: Database["public"]["Tables"]["product_relationships"]["Row"]
        }
        Returns: Json
      }
      m2_read_product_retention_calculation: {
        Args: { p_organization_id: string; p_product_id: string }
        Returns: Json
      }
      m2_recalculate_product_retention_atomic: {
        Args: {
          p_actor_user_id: string
          p_allow_protection_reduction?: boolean
          p_organization_id: string
          p_product_id: string
        }
        Returns: Json
      }
      m2_reconcile_product_entity: {
        Args: {
          p_actor_user_id: string
          p_legal_entity_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      m2_record_retention_recalculation: {
        Args: {
          p_actor_user_id: string
          p_cause: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: undefined
      }
      m2_relationship_digest: { Args: { p_payload: Json }; Returns: string }
      m2_relationship_graph_event_atomic: {
        Args: {
          p_correlation_id: string
          p_graph_version: number
          p_organization_id: string
          p_payload: Json
          p_product_id: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: undefined
      }
      m2_relationship_outbox_event_json: {
        Args: {
          p_event: Database["public"]["Tables"]["product_regulatory_outbox_events"]["Row"]
        }
        Returns: Json
      }
      m2_release_json: {
        Args: { p_organization_id: string; p_release_id: string }
        Returns: Json
      }
      m2_release_timeline_json: {
        Args: { p_organization_id: string; p_release_id: string }
        Returns: Json
      }
      m2_retention_placement_candidate: {
        Args: { p_placed_at: string }
        Returns: string
      }
      m2_schedule_support_alerts: {
        Args: {
          p_correlation_id: string
          p_organization_id: string
          p_period: Database["public"]["Tables"]["product_support_periods"]["Row"]
          p_product_id: string
        }
        Returns: undefined
      }
      m2_software_baseline_json: {
        Args: {
          p_baseline: Database["public"]["Tables"]["software_baselines"]["Row"]
        }
        Returns: Json
      }
      m2_support_period_command_digest: {
        Args: { p_payload: Json }
        Returns: string
      }
      m2_support_period_json: {
        Args: {
          p_period: Database["public"]["Tables"]["product_support_periods"]["Row"]
        }
        Returns: Json
      }
      m2_support_preview_json: {
        Args: {
          p_current: Database["public"]["Tables"]["product_support_periods"]["Row"]
          p_expected_lifetime_justification: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_support_ends_at: string
          p_support_starts_at: string
        }
        Returns: Json
      }
      m2_utc_z: { Args: { p_value: string }; Returns: string }
      m2_v2_assessment_json: {
        Args: {
          p_assessment: Database["public"]["Tables"]["product_substantial_modification_assessments"]["Row"]
        }
        Returns: Json
      }
      m2_v2_assessment_payload_complete: {
        Args: {
          p_answers: Json
          p_description: string
          p_detected_or_assessed_at: string
          p_introduced_at: string
          p_modification_identifier: string
          p_previous_state: string
          p_rationale: string
          p_required_follow_up_actions: Json
          p_resulting_state: string
          p_technical_scope: string
          p_title: string
        }
        Returns: boolean
      }
      m2_v2_availability_candidate: {
        Args: { p_issued_at: string }
        Returns: string
      }
      m2_v2_command_digest: { Args: { p_payload: Json }; Returns: string }
      m2_v2_connector_json: {
        Args: { p_connector: Database["public"]["Tables"]["connectors"]["Row"] }
        Returns: Json
      }
      m2_v2_external_identity_json: {
        Args: {
          p_identity: Database["public"]["Tables"]["product_external_identities"]["Row"]
        }
        Returns: Json
      }
      m2_v2_field_authority_policy_preview_digest: {
        Args: {
          p_connector_id: string
          p_entity_type: string
          p_field_name: string
          p_organization_id: string
          p_policy_value: string
          p_protected: boolean
          p_protected_reason: string
        }
        Returns: string
      }
      m2_v2_record_security_update_artifact_worker_effect: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_operation: string
          p_organization_id: string
          p_source_updated_by: string
          p_worker_actor: string
        }
        Returns: undefined
      }
      m2_v2_resolve_security_update_artifact_worker_actor: {
        Args: { p_organization_id: string }
        Returns: string
      }
      m2_v2_security_update_artifact_json: {
        Args: {
          p_artifact: Database["public"]["Tables"]["product_security_update_artifacts"]["Row"]
          p_include_object_key?: boolean
        }
        Returns: Json
      }
      m2_v2_set_artifact_retention_fact: {
        Args: {
          p_artifact: Database["public"]["Tables"]["product_security_update_artifacts"]["Row"]
        }
        Returns: undefined
      }
      m2_v2_set_assessment_retention_fact: {
        Args: {
          p_assessment: Database["public"]["Tables"]["product_substantial_modification_assessments"]["Row"]
        }
        Returns: undefined
      }
      m2_v2_set_lifecycle_dependency_fact: {
        Args: {
          p_active: boolean
          p_actor_user_id: string
          p_authority_kind: string
          p_organization_id: string
          p_product_id: string
          p_record_id: string
          p_release_id: string
        }
        Returns: undefined
      }
      m2_v2_sync_conflict_json: {
        Args: {
          p_conflict: Database["public"]["Tables"]["sync_conflicts"]["Row"]
        }
        Returns: Json
      }
      m2_v2_sync_field_external_value: {
        Args: { p_field_diffs: Json; p_field_name: string }
        Returns: Json
      }
      m2_v2_sync_run_json: {
        Args: { p_run: Database["public"]["Tables"]["sync_runs"]["Row"] }
        Returns: Json
      }
      m2_v2_sync_text_field_value: {
        Args: { p_allow_null: boolean; p_field_name: string; p_value: Json }
        Returns: string
      }
      m2_v2_valid_assessment_answers: {
        Args: { p_answers: Json }
        Returns: boolean
      }
      m2_v2_valid_field_authority_field: {
        Args: { p_entity_type: string; p_field_name: string }
        Returns: boolean
      }
      m2_v2_valid_published_external_references: {
        Args: { p_references: Json }
        Returns: boolean
      }
      m2_v2_valid_sync_field_diffs: {
        Args: { p_field_diffs: Json }
        Returns: boolean
      }
      m2_valid_support_alert_intervals: {
        Args: { p_values: number[] }
        Returns: boolean
      }
      m4_03_actor_can_edit_findings: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: boolean
      }
      m4_03_current_kev_evidence: {
        Args: { p_vulnerability_id: string }
        Returns: {
          listing_date: string
          material_fingerprint: string
          source_record_id: string
          source_record_version_id: string
        }[]
      }
      m4_03_intelligence_json: {
        Args: { p_assessed_at: string; p_vulnerability_id: string }
        Returns: Json
      }
      m4_03_intelligence_with_provenance_json: {
        Args: { p_assessed_at: string; p_vulnerability_id: string }
        Returns: Json
      }
      m4_03_kev_alert_json: {
        Args: { p_alert_id: string; p_organization_id: string }
        Returns: Json
      }
      mark_mfa_factors_removed: {
        Args: { p_operation_id: string; p_user_id: string }
        Returns: string
      }
      mark_product_import_objects_deleted: {
        Args: {
          p_import_id: string
          p_organization_id: string
          p_report_deleted: boolean
          p_source_deleted: boolean
        }
        Returns: {
          outcome: string
        }[]
      }
      mark_product_import_stale_conflict: {
        Args: {
          p_error_code: string
          p_import_id: string
          p_organization_id: string
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      mark_vulnerability_reachability_stale_for_finding: {
        Args: {
          p_finding_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: number
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
      materialize_sbom_composite_projection: {
        Args: { p_organization_id: string; p_review_id: string }
        Returns: undefined
      }
      merge_external_identities_atomic: {
        Args: {
          p_actor_user_id: string
          p_keep_mapping_id: string
          p_merge_from_mapping_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          outcome: string
        }[]
      }
      monitor_product_security_update_external_reference_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_monitor_outcome: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      monitor_security_update_external_reference_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_monitor_outcome: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      obsolete_finding_propagation_job_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          checkpoint_version: number
          outcome: string
        }[]
      }
      persist_finding_propagation_page_atomic: {
        Args: {
          p_candidates: Json
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_next_cursor: string
          p_organization_id: string
        }
        Returns: {
          checkpoint_version: number
          outcome: string
          processed_count: number
          superseded_count: number
          upserted_count: number
        }[]
      }
      persist_sbom_diff_batch_atomic: {
        Args: {
          p_changes: Json
          p_checkpoint: Json
          p_complete: boolean
          p_organization_id: string
          p_report_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          report: Json
        }[]
      }
      persist_sbom_normalization_batch_atomic: {
        Args: {
          p_components: Json
          p_diagnostics: Json
          p_document_id: string
          p_edges: Json
          p_job_id: string
          p_organization_id: string
          p_source_offset: number
          p_worker_id: string
        }
        Returns: {
          outcome: string
        }[]
      }
      persist_sbom_quality_report_atomic: {
        Args: {
          p_complete: boolean
          p_findings: Json
          p_organization_id: string
          p_report: Json
          p_report_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          report: Json
        }[]
      }
      persist_vulnerability_csaf_reevaluation_page_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_next_occurrence_id: string
          p_organization_id: string
          p_transitions: Json
        }
        Returns: {
          checkpoint_version: number
          created_count: number
          outcome: string
          processed_count: number
          review_required_count: number
        }[]
      }
      persist_vulnerability_match_page_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_processed_component_ids: Json
          p_results: Json
        }
        Returns: {
          checkpoint_version: number
          matched_count: number
          outcome: string
          processed_count: number
          reviewable_count: number
          superseded_count: number
        }[]
      }
      persist_vulnerability_match_page_atomic_unchecked: {
        Args: {
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_organization_id: string
          p_processed_component_ids: Json
          p_results: Json
        }
        Returns: {
          checkpoint_version: number
          matched_count: number
          outcome: string
          processed_count: number
          reviewable_count: number
          superseded_count: number
        }[]
      }
      persist_vulnerability_reevaluation_discovery_page_atomic: {
        Args: {
          p_after_organization_id: string
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_organization_ids: string[]
        }
        Returns: {
          checkpoint_version: number
          outcome: string
        }[]
      }
      persist_vulnerability_reevaluation_page_atomic: {
        Args: {
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_next_occurrence_id: string
          p_organization_id: string
          p_transitions: Json
        }
        Returns: {
          checkpoint_version: number
          created_count: number
          outcome: string
          processed_count: number
          review_required_count: number
        }[]
      }
      persist_vulnerability_reevaluation_page_atomic_m4_06: {
        Args: {
          p_expected_checkpoint_version: number
          p_is_final: boolean
          p_job_id: string
          p_lease_owner: string
          p_next_occurrence_id: string
          p_organization_id: string
          p_transitions: Json
        }
        Returns: {
          checkpoint_version: number
          created_count: number
          outcome: string
          processed_count: number
          review_required_count: number
        }[]
      }
      preflight_vulnerability_offline_bundle_import: {
        Args: {
          p_actor_user_id: string
          p_bundle_id: string
          p_bundle_version: string
          p_correlation_id: string
          p_idempotency_key: string
          p_manifest: Json
          p_manifest_sha256: string
          p_payloads: Json
          p_signing_key_id: string
          p_staging_worker_id: string
          p_verification_receipt: Json
        }
        Returns: {
          import: Json
          outcome: string
        }[]
      }
      preview_field_authority_policy: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_entity_type: string
          p_field_name: string
          p_organization_id: string
          p_policy_value: string
          p_protected: boolean
          p_protected_reason: string
        }
        Returns: {
          outcome: string
          preview: Json
        }[]
      }
      preview_product_component_link: {
        Args: {
          p_actor_user_id: string
          p_component_product_id: string
          p_component_release_id: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_expected_graph_version: number
          p_organization_id: string
          p_parent_product_id: string
          p_parent_release_id: string
          p_provenance: string
          p_quantity: number
          p_reason: string
          p_source: string
        }
        Returns: {
          outcome: string
          preview: Json
        }[]
      }
      preview_product_support_period_change: {
        Args: {
          p_actor_user_id: string
          p_expected_lifetime_justification: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_support_ends_at: string
          p_support_starts_at: string
        }
        Returns: {
          outcome: string
          preview: Json
        }[]
      }
      product_compliance_metrics_snapshot: {
        Args: { p_organization_id: string }
        Returns: {
          artifact_availability_blocked: number
          artifact_expiring_availability: number
          artifact_hash_mismatch: number
          artifact_provider_unavailable: number
          artifact_quarantine: number
          artifact_upload_failed: number
          artifact_upload_missing: number
          assessment_backlog: number
          flagged_assessments: number
        }[]
      }
      product_import_commit_references_valid: {
        Args: { p_import_id: string; p_organization_id: string }
        Returns: boolean
      }
      product_import_issue_code_is_valid: {
        Args: { p_code: string }
        Returns: boolean
      }
      product_import_issues_are_safe: {
        Args: { p_issues: Json }
        Returns: boolean
      }
      product_import_job_json: {
        Args: { p_import_id: string; p_organization_id: string }
        Returns: Json
      }
      product_import_row_json: {
        Args: {
          p_row: Database["public"]["Tables"]["product_import_rows"]["Row"]
        }
        Returns: Json
      }
      promote_vulnerability_feed_sync: {
        Args: { p_run_id: string; p_worker_id: string }
        Returns: {
          health: Json
          outcome: string
        }[]
      }
      promote_vulnerability_feed_sync_m4_01: {
        Args: { p_run_id: string; p_worker_id: string }
        Returns: {
          health: Json
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
      publish_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_published_external_references: Json
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      reassess_product_substantial_modification_atomic: {
        Args: {
          p_actor_user_id: string
          p_answers: Json
          p_assessment_id: string
          p_correlation_id: string
          p_description: string
          p_detected_or_assessed_at: string
          p_evidence_references: Json
          p_expected_version: number
          p_idempotency_key: string
          p_introduced_at: string
          p_modification_identifier: string
          p_organization_id: string
          p_previous_state: string
          p_product_id: string
          p_rationale: string
          p_release_ids: string[]
          p_required_follow_up_actions: Json
          p_resulting_state: string
          p_suggestion: string
          p_technical_scope: string
          p_title: string
        }
        Returns: {
          assessment: Json
          outcome: string
        }[]
      }
      recalc_product_security_update_artifact_availability_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      recalc_security_update_artifact_availability_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
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
      reconcile_sbom_composite_generation_atomic: {
        Args: {
          p_organization_id: string
          p_review_id: string
          p_worker_id: string
        }
        Returns: {
          generated_document_id: string
          outcome: string
        }[]
      }
      reconcile_vendor_csaf_source_record: {
        Args: {
          p_canonical_vulnerability_id: string
          p_reconciliation_detail: Json
          p_source_record_id: string
        }
        Returns: string
      }
      reconcile_vulnerability_kev_alerts_for_release: {
        Args: { p_organization_id: string; p_release_id: string }
        Returns: {
          created_count: number
          outcome: string
          resolved_count: number
        }[]
      }
      record_connector_test_atomic: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_error_code: string
          p_latency_ms: number
          p_organization_id: string
          p_outcome: string
        }
        Returns: {
          connector: Json
          outcome: string
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
      record_product_import_report_download: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_import_id: string
          p_organization_id: string
        }
        Returns: {
          object_path: string
          outcome: string
        }[]
      }
      record_sbom_ci_credential_use: {
        Args: { p_credential_id: string; p_organization_id: string }
        Returns: {
          outcome: string
        }[]
      }
      record_sbom_validation_atomic: {
        Args: {
          p_job_id: string
          p_organization_id: string
          p_report: Json
          p_worker_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      record_vulnerability_finding_advisory_review_atomic: {
        Args: {
          p_document_id: string
          p_finding_id: string
          p_organization_id: string
          p_prior_state: Json
          p_proposed_state: Json
          p_source_record_version_id: string
          p_transition_kind: string
        }
        Returns: {
          event: Json
          outcome: string
        }[]
      }
      record_vulnerability_finding_human_verdict_atomic: {
        Args: {
          p_actor_user_id: string
          p_document_id: string
          p_finding_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_rationale: string
          p_verdict: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      record_vulnerability_kev_reporting_intent_atomic:
        | {
            Args: {
              p_actor_user_id: string
              p_alert_id: string
              p_document_id: string
              p_external_obligation_id?: string
              p_organization_id: string
              p_reporting_status: string
            }
            Returns: {
              alert: Json
              outcome: string
            }[]
          }
        | {
            Args: {
              p_actor_user_id: string
              p_alert_id: string
              p_document_id: string
              p_external_obligation_id: string
              p_idempotency_key: string
              p_organization_id: string
              p_reporting_status: string
            }
            Returns: {
              alert: Json
              outcome: string
            }[]
          }
      record_vulnerability_matching_accuracy_run: {
        Args: {
          p_code_revision: string
          p_comparator_registry_version: string
          p_confidence_table_version: string
          p_dataset_digest: string
          p_dataset_version: string
          p_false_negative_count: number
          p_false_positive_count: number
          p_metrics: Json
          p_runner_metadata: Json
          p_total_cases: number
        }
        Returns: {
          accuracy_run_id: string
          accuracy_score: number
          outcome: string
          passed: boolean
        }[]
      }
      record_vulnerability_reachability_result_atomic: {
        Args: {
          p_document_id: string
          p_finding_id: string
          p_organization_id: string
          p_result: Json
        }
        Returns: {
          outcome: string
          result: Json
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
      refresh_sbom_composite_review_projection_atomic: {
        Args: { p_organization_id: string; p_review_id: string }
        Returns: {
          outcome: string
          review: Json
        }[]
      }
      refresh_vulnerability_feed_freshness: { Args: never; Returns: number }
      register_finding_propagation_source_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_provenance: string
          p_rule_version: string
          p_source: string
          p_source_baseline_revision_id: string
          p_source_finding_key: string
          p_source_product_id: string
          p_source_release_id: string
          p_source_system: string
        }
        Returns: {
          job_id: string
          outcome: string
          source: Json
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
      reject_sbom_source_integrity_atomic:
        | {
            Args: {
              p_actor_credential_id: string
              p_actor_user_id: string
              p_actual_byte_size: number
              p_actual_media_type: string
              p_actual_sha256: string
              p_correlation_id: string
              p_organization_id: string
              p_source_id: string
            }
            Returns: {
              outcome: string
              source: Json
            }[]
          }
        | {
            Args: {
              p_actor_credential_id: string
              p_actor_user_id: string
              p_actual_byte_size: number
              p_actual_media_type: string
              p_actual_sha256: string
              p_correlation_id: string
              p_idempotency_key: string
              p_organization_id: string
              p_source_id: string
            }
            Returns: {
              outcome: string
              source: Json
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
      remove_product_release_market_availability_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_country_code: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_release_id: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      replace_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
          p_replacement_artifact_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      replay_sbom_ingest_job_atomic:
        | {
            Args: {
              p_actor_user_id: string
              p_correlation_id: string
              p_job_id: string
              p_organization_id: string
            }
            Returns: {
              job: Json
              outcome: string
            }[]
          }
        | {
            Args: {
              p_actor_user_id: string
              p_correlation_id: string
              p_idempotency_key: string
              p_job_id: string
              p_organization_id: string
            }
            Returns: {
              job: Json
              outcome: string
            }[]
          }
      replay_vulnerability_feed_sync:
        | {
            Args: {
              p_actor_user_id: string
              p_correlation_id: string
              p_feed_key: string
              p_idempotency_key: string
            }
            Returns: {
              outcome: string
              run: Json
            }[]
          }
        | {
            Args: {
              p_actor_user_id: string
              p_correlation_id: string
              p_feed_key: string
              p_idempotency_key: string
              p_run_id: string
            }
            Returns: {
              outcome: string
              run: Json
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
      request_product_import_commit: {
        Args: {
          p_actor_user_id: string
          p_content_hash: string
          p_idempotency_key: string
          p_import_id: string
          p_organization_id: string
        }
        Returns: {
          job: Json
          outcome: string
        }[]
      }
      request_product_relationship_reevaluation_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_graph_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_product_id: string
          p_provenance: string
          p_reason: string
          p_source: string
        }
        Returns: {
          event: Json
          outcome: string
        }[]
      }
      request_sync_run_commit_atomic: {
        Args: {
          p_actor_user_id: string
          p_expected_row_count: number
          p_organization_id: string
          p_sync_run_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
      request_vulnerability_feed_sync: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_feed_key: string
          p_idempotency_key: string
        }
        Returns: {
          outcome: string
          run: Json
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
      reserve_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_type: string
          p_byte_size: number
          p_content_type: string
          p_correlation_id: string
          p_distribution_kind: string
          p_file_name: string
          p_idempotency_key: string
          p_issued_at: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_sha256: string
          p_signature_metadata: Json
          p_supported_platform: string
          p_title: string
          p_update_version: string
          p_validated_external_references: Json
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      reserve_sbom_source_atomic:
        | {
            Args: {
              p_actor_credential_id: string
              p_actor_user_id: string
              p_correlation_id: string
              p_declared_byte_size: number
              p_declared_media_type: string
              p_declared_sha256: string
              p_idempotency_key: string
              p_organization_id: string
              p_original_filename: string
              p_product_id: string
              p_release_id: string
              p_request_digest: string
              p_source_id: string
              p_source_kind: string
              p_staging_storage_key: string
              p_upload_expires_at: string
            }
            Returns: {
              outcome: string
              source: Json
            }[]
          }
        | {
            Args: {
              p_actor_credential_id: string
              p_actor_user_id: string
              p_correlation_id: string
              p_declared_byte_size: number
              p_declared_format: string
              p_declared_media_type: string
              p_declared_sha256: string
              p_declared_spec_version: string
              p_idempotency_key: string
              p_organization_id: string
              p_original_filename: string
              p_product_id: string
              p_release_id: string
              p_request_digest: string
              p_source_id: string
              p_source_kind: string
              p_staging_storage_key: string
              p_supersedes_source_id: string
              p_upload_expires_at: string
            }
            Returns: {
              outcome: string
              source: Json
            }[]
          }
      reserve_supplier_sbom_submission_atomic: {
        Args: {
          p_correlation_id: string
          p_declared_byte_size: number
          p_declared_format?: string
          p_declared_media_type: string
          p_declared_sha256: string
          p_declared_spec_version?: string
          p_idempotency_key: string
          p_original_filename: string
          p_request_digest: string
          p_session_token_hash: string
          p_source_id: string
          p_submission_id: string
        }
        Returns: {
          outcome: string
          source: Json
          submission: Json
        }[]
      }
      resolve_active_organization_legal_entity_context: {
        Args: { p_legal_entity_id: string; p_organization_id: string }
        Returns: {
          context: Json
          outcome: string
        }[]
      }
      resolve_connector_secret: {
        Args: {
          p_connector_id: string
          p_encryption_key: string
          p_organization_id: string
        }
        Returns: string
      }
      resolve_connector_sync_worker_actor: {
        Args: { p_organization_id: string }
        Returns: string
      }
      resolve_sbom_ci_credential: {
        Args: { p_credential_id: string; p_organization_id: string }
        Returns: {
          credential_id: string
          outcome: string
          token_hash: string
          token_salt: string
        }[]
      }
      resolve_sbom_composite_conflict_atomic: {
        Args: {
          p_actor_user_id: string
          p_conflict_id: string
          p_correlation_id: string
          p_decision: string
          p_idempotency_key: string
          p_organization_id: string
          p_reason: string
          p_review_id: string
          p_selected_source_component_id: string
        }
        Returns: {
          outcome: string
          review: Json
        }[]
      }
      resolve_sbom_composite_relationship_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_disposition: string
          p_idempotency_key: string
          p_organization_id: string
          p_reason: string
          p_relationship_id: string
          p_review_id: string
        }
        Returns: {
          outcome: string
          review: Json
        }[]
      }
      resolve_sbom_diff_baseline: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_source_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      resolve_sync_conflict_atomic: {
        Args: {
          p_actor_user_id: string
          p_chosen_action: string
          p_conflict_id: string
          p_correlation_id: string
          p_expected_version: number
          p_manual_value: Json
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          conflict: Json
          outcome: string
        }[]
      }
      retry_sbom_diff_report_atomic: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_report_id: string
        }
        Returns: {
          outcome: string
          report: Json
        }[]
      }
      retry_sync_run_atomic: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_sync_run_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
      reverify_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_verified_outcome: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      reverify_security_update_artifact_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_verified_outcome: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      review_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_review_decision: string
          p_review_reason: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      review_product_substantial_modification_assessment_atomic: {
        Args: {
          p_actor_user_id: string
          p_assessment_id: string
          p_correlation_id: string
          p_determination: string
          p_determination_rationale: string
          p_expected_version: number
          p_organization_id: string
          p_override_reason: string
          p_product_id: string
        }
        Returns: {
          assessment: Json
          outcome: string
        }[]
      }
      review_supplier_sbom_submission_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_decision: string
          p_idempotency_key: string
          p_organization_id: string
          p_reason: string
          p_submission_id: string
        }
        Returns: {
          outcome: string
          submission: Json
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
      revoke_sbom_ci_credential_atomic: {
        Args: {
          p_actor_user_id: string
          p_credential_id: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
        }[]
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
      save_product_import_rows_page: {
        Args: {
          p_content_hash: string
          p_import_id: string
          p_organization_id: string
          p_rows: Json
          p_worker_id: string
        }
        Returns: {
          outcome: string
          saved_count: number
        }[]
      }
      save_sync_run_plan_atomic: {
        Args: {
          p_conflicts: Json
          p_cursor_to: string
          p_fetch_content_hash: string
          p_organization_id: string
          p_plan_items: Json
          p_sync_run_id: string
          p_worker_id: string
        }
        Returns: {
          outcome: string
          run: Json
        }[]
      }
      sbom_actor_can_view: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: boolean
      }
      sbom_allowed_media_type: { Args: { p_value: string }; Returns: boolean }
      sbom_component_json: {
        Args: { p_component_id: string; p_organization_id: string }
        Returns: Json
      }
      sbom_composite_identity_key: {
        Args: {
          p_canonical_purl: string
          p_component_ref: string
          p_cpe: string
          p_document_id: string
          p_hashes: Json
        }
        Returns: string
      }
      sbom_composite_review_json: {
        Args: { p_organization_id: string; p_review_id: string }
        Returns: Json
      }
      sbom_diff_cursor_encode: {
        Args: { p_created_at: string; p_id: string }
        Returns: string
      }
      sbom_diff_report_json: {
        Args: { p_organization_id: string; p_report_id: string }
        Returns: Json
      }
      sbom_document_json: {
        Args: { p_document_id: string; p_organization_id: string }
        Returns: Json
      }
      sbom_ingest_job_json: {
        Args: { p_job_id: string; p_organization_id: string }
        Returns: Json
      }
      sbom_json_has_exact_keys: {
        Args: { p_expected_keys: string[]; p_value: Json }
        Returns: boolean
      }
      sbom_json_has_sensitive_key: { Args: { p_value: Json }; Returns: boolean }
      sbom_purl_package_identity: {
        Args: { p_canonical_purl: string }
        Returns: string
      }
      sbom_quality_cursor_encode: {
        Args: { p_id: string; p_sort_value: string }
        Returns: string
      }
      sbom_quality_report_json: {
        Args: { p_organization_id: string; p_report_id: string }
        Returns: Json
      }
      sbom_source_json: {
        Args: { p_organization_id: string; p_source_id: string }
        Returns: Json
      }
      sbom_supplier_invitation_json: {
        Args: { p_invitation_id: string; p_organization_id: string }
        Returns: Json
      }
      sbom_supplier_request_json: {
        Args: { p_organization_id: string; p_request_id: string }
        Returns: Json
      }
      sbom_supplier_submission_json: {
        Args: { p_organization_id: string; p_submission_id: string }
        Returns: Json
      }
      sbom_validation_report_json: {
        Args: { p_organization_id: string; p_source_id: string }
        Returns: Json
      }
      sbom_validation_summary_json: {
        Args: { p_organization_id: string; p_source_id: string }
        Returns: Json
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
      schedule_product_security_update_artifact_cleanup_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      schedule_security_update_artifact_cleanup_worker_atomic: {
        Args: {
          p_artifact_id: string
          p_correlation_id: string
          p_organization_id: string
          p_product_id: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      search_sbom_components: {
        Args: {
          p_actor_user_id: string
          p_cursor: string
          p_document_id: string
          p_limit: number
          p_organization_id: string
          p_q: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      set_connector_secret_atomic: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_encryption_key: string
          p_organization_id: string
          p_secret_value: string
        }
        Returns: {
          connector: Json
          outcome: string
        }[]
      }
      set_vulnerability_feed_configuration: {
        Args: {
          p_disabled_reason?: string
          p_enabled: boolean
          p_feed_key: string
          p_schedule_interval_seconds?: number
          p_stale_threshold_seconds?: number
        }
        Returns: string
      }
      stage_vulnerability_feed_record: {
        Args: {
          p_canonical_id: string
          p_normalized_payload: Json
          p_raw_payload: Json
          p_record_sha256: string
          p_record_state: string
          p_run_id: string
          p_source_record_key: string
          p_source_update_marker: string
          p_source_updated_at: string
          p_worker_id: string
        }
        Returns: string
      }
      supersede_product_component_link_atomic: {
        Args: {
          p_actor_user_id: string
          p_component_product_id: string
          p_component_release_id: string
          p_correlation_id: string
          p_effective_ends_at: string
          p_effective_starts_at: string
          p_expected_graph_version: number
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_parent_release_id: string
          p_product_id: string
          p_provenance: string
          p_quantity: number
          p_reason: string
          p_relationship_id: string
          p_source: string
        }
        Returns: {
          graph_version: number
          outcome: string
          relationship: Json
        }[]
      }
      supersede_product_support_period_atomic: {
        Args: {
          p_actor_user_id: string
          p_allow_protection_reduction: boolean
          p_correlation_id: string
          p_expected_lifetime_justification: string
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_preview_digest: string
          p_product_id: string
          p_reason: string
          p_support_ends_at: string
          p_support_period_id: string
          p_support_starts_at: string
        }
        Returns: {
          outcome: string
          support_period: Json
        }[]
      }
      switch_organization_atomic: {
        Args: { p_actor_user_id: string; p_organization_id: string }
        Returns: {
          outcome: string
        }[]
      }
      sync_sbom_composite_selected_provenance: {
        Args: { p_organization_id: string; p_review_id: string }
        Returns: undefined
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
      transition_product_release_lifecycle_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_placed_on_market_at: string
          p_product_id: string
          p_reason: string
          p_release_id: string
          p_target_lifecycle: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      unlink_external_identity_atomic: {
        Args: {
          p_actor_user_id: string
          p_mapping_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: {
          outcome: string
        }[]
      }
      update_connector_atomic: {
        Args: {
          p_actor_user_id: string
          p_commit_policy: string
          p_connection_config: Json
          p_connector_id: string
          p_display_name: string
          p_expected_version: number
          p_mapping_version: string
          p_organization_id: string
        }
        Returns: {
          connector: Json
          outcome: string
        }[]
      }
      update_finding_propagation_source_atomic: {
        Args: {
          p_actor_user_id: string
          p_correlation_id: string
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
          p_provenance: string
          p_reason: string
          p_rule_version: string
          p_source: string
          p_source_baseline_revision_id: string
          p_source_id: string
          p_source_product_id: string
          p_source_release_id: string
          p_status: string
        }
        Returns: {
          job_id: string
          outcome: string
          source: Json
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
      update_organization_sbom_quality_settings_atomic: {
        Args: {
          p_actor_user_id: string
          p_bsi_profile_enabled: boolean
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
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
      update_organization_support_alert_intervals_atomic: {
        Args: {
          p_actor_user_id: string
          p_alert_intervals: number[]
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
        }
        Returns: {
          intervals: Json
          outcome: string
        }[]
      }
      update_product_atomic: {
        Args: {
          p_actor_user_id: string
          p_description: string
          p_description_provided: boolean
          p_expected_version: number
          p_internal_code: string
          p_name: string
          p_organization_id: string
          p_product_id: string
          p_product_type: string
          p_responsible_owner_id: string
        }
        Returns: {
          outcome: string
          product: Json
        }[]
      }
      update_product_release_atomic: {
        Args: {
          p_actor_user_id: string
          p_description: string
          p_description_provided: boolean
          p_expected_version: number
          p_label: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_release_version: string
        }
        Returns: {
          outcome: string
          release: Json
        }[]
      }
      update_product_security_update_artifact_metadata_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_signature_metadata: Json
          p_supported_platform: string
          p_title: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      update_sbom_quality_settings_atomic: {
        Args: {
          p_actor_user_id: string
          p_bsi_profile_enabled: boolean
          p_expected_version: number
          p_idempotency_key: string
          p_organization_id: string
        }
        Returns: {
          outcome: string
          result: Json
        }[]
      }
      upsert_field_authority_policy_atomic: {
        Args: {
          p_actor_user_id: string
          p_connector_id: string
          p_entity_type: string
          p_field_name: string
          p_organization_id: string
          p_policy_value: string
          p_preview_digest: string
          p_protected: boolean
          p_protected_reason: string
        }
        Returns: {
          outcome: string
          policy: Json
        }[]
      }
      upsert_vulnerability_component_occurrence_m4_04: {
        Args: {
          p_canonical_cpe: string
          p_canonical_purl: string
          p_component_id: string
          p_component_version: string
          p_cpe_part?: string
          p_cpe_product?: string
          p_cpe_vendor?: string
          p_cpe_version?: string
          p_document_id: string
          p_identity_kind: string
          p_organization_id: string
          p_purl_name?: string
          p_purl_namespace?: string
          p_purl_type?: string
          p_release_id: string
        }
        Returns: {
          occurrence_id: string
          outcome: string
        }[]
      }
      user_is_member_of: { Args: { p_org_id: string }; Returns: boolean }
      user_is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      user_org_role: { Args: { p_org_id: string }; Returns: string }
      user_shares_org_with: { Args: { p_user_id: string }; Returns: boolean }
      valid_sbom_validation_report: {
        Args: { p_report: Json; p_status: string }
        Returns: boolean
      }
      validate_sbom_composite_scope: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_product_id: string
          p_release_id: string
          p_source_ids: Json
        }
        Returns: {
          outcome: string
        }[]
      }
      verify_email_code_atomic: {
        Args: {
          p_code_hash: string
          p_max_attempts?: number
          p_user_id: string
        }
        Returns: string
      }
      vulnerability_feed_health_json: {
        Args: { p_feed_key?: string }
        Returns: Json
      }
      vulnerability_offline_bundle_import_json: {
        Args: { p_import_id: string }
        Returns: Json
      }
      withdraw_product_security_update_artifact_atomic: {
        Args: {
          p_actor_user_id: string
          p_artifact_id: string
          p_correlation_id: string
          p_expected_version: number
          p_organization_id: string
          p_product_id: string
          p_reason: string
        }
        Returns: {
          artifact: Json
          outcome: string
        }[]
      }
      yield_vulnerability_feed_sync: {
        Args: {
          p_delay_seconds?: number
          p_run_id: string
          p_worker_id: string
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
