import { z } from "zod";

export const LICENSE_CAPABILITIES = [
  "administration",
  "products",
  "sboms",
  "vulnerabilities",
  "findings",
  "reporting",
  "technical_files",
  "evidence",
  "suppliers",
  "frameworks",
  "connectors",
  "tasks",
  "notifications",
  "dashboards",
  "scheduled_reports",
  "portfolio",
  "ai",
] as const;
export const licenseCapabilitySchema = z.enum(LICENSE_CAPABILITIES);
export const licenseStateSchema = z.enum([
  "missing",
  "active",
  "grace",
  "expired_read_only",
  "invalid",
  "clock_untrusted",
]);
