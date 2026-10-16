import { Readable } from "node:stream";
import { boundedJsonTokens } from "./bounded-json-tokens";
describe("bounded JSON tokens", () => {
  async function consume(text: string) {
    const values = [];
    for await (const token of boundedJsonTokens(
      Readable.from([Buffer.from(text)]),
    ))
      values.push(token);
    return values;
  }
  it("preserves keys, strings, numbers, booleans and null across chunks", async () => {
    const values = await consume(
      '{"name":"a","number":1,"t":true,"f":false,"nil":null}',
    );
    expect(values).toContainEqual({ name: "numberValue", value: 1 });
    expect(values).toContainEqual({ name: "stringValue", value: "a" });
  });
  it("rejects oversized scalars before a complete scalar is assembled", async () => {
    await expect(
      consume(JSON.stringify({ name: "a".repeat(1024 * 1024 + 1) })),
    ).rejects.toMatchObject({ code: "normalization_malformed_input" });
  });
  it("bounds aggregate long keys within a component", async () => {
    const component = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `${index}-${"k".repeat(80_000)}`,
        "x",
      ]),
    );
    await expect(
      consume(JSON.stringify({ components: [component] })),
    ).rejects.toMatchObject({ code: "normalization_malformed_input" });
  });
  it("rejects excessive nesting", async () => {
    await expect(
      consume("[".repeat(260) + "0" + "]".repeat(260)),
    ).rejects.toMatchObject({ code: "normalization_malformed_input" });
  });
  it.each(["1e-400", "1e400", "9".repeat(310)])(
    "rejects extreme numeric literal %s before conversion",
    async (number) => {
      await expect(consume(`{"version":${number}}`)).rejects.toMatchObject({
        code: "normalization_extreme_numeric_literal",
      });
    },
  );
  it("rejects duplicate object properties and large empty-object subtrees", async () => {
    await expect(
      consume('{"bomFormat":"CycloneDX","bomFormat":"spdx"}'),
    ).rejects.toMatchObject({ code: "normalization_malformed_input" });
    await expect(
      consume(
        JSON.stringify({
          components: [
            { extensions: Array.from({ length: 70_000 }, () => ({})) },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "normalization_malformed_input" });
  });
  it("forwards upstream errors and destroys the source", async () => {
    const source = Readable.from(
      (async function* () {
        await Promise.resolve();
        yield Buffer.from('{"x":');
        throw new Error("provider failed");
      })(),
    );
    await expect(
      (async () => {
        for await (const token of boundedJsonTokens(source)) void token;
      })(),
    ).rejects.toThrow("provider failed");
    expect(source.destroyed).toBe(true);
  });
});
