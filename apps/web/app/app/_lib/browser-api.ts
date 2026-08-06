"use client";

export interface BrowserApiResult<T> {
  data?: T;
  error?: string;
}

function errorMessage(problem: unknown, fallback: string): string {
  if (!problem || typeof problem !== "object") return fallback;
  const value = problem as { detail?: unknown; correlationId?: unknown };
  const detail = typeof value.detail === "string" ? value.detail : fallback;
  const correlationId = typeof value.correlationId === "string" ? value.correlationId : null;
  return correlationId ? `${detail} (ref ${correlationId})` : detail;
}

/** Browser mutations always use the same httpOnly-session API proxy. */
export async function browserApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<BrowserApiResult<T>> {
  try {
    const response = await fetch(`/api/cras${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      return { error: errorMessage(problem, response.statusText) };
    }
    return { data: (await response.json()) as T };
  } catch {
    return { error: "Could not reach the API. Try again." };
  }
}

export function jsonRequest(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}
