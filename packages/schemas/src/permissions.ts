// Permission catalog — the single shared source of truth for authorisation
// (BRD §7.2: "The whole set lives in one shared TypeScript constant so the
// frontend and backend cannot fall out of step"). Permission strings are
// `resource:action`. Roles are templates (custom per-org roles are V2/FR-IAM-008),
// so MVP resolves a member's permissions from ROLE_PERMISSIONS by their role key.

export const PERMISSIONS = {
  ORG_READ: "org:read",
  ORG_UPDATE: "org:update",
  USER_INVITE: "user:invite",
  USER_MANAGE: "user:manage",
  ROLE_READ: "role:read",
  APIKEY_MANAGE: "apikey:manage",
  PRODUCT_READ: "product:read",
  PRODUCT_CREATE: "product:create",
  PRODUCT_UPDATE: "product:update",
  PRODUCT_ARCHIVE: "product:archive",
  SBOM_UPLOAD: "sbom:upload",
  SBOM_READ: "sbom:read",
  SBOM_EXPORT: "sbom:export",
  FINDING_READ: "finding:read",
  FINDING_TRIAGE: "finding:triage",
  FINDING_ASSESS: "finding:assess",
  VEX_APPROVE: "vex:approve",
  EVIDENCE_READ: "evidence:read",
  EVIDENCE_WRITE: "evidence:write",
  OBLIGATION_READ: "obligation:read",
  OBLIGATION_MANAGE: "obligation:manage",
  REPORT_SUBMIT: "report:submit",
  AUDIT_READ: "audit:read",
  ANALYTICS_READ: "analytics:read",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: readonly Permission[] =
  Object.values(PERMISSIONS);

// Approval / submission permissions REQUIRE an MFA-satisfied session (FR-AUTH-002).
export const MFA_REQUIRED_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.VEX_APPROVE,
  PERMISSIONS.REPORT_SUBMIT,
];

export const ROLES = {
  OWNER: "owner",
  SYS_ADMIN: "sys_admin",
  PSM: "psm", // Product Security Manager
  SEC_ENG: "sec_eng",
  DEVOPS: "devops",
  QRM: "qrm", // Quality/Regulatory Manager
  EXEC: "exec",
  AUDITOR: "auditor",
  SUPPLIER: "supplier",
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

const P = PERMISSIONS;

// Derived from the §7.3 role/permission matrix, scoped to MVP permissions.
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  sys_admin: [
    P.ORG_READ,
    P.ORG_UPDATE,
    P.USER_MANAGE,
    P.USER_INVITE,
    P.ROLE_READ,
    P.APIKEY_MANAGE,
    P.PRODUCT_READ,
    P.SBOM_READ,
    P.FINDING_READ,
    P.AUDIT_READ,
    P.ANALYTICS_READ,
  ],
  psm: [
    P.ORG_READ,
    P.PRODUCT_READ,
    P.PRODUCT_CREATE,
    P.PRODUCT_UPDATE,
    P.PRODUCT_ARCHIVE,
    P.SBOM_UPLOAD,
    P.SBOM_READ,
    P.SBOM_EXPORT,
    P.FINDING_READ,
    P.FINDING_TRIAGE,
    P.FINDING_ASSESS,
    P.VEX_APPROVE,
    P.EVIDENCE_READ,
    P.EVIDENCE_WRITE,
    P.OBLIGATION_READ,
    P.OBLIGATION_MANAGE,
    P.REPORT_SUBMIT,
    P.AUDIT_READ,
    P.ANALYTICS_READ,
  ],
  sec_eng: [
    P.ORG_READ,
    P.PRODUCT_READ,
    P.SBOM_UPLOAD,
    P.SBOM_READ,
    P.FINDING_READ,
    P.FINDING_TRIAGE,
    P.FINDING_ASSESS,
    P.EVIDENCE_READ,
    P.EVIDENCE_WRITE,
    P.OBLIGATION_READ,
    P.OBLIGATION_MANAGE,
    P.ANALYTICS_READ,
  ],
  devops: [P.ORG_READ, P.PRODUCT_READ, P.SBOM_UPLOAD, P.SBOM_READ],
  qrm: [
    P.ORG_READ,
    P.PRODUCT_READ,
    P.PRODUCT_UPDATE,
    P.SBOM_READ,
    P.FINDING_READ,
    P.EVIDENCE_READ,
    P.EVIDENCE_WRITE,
    P.AUDIT_READ,
    P.ANALYTICS_READ,
  ],
  exec: [P.ORG_READ, P.PRODUCT_READ, P.ANALYTICS_READ, P.AUDIT_READ],
  auditor: [P.AUDIT_READ, P.EVIDENCE_READ, P.ANALYTICS_READ],
  supplier: [],
};

export function permissionsForRole(roleKey: string): readonly Permission[] {
  return ROLE_PERMISSIONS[roleKey as RoleKey] ?? [];
}

export function roleRequiresMfa(roleKey: string): boolean {
  const perms = permissionsForRole(roleKey);
  return MFA_REQUIRED_PERMISSIONS.some((p) => perms.includes(p));
}
