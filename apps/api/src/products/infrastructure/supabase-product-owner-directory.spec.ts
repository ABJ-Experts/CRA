import type { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseProductOwnerDirectory } from "./supabase-product-owner-directory";
const id = "11111111-1111-4111-8111-111111111111";
function fixture(results: unknown[]) {
  const chain: Record<
    "select" | "eq" | "order" | "range" | "maybeSingle",
    jest.Mock
  > = {
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    range: jest.fn(),
    maybeSingle: jest.fn(),
  };
  for (const method of ["select", "eq", "order"] as const)
    chain[method] = jest.fn().mockReturnValue(chain);
  chain.range = jest
    .fn()
    .mockImplementation(() => Promise.resolve(results.shift()));
  chain.maybeSingle = jest
    .fn()
    .mockImplementation(() => Promise.resolve(results.shift()));
  const from = jest.fn().mockReturnValue(chain);
  return {
    chain,
    from,
    directory: new SupabaseProductOwnerDirectory({
      admin: () => ({ from }),
    } as unknown as SupabaseService),
  };
}
const user = (
  name: string | null = "Alice",
  username: string | null = "alice",
) => ({ id, first_name: name, last_name: null, username });
describe("Supabase owner directory", () => {
  it("resolves current owner through an explicitly scoped product and membership", async () => {
    const f = fixture([
      { data: { responsible_owner_id: id }, error: null },
      { data: { users: user() }, error: null },
    ]);
    expect(await f.directory.ownerForProduct("org", "product")).toEqual({
      id,
      displayName: "Alice",
    });
    expect(f.from.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "products",
      "organization_members",
    ]);
    expect(f.chain.eq).toHaveBeenCalledWith("id", "product");
    expect(f.chain.eq).toHaveBeenCalledWith("user_id", id);
    expect(
      f.chain.eq.mock.calls.filter(
        (call: unknown[]) => call[0] === "organization_id",
      ),
    ).toHaveLength(2);
  });
  it("returns no owner for a missing or foreign product without querying members", async () => {
    const f = fixture([{ data: null, error: null }]);
    expect(await f.directory.ownerForProduct("org", "foreign")).toBeNull();
    expect(f.from).toHaveBeenCalledTimes(1);
  });
  it("returns no owner for an inactive member", async () => {
    const f = fixture([
      { data: { responsible_owner_id: id }, error: null },
      { data: null, error: null },
    ]);
    expect(await f.directory.ownerForProduct("org", "product")).toBeNull();
  });
  it.each([
    [[{ error: { message: "private" } }]],
    [
      [
        { data: { responsible_owner_id: id }, error: null },
        { error: { message: "private" } },
      ],
    ],
  ])("conceals label provider outage", async (results) => {
    const f = fixture(results);
    await expect(f.directory.ownerForProduct("org", "product")).rejects.toThrow(
      "Responsible owners are temporarily unavailable.",
    );
  });

  it("scopes bounded membership lookup and excludes inactive accounts", async () => {
    const f = fixture([{ data: [{ users: user() }], error: null, count: 1 }]);
    expect(
      await f.directory.list("org", {
        page: 2,
        pageSize: 25,
        selectedOwnerId: id,
      }),
    ).toMatchObject({
      owners: { rows: [{ id, displayName: "Alice" }], page: 2, total: 1 },
      selectedOwner: { id, displayName: "Alice" },
    });
    expect(f.from).toHaveBeenCalledWith("organization_members");
    expect(f.chain.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(f.chain.eq).toHaveBeenCalledWith("users.is_active", true);
    expect(f.chain.range).toHaveBeenCalledWith(25, 49);
  });
  it("resolves selected owner separately using the same tenant and active scope", async () => {
    const f = fixture([
      { data: [], error: null, count: 0 },
      { data: { users: user(null) }, error: null },
    ]);
    expect(
      (
        await f.directory.list("org", {
          page: 1,
          pageSize: 25,
          selectedOwnerId: id,
        })
      ).selectedOwner,
    ).toEqual({ id, displayName: "alice" });
    expect(f.chain.eq).toHaveBeenCalledWith("user_id", id);
    expect(
      f.chain.eq.mock.calls.filter(
        (call: unknown[]) => call[0] === "organization_id",
      ),
    ).toHaveLength(2);
  });
  it("does not return a foreign or inactive selected owner", async () => {
    const f = fixture([
      { data: null, error: null, count: null },
      { data: null, error: null },
    ]);
    expect(
      (
        await f.directory.list("org", {
          page: 1,
          pageSize: 25,
          selectedOwnerId: id,
        })
      ).selectedOwner,
    ).toBeNull();
  });
  it("returns only bounded display text, no personal fields", async () => {
    const f = fixture([
      {
        data: [{ users: user("x".repeat(500)) }, { users: user(null, null) }],
        error: null,
        count: 2,
      },
    ]);
    const result = await f.directory.list("org", { page: 1, pageSize: 25 });
    expect(result.owners.rows[0]?.displayName).toHaveLength(300);
    expect(result.owners.rows[1]).toEqual({
      id,
      displayName: `Member ${id.slice(0, 8)}`,
    });
  });
  it.each([
    [[{ error: { message: "private" } }]],
    [[{ data: [], count: 0, error: null }, { error: { message: "private" } }]],
  ])("conceals provider failures", async (results) => {
    const f = fixture(results);
    await expect(
      f.directory.list("org", { page: 1, pageSize: 25, selectedOwnerId: id }),
    ).rejects.toThrow("Responsible owners are temporarily unavailable.");
  });
});
