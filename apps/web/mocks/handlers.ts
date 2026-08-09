import { HttpResponse, http, delay, passthrough } from "msw";
import type { Paged } from "@repo/contracts/pagination";
import { COINS, CUSTOMERS, ORDERS, PRODUCTS } from "./data/tables";

/**
 * Mock API for the dashboard and table screens.
 *
 * Deliberately behaves like a real paged endpoint rather than returning a
 * whole array: it honours `page`, `pageSize`, `sort`, `order` and `q`, and it
 * reports a `total` the client has to trust. That is what makes the tables
 * exercise server-side pagination and sorting instead of quietly doing the
 * work in the browser and pretending.
 *
 * Swapping to a real backend means changing the base URL; the response shape
 * is the contract.
 */

/** Small, fixed latency so loading states are visible but not annoying. */
const LATENCY = 260;

/** A value that is ENTIRELY a number, optionally with currency, sign, thousands
 *  separators or a trailing percent. Anything else sorts as text. */
const NUMERIC_LIKE = /^[-+]?\$?\s*\d[\d,]*(\.\d+)?\s*%?$/;

const toNumber = (v: string) => Number(v.replace(/[^0-9.-]/g, ""));

/* `object` rather than `Record<string, unknown>`: an interface with declared
 * keys has no index signature, so the stricter constraint rejects every one of
 * the row types. Indexed reads below are narrowed at each use instead. */
function paginate<T extends object>(
  rows: T[],
  url: URL,
  searchable: (keyof T)[],
): Paged<T> {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? 15)),
  );
  const sort = url.searchParams.get("sort");
  const order = url.searchParams.get("order") === "desc" ? -1 : 1;
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  let out = rows;

  if (q) {
    out = out.filter((row) =>
      searchable.some((key) =>
        String(row[key] ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }

  if (sort && out.length && sort in (out[0] as object)) {
    /* Copy before sorting: the module-level arrays are the source of truth and
     * an in-place sort would permanently reorder them for every later request. */
    out = [...out].sort((a, b) => {
      const av = a[sort as keyof T];
      const bv = b[sort as keyof T];
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * order;

      const as = String(av).trim();
      const bs = String(bv).trim();

      /* Currency and percentage columns are strings like "$928.41" or
       * "+7.26%", and comparing those lexically puts "$1,000" before "$9".
       *
       * The test has to match the WHOLE value, not just "contains a digit".
       * An earlier version stripped non-digits and checked for NaN, which is
       * wrong twice over: `Number("")` is 0 rather than NaN, so digit-free
       * names all collapsed to 0, and any name that merely contained a number
       * ("Anker 737 Power Bank") was compared as 737. Product names then
       * sorted by an accidental numeric key in both directions. */
      if (NUMERIC_LIKE.test(as) && NUMERIC_LIKE.test(bs)) {
        return (toNumber(as) - toNumber(bs)) * order;
      }
      return as.localeCompare(bs) * order;
    });
  }

  const total = out.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  /* Clamp rather than returning an empty page: deleting or filtering can leave
   * the client asking for a page that no longer exists, and stranding it on a
   * blank table with no way back is worse than showing the last real page. */
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;

  return {
    rows: out.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}

/** Set `?fail=1` on any request to exercise the error path. */
function maybeFail(url: URL) {
  return url.searchParams.get("fail") === "1";
}

export const handlers = [
  /*
   * The real API passes straight through.
   *
   * MSW matches in ARRAY ORDER and the first match wins, so this must stay
   * first. It is also deliberately explicit rather than relying on
   * `onUnhandledRequest: "bypass"` in providers.tsx — that setting makes
   * passthrough a fallback behaviour nobody declared, and a future change to it
   * would silently start intercepting real auth calls. Here the intent is
   * written down and asserted by `handlers.spec.ts`.
   *
   * Note the `/api/v1` prefix: none of the dashboard mocks below can collide
   * with it, which is exactly why the API uses that prefix.
   */
  http.all("/api/v1/*", () => passthrough()),

  http.get("/api/products", async ({ request }) => {
    const url = new URL(request.url);
    await delay(LATENCY);
    if (maybeFail(url)) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json(
      paginate(PRODUCTS, url, ["name", "sku", "category", "status"]),
    );
  }),

  http.get("/api/orders", async ({ request }) => {
    const url = new URL(request.url);
    await delay(LATENCY);
    if (maybeFail(url)) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json(
      paginate(ORDERS, url, ["orderNo", "trackingId", "source", "status"]),
    );
  }),

  http.get("/api/customers", async ({ request }) => {
    const url = new URL(request.url);
    await delay(LATENCY);
    if (maybeFail(url)) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json(
      paginate(CUSTOMERS, url, [
        "firstName",
        "lastName",
        "email",
        "phone",
        "status",
      ]),
    );
  }),

  http.get("/api/coins", async ({ request }) => {
    const url = new URL(request.url);
    await delay(LATENCY);
    if (maybeFail(url)) return new HttpResponse(null, { status: 500 });
    return HttpResponse.json(paginate(COINS, url, ["name", "symbol"]));
  }),
];
