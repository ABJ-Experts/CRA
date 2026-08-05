// Drizzle schema — mirrors supabase/migrations/*.sql for typed queries only.
// ADR-003: the SQL migrations are the source of truth (RLS/policies/roles can't
// be expressed here); these definitions exist so queries are type-checked.
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  integer,
  bigint,
  numeric,
  boolean,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// All timestamps are timestamptz in UTC (BRD §8.1: never plain timestamp).
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const organisation = pgTable('organisation', {
  id: uuid('id').primaryKey(),
  legalName: text('legal_name').notNull(),
  registeredAddress: text('registered_address'),
  countryMainEstablishment: text('country_main_establishment').notNull(),
  coordinatingCsirt: text('coordinating_csirt'),
  manufacturerContact: jsonb('manufacturer_contact').notNull().default({}),
  onboardingState: jsonb('onboarding_state').notNull().default({}),
  parentOrganisationId: uuid('parent_organisation_id'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: tstz('deleted_at'),
});

export const userAccount = pgTable('user_account', {
  id: uuid('id').primaryKey(),
  supabaseUserId: uuid('supabase_user_id').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  status: text('status').notNull().default('active'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: tstz('deleted_at'),
});

export const role = pgTable('role', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  displayName: text('display_name').notNull(),
  isTemplate: boolean('is_template').notNull().default(true),
});

export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const orgMember = pgTable(
  'org_member',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    userAccountId: uuid('user_account_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('org_member_org_user_uq').on(t.organisationId, t.userAccountId),
  ],
);

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    name: text('name').notNull(),
    internalCode: text('internal_code').notNull(),
    productType: text('product_type').notNull().default('standalone_software'),
    lifecycleState: text('lifecycle_state').notNull().default('development'),
    placedOnMarketAt: tstz('placed_on_market_at'),
    version: integer('version').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    uniqueIndex('product_org_code_uq').on(t.organisationId, t.internalCode),
  ],
);

// Append-only audit ledger with per-org hash chain (ADR-012). No UPDATE/DELETE
// grant exists for cras_app — the mirror is read/insert only by design.
export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    reason: text('reason'),
    correlationId: uuid('correlation_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    contentHash: text('content_hash').notNull(),
    previousHash: text('previous_hash'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('audit_event_org_seq_uq').on(t.organisationId, t.sequence),
  ],
);

export const productRelease = pgTable(
  'product_release',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    productId: uuid('product_id').notNull(),
    versionLabel: text('version_label').notNull(),
    lifecycleState: text('lifecycle_state').notNull().default('development'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    uniqueIndex('product_release_uq').on(
      t.organisationId,
      t.productId,
      t.versionLabel,
    ),
  ],
);

