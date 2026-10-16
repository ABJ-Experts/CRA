const all = Object.freeze(["suppliers"] as const);
const lists = Object.freeze(["suppliers", "list"] as const);
const list = Object.freeze((query: string) =>
  Object.freeze([...lists, query] as const),
);
const details = Object.freeze(["suppliers", "detail"] as const);
const detail = Object.freeze((supplierId: string) =>
  Object.freeze([...details, supplierId] as const),
);
const findingResponsibilities = Object.freeze([
  "suppliers",
  "findings",
] as const);
const findingResponsibility = Object.freeze((findingId: string) =>
  Object.freeze([...findingResponsibilities, findingId] as const),
);

export const supplierKeys = Object.freeze({
  all,
  lists,
  list,
  details,
  detail,
  findingResponsibilities,
  findingResponsibility,
});
