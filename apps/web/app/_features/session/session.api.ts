import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import {
  effectivePermissionsResponseSchema,
  menuResponseSchema,
} from "@repo/contracts/permissions/schemas";
import { okResponseSchema } from "@repo/contracts/shared/schemas";
export type { EffectivePermissionsResponse } from "@repo/contracts/permissions/types";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { requestJson } from "../../_lib/http/api-client";

export interface SessionRequestOptions {
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
}

/** Gateway class for session reads; React rendering remains functional. */
export class SessionApi {
  identity(options: SessionRequestOptions = {}) {
    return authenticatedRequestJson({
      path: "/api/v1/auth/session",
      schema: sessionResponseSchema,
      signal: options.signal,
      fetcher: options.fetcher,
    });
  }

  permissions(options: SessionRequestOptions = {}) {
    return authenticatedRequestJson({
      path: "/api/v1/permissions/effective",
      schema: effectivePermissionsResponseSchema,
      signal: options.signal,
      fetcher: options.fetcher,
    });
  }

  async menu(options: SessionRequestOptions = {}) {
    const response = await authenticatedRequestJson({
      path: "/api/v1/permissions/menu",
      schema: menuResponseSchema,
      signal: options.signal,
      fetcher: options.fetcher,
    });
    return response.menu;
  }

  signOut(options: SessionRequestOptions = {}) {
    return requestJson({
      path: "/api/v1/auth/sign-out",
      method: "POST",
      schema: okResponseSchema,
      signal: options.signal,
      fetcher: options.fetcher,
    });
  }
}

export const sessionApi = Object.freeze(new SessionApi());