export const sbomDocument = pgTable('sbom_document', {
  id: uuid('id').primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  productReleaseId: uuid('product_release_id').notNull(),
  format: text('format').notNull(),
  specVersion: text('spec_version').notNull(),
  serialNumber: text('serial_number'),
  source: text('source').notNull().default('manual_upload'),
  rawObjectKey: text('raw_object_key').notNull(),
  contentHash: text('content_hash').notNull(),
  validationStatus: text('validation_status').notNull().default('valid'),
  validationReport: jsonb('validation_report').notNull().default({}),
  componentCount: integer('component_count').notNull().default(0),
  depthMax: integer('depth_max').notNull().default(0),
  supersedesId: uuid('supersedes_id'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const sbomComponent = pgTable('sbom_component', {
  id: uuid('id').primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  sbomDocumentId: uuid('sbom_document_id').notNull(),
  purl: text('purl'),
  cpe: text('cpe'),
  name: text('name').notNull(),
  version: text('version'),
  ecosystem: text('ecosystem'),
  versionNormalised: text('version_normalised'),
  scope: text('scope'),
  depth: integer('depth').notNull().default(0),
  supplierName: text('supplier_name'),
  hashes: jsonb('hashes').notNull().default({}),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// Global vulnerability advisory mirror (no organisation_id — read-only to tenants).
export const advisory = pgTable('advisory', {
  id: uuid('id').primaryKey(),
  source: text('source').notNull(),
  advisoryId: text('advisory_id').notNull(),
  summary: text('summary'),
  cvssBase: numeric('cvss_base', { mode: 'number' }),
  cvssVector: text('cvss_vector'),
  epssScore: numeric('epss_score', { mode: 'number' }),
  kevListed: boolean('kev_listed').notNull().default(false),
  kevAddedAt: tstz('kev_added_at'),
  cweIds: text('cwe_ids').array().notNull().default([]),
  publishedAt: tstz('published_at'),
  modifiedAt: tstz('modified_at'),
});

export const advisoryAffected = pgTable('advisory_affected', {
  id: uuid('id').primaryKey(),
  advisoryPk: uuid('advisory_pk').notNull(),
  ecosystem: text('ecosystem').notNull(),
  packageName: text('package_name').notNull(),
  namespace: text('namespace'),
  introduced: text('introduced'),
  fixed: text('fixed'),
  lastAffected: text('last_affected'),
});

export const advisoryCpe = pgTable('advisory_cpe', {
  id: uuid('id').primaryKey(),
  advisoryPk: uuid('advisory_pk').notNull(),
  cpe: text('cpe').notNull(),
  versionStartIncluding: text('version_start_including'),
  versionEndExcluding: text('version_end_excluding'),
  versionSpecific: boolean('version_specific').notNull().default(false),
});

// FR-VULN-002: per-feed sync bookkeeping. `lastSuccessAt` — never `lastAttemptAt`
// — is what staleness alerting reads: a feed failing every hour has a very recent
// attempt and dangerously old data.
export const advisoryFeedSyncState = pgTable('advisory_feed_sync_state', {
  feed: text('feed').primaryKey(),
  status: text('status').notNull().default('never_run'),
  lastAttemptAt: tstz('last_attempt_at'),
  lastSuccessAt: tstz('last_success_at'),
  checkpoint: text('checkpoint'),
  recordsProcessed: bigint('records_processed', { mode: 'number' })
    .notNull()
    .default(0),
  lastError: text('last_error'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const finding = pgTable(
  'finding',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    productReleaseId: uuid('product_release_id').notNull(),
    sbomComponentId: uuid('sbom_component_id').notNull(),
    advisoryPk: uuid('advisory_pk').notNull(),
    advisorySource: text('advisory_source').notNull(),
    advisoryId: text('advisory_id').notNull(),
    matchMethod: text('match_method').notNull(),
    matchConfidence: numeric('match_confidence', { mode: 'number' }).notNull(),
    cvssBase: numeric('cvss_base', { mode: 'number' }),
    epssScore: numeric('epss_score', { mode: 'number' }),
    kevListed: boolean('kev_listed').notNull().default(false),
    vexStatus: text('vex_status').notNull().default('not_assessed'),
    vexJustification: text('vex_justification'),
    state: text('state').notNull().default('open'),
    priorityScore: numeric('priority_score', { mode: 'number' }),
    firstDetectedAt: tstz('first_detected_at').notNull().defaultNow(),
    lastEvaluatedAt: tstz('last_evaluated_at').notNull().defaultNow(),
    suppressionExpiresAt: tstz('suppression_expires_at'),
    // FR-MATCH-004 — structured matcher-quality feedback, distinct from VEX.
    // "not_affected" says the vulnerability does not reach this product; a false
    // positive says the MATCH itself was wrong. Only the latter is a matcher defect.
    falsePositiveReason: text('false_positive_reason'),
    falsePositiveAt: tstz('false_positive_at'),
    falsePositiveBy: uuid('false_positive_by'),
    version: integer('version').notNull().default(1),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('finding_component_advisory_uq').on(
      t.organisationId,
      t.sbomComponentId,
      t.advisoryPk,
    ),
  ],
);

export const reportingObligation = pgTable('reporting_obligation', {
  id: uuid('id').primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  productReleaseId: uuid('product_release_id'),
  findingId: uuid('finding_id'),
  obligationType: text('obligation_type').notNull(),
  awarenessAt: tstz('awareness_at').notNull(),
  awarenessBasis: text('awareness_basis'),
  notificationSubmittedAt: tstz('notification_submitted_at'),
  remediationAvailableAt: tstz('remediation_available_at'),
  affectedMemberStates: text('affected_member_states')
    .array()
    .notNull()
    .default([]),
  coordinatingCsirt: text('coordinating_csirt'),
  ruleSetVersion: text('rule_set_version').notNull(),
  state: text('state').notNull().default('draft'),
  cancelledReason: text('cancelled_reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const obligationStage = pgTable(
  'obligation_stage',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    obligationId: uuid('obligation_id').notNull(),
    stage: text('stage').notNull(),
    anchorEvent: text('anchor_event').notNull(),
    durationInterval: text('duration_interval').notNull(),
    dueAt: tstz('due_at'),
    submittedAt: tstz('submitted_at'),
    state: text('state').notNull().default('pending_anchor'),
    // §11.4: escalation thresholds already notified, so obligation.tick is idempotent.
    notifiedThresholds: numeric('notified_thresholds', { mode: 'number' })
      .array()
      .notNull()
      .default([]),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('obligation_stage_uq').on(
      t.organisationId,
      t.obligationId,
      t.stage,
    ),
  ],
);

export const obligationTimelineEvent = pgTable('obligation_timeline_event', {
  id: uuid('id').primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  obligationId: uuid('obligation_id').notNull(),
  eventType: text('event_type').notNull(),
  detail: jsonb('detail').notNull().default({}),
  occurredAt: tstz('occurred_at').notNull().defaultNow(),
});

// FR-EVD-001/003: evidence metadata + tamper hash. Bytes live in object storage.
export const evidenceDocument = pgTable('evidence_document', {
  id: uuid('id').primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  title: text('title').notNull(),
  classification: text('classification').notNull().default('other'),
  productId: uuid('product_id'),
  ownerUserId: uuid('owner_user_id'),
  validFrom: date('valid_from'),
  validUntil: date('valid_until'),
  storageKey: text('storage_key').notNull(),
  contentHash: text('content_hash').notNull(),
  contentType: text('content_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  tamperState: text('tamper_state').notNull().default('unverified'),
  uploadedAt: tstz('uploaded_at').notNull().defaultNow(),
  uploadedBy: uuid('uploaded_by'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const schema = {
  organisation,
  userAccount,
  role,
  rolePermission,
  orgMember,
  auditEvent,
  product,
  productRelease,
  sbomDocument,
  sbomComponent,
  advisory,
  advisoryAffected,
  advisoryCpe,
  advisoryFeedSyncState,
  finding,
  reportingObligation,
  obligationStage,
  obligationTimelineEvent,
  evidenceDocument,
};
