import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import React, { type ComponentProps, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

type CommonJsModule = { default?: unknown };
type VirtualModules = Readonly<Record<string, unknown>>;

function loadTsxModule(
  relativePath: string,
  virtualModules: VirtualModules,
): CommonJsModule {
  const filename = resolve(import.meta.dirname, "..", relativePath);
  const source = readFileSync(filename, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      inlineSources: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const sourceMap = JSON.parse(transpiled.sourceMapText ?? "{}") as {
    sources?: string[];
    sourcesContent?: string[];
  };
  const inlineSourceMap = Buffer.from(
    JSON.stringify({
      ...sourceMap,
      sources: [`file://${filename}`],
      sourcesContent: [source],
    }),
  ).toString("base64");
  const output = transpiled.outputText.replace(
    /^\/\/# sourceMappingURL=.*$/m,
    "",
  );
  const nativeRequire = createRequire(filename);
  const testRequire = (moduleId: string): unknown => {
    if (Object.hasOwn(virtualModules, moduleId)) {
      return virtualModules[moduleId];
    }
    if (moduleId.endsWith(".module.css")) {
      return {
        buttons: "buttons",
        featureSvg: "featureSvg",
        features: "features",
        heroBanner: "heroBanner",
      };
    }
    return nativeRequire(moduleId);
  };
  const loadedModule: CommonJsModule = {};
  const evaluate = new Function(
    "require",
    "module",
    "exports",
    `${output}\n//# sourceMappingURL=data:application/json;base64,${inlineSourceMap}\n//# sourceURL=file://${filename}`,
  );

  evaluate(testRequire, loadedModule, loadedModule);
  return loadedModule;
}

const esModule = (defaultExport: unknown) => ({
  __esModule: true,
  default: defaultExport,
});

const Heading = ({
  as: Element,
  children,
  ...props
}: ComponentProps<"h1"> & { as: "h1" | "h3" }) => (
  <Element {...props}>{children}</Element>
);

describe("documentation homepage", () => {
  it("renders site identity, navigation, and each product benefit", () => {
    const Svg = (props: ComponentProps<"svg">) => <svg {...props} />;
    const homepageFeatures = loadTsxModule(
      "components/HomepageFeatures/index.tsx",
      {
        "@site/static/img/undraw_docusaurus_mountain.svg": { default: Svg },
        "@site/static/img/undraw_docusaurus_react.svg": { default: Svg },
        "@site/static/img/undraw_docusaurus_tree.svg": { default: Svg },
        "@theme/Heading": esModule(Heading),
      },
    );
    const useDocusaurusContext = vi.fn(() => ({
      siteConfig: { title: "CRA Docs", tagline: "API documentation" },
    }));
    const Link = ({
      to,
      children,
      ...props
    }: ComponentProps<"a"> & { to: string }) => (
      <a href={to} {...props}>
        {children}
      </a>
    );
    const Layout = ({
      title,
      description,
      children,
    }: {
      title: string;
      description: string;
      children: ReactNode;
    }) => (
      <div data-description={description} data-title={title}>
        {children}
      </div>
    );
    const home = loadTsxModule("pages/index.tsx", {
      "@docusaurus/Link": esModule(Link),
      "@docusaurus/useDocusaurusContext": esModule(useDocusaurusContext),
      "@site/src/components/HomepageFeatures": homepageFeatures,
      "@theme/Heading": esModule(Heading),
      "@theme/Layout": esModule(Layout),
    });
    const Home = home.default as () => ReactNode;

    const { container } = render(<Home />);

    expect(
      screen.getByRole("heading", { name: "CRA Docs", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("API documentation")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Docusaurus Tutorial - 5min ⏱️" }),
    ).toHaveAttribute("href", "/docs/intro");
    expect(
      screen.getByRole("heading", { name: "Easy to Use", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Focus on What Matters",
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Powered by React", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(
      screen.getByText(/reusing the same header and footer/i),
    ).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute(
      "data-title",
      "Hello from CRA Docs",
    );
    expect(container.firstElementChild).toHaveAttribute(
      "data-description",
      "Description will go into a meta tag in <head />",
    );
    expect(useDocusaurusContext).toHaveBeenCalledTimes(2);
  });
});
