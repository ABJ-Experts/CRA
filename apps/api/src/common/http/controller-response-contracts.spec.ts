import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import type { Type } from "@nestjs/common";
import type { z } from "zod";

import { AppModule } from "../../app.module";
import {
  NON_JSON_RESPONSE_KIND,
  ZOD_RESPONSE_SCHEMA,
} from "./zod-response.interceptor";

function hasForwardRef(
  value: object,
): value is Readonly<{ forwardRef: () => unknown }> {
  return (
    "forwardRef" in value &&
    typeof (value as { forwardRef?: unknown }).forwardRef === "function"
  );
}

function moduleType(value: unknown): Type | null {
  if (typeof value === "function") return value as Type;
  if (!value || typeof value !== "object") return null;
  if ("module" in value && typeof value.module === "function") {
    return value.module as Type;
  }
  if (hasForwardRef(value)) {
    return moduleType(value.forwardRef());
  }
  return null;
}

function discoverControllers(root: Type): readonly Type[] {
  const controllers = new Set<Type>();
  const visited = new Set<Type>();
  const pending: Type[] = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const declared = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      current,
    ) as readonly unknown[] | undefined;
    for (const candidate of declared ?? []) {
      const Controller = moduleType(candidate);
      if (Controller) controllers.add(Controller);
    }

    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, current) as
      readonly unknown[] | undefined;
    for (const candidate of imports ?? []) {
      const ImportedModule = moduleType(candidate);
      if (ImportedModule) pending.push(ImportedModule);
    }
  }

  return Object.freeze([...controllers]);
}

const controllers = discoverControllers(AppModule);

function controllerFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return controllerFiles(path);
      return entry.isFile() && entry.name.endsWith(".controller.ts")
        ? [path]
        : [];
    });
}

function controllerClassNamesOnDisk(): readonly string[] {
  const names = controllerFiles(join(__dirname, "../..")).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/export\s+class\s+(\w+Controller)\b/g)].map(
      (match) => match[1] as string,
    );
  });
  return Object.freeze([...new Set(names)].sort());
}

describe("controller response contracts", () => {
  it("discovers every controller from the application module graph", () => {
    expect(controllers.map((Controller) => Controller.name).sort()).toEqual(
      controllerClassNamesOnDisk(),
    );
  });

  it.each(controllers)(
    "declares every route as parsed JSON or explicit non-JSON: %p",
    (Controller) => {
      for (const methodName of Object.getOwnPropertyNames(
        Controller.prototype,
      )) {
        if (methodName === "constructor") continue;
        const handler = Object.getOwnPropertyDescriptor(
          Controller.prototype,
          methodName,
        )?.value as ((...args: unknown[]) => unknown) | undefined;
        if (
          !handler ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        )
          continue;

        const schema = Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, handler) as
          z.ZodTypeAny | undefined;
        const nonJsonKind = Reflect.getMetadata(
          NON_JSON_RESPONSE_KIND,
          handler,
        ) as string | undefined;
        const routePath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;

        expect([
          Controller.name,
          methodName,
          routePath,
          Boolean(schema) || Boolean(nonJsonKind),
          Boolean(schema) && Boolean(nonJsonKind),
        ]).toEqual([Controller.name, methodName, routePath, true, false]);
      }
    },
  );
});
