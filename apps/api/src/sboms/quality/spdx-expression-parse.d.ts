declare module "spdx-expression-parse" {
  function parse(expression: string): unknown;
  export = parse;
}
