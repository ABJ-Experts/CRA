/** @type {import("next").NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@repo/ui", "@repo/design-system"],
};
