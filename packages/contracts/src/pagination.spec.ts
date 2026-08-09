import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paged,
  pagedSchema,
  parsePageParams,
  resolvePage,
} from "./pagination.js";
import { z } from "zod";

describe("parsePageParams", () => {
  it("defaults sanely", () => {
    expect(parsePageParams({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: undefined,
      order: "asc",
      q: undefined,
    });
  });

  it("accepts numeric strings from the query string", () => {
    const p = parsePageParams({
      page: "3",
      pageSize: "25",
      sort: "email",
      order: "desc",
      q: " ada ",
    });
    expect(p).toEqual({
      page: 3,
      pageSize: 25,
      sort: "email",
      order: "desc",
      q: "ada",
    });
  });

  it("clamps pageSize and rejects nonsense", () => {
    expect(parsePageParams({ pageSize: "9999" }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parsePageParams({ pageSize: "0" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageParams({ pageSize: "-5" }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
    expect(parsePageParams({ page: "abc" }).page).toBe(1);
    expect(parsePageParams({ page: "0" }).page).toBe(1);
  });

  it("treats a blank search as absent", () => {
    expect(parsePageParams({ q: "   " }).q).toBeUndefined();
  });

  it("only honours an exact desc", () => {
    expect(parsePageParams({ order: "DESC" }).order).toBe("asc");
    expect(parsePageParams({ order: "desc" }).order).toBe("desc");
  });
});

describe("resolvePage", () => {
  it("computes an inclusive range", () => {
    const r = resolvePage(100, parsePageParams({ page: "2", pageSize: "15" }));
    expect(r).toEqual({ page: 2, pageCount: 7, from: 15, to: 29 });
  });

  it("clamps a page past the end down to the last real page", () => {
    // Matches mocks/handlers.ts. Without this, filtering while on page 6 lands
    // on an empty table that looks broken.
    const r = resolvePage(20, parsePageParams({ page: "99", pageSize: "15" }));
    expect(r.page).toBe(2);
    expect(r.from).toBe(15);
  });

  it("reports one page when there are no rows", () => {
    const r = resolvePage(0, parsePageParams({}));
    expect(r).toEqual({ page: 1, pageCount: 1, from: 0, to: 14 });
  });
});

describe("paged", () => {
  it("returns the bare envelope the DataTable expects", () => {
    const out = paged([{ id: 1 }], 1, parsePageParams({}));
    expect(out).toEqual({
      rows: [{ id: 1 }],
      total: 1,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      pageCount: 1,
    });
    expect(Object.keys(out).sort()).toEqual([
      "page",
      "pageCount",
      "pageSize",
      "rows",
      "total",
    ]);
  });
});

describe("pagedSchema", () => {
  const rowSchema = z.object({ id: z.uuid() }).strict();
  const emptyPage = {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 15,
    pageCount: 1,
  };

  it("accepts empty and full pages", () => {
    expect(pagedSchema(rowSchema).parse(emptyPage)).toEqual(emptyPage);

    const fullPage = {
      rows: [
        { id: "2ad67e3b-6e5e-4cde-870f-2225e7da1202" },
        { id: "2ad67e3b-6e5e-4cde-870f-2225e7da1203" },
      ],
      total: 2,
      page: 1,
      pageSize: 2,
      pageCount: 1,
    };
    expect(pagedSchema(rowSchema).parse(fullPage)).toEqual(fullPage);
  });

  it.each([
    { ...emptyPage, rows: [{ id: "not-a-uuid" }] },
    { ...emptyPage, total: -1 },
    { ...emptyPage, total: 0.5 },
    { ...emptyPage, page: 0 },
    { ...emptyPage, pageCount: 0 },
    { ...emptyPage, pageSize: 0 },
    { ...emptyPage, pageSize: 101 },
    { ...emptyPage, unrecognized: true },
  ])("rejects a malformed page", (value) => {
    expect(pagedSchema(rowSchema).safeParse(value).success).toBe(false);
  });
});
