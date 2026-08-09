const RAW_SIZE = /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/g;
const RAW_COLOR =
  /\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const UI_BARREL_IMPORT =
  /(?:(?:^|\n)\s*(?:(?:import|export)\b[^;]*?\bfrom\s*|import\s*)["']@repo\/ui["']|\b(?:import|require)\s*\(\s*(?:["']@repo\/ui["']|`@repo\/ui`))/m;

export function findDesignRuleViolations(source: string): readonly string[] {
  return Object.freeze([
    ...(UI_BARREL_IMPORT.test(source)
      ? ["Import @repo/ui through a component subpath"]
      : []),
    ...Array.from(new Set(source.match(RAW_SIZE) ?? [])).map(
      (token) => `Use semantic typography instead of ${token}`,
    ),
    ...Array.from(new Set(source.match(RAW_COLOR) ?? [])).map(
      (token) => `Use semantic color tokens instead of ${token}`,
    ),
  ]);
}
