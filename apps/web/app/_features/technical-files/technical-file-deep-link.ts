import { technicalFileSectionKeySchema } from "@repo/contracts/technical-files";

export function readTechnicalFileSectionLink(
  params: Pick<URLSearchParams, "getAll">,
) {
  const values = params.getAll("section");
  if (values.length !== 1) return null;
  const parsed = technicalFileSectionKeySchema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}
