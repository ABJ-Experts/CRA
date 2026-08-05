import { config } from "@repo/eslint-config/base";

export default [{ ignores: ["dist/**", "coverage/**"] }, ...config];
