/**
 * Opt-in, loopback-only Ollama protocol fixture for M9-05 browser journeys.
 * Run with `node apps/api/scripts/m9-05/ollama-stub.mjs`; configure
 * AI_OLLAMA_URL=http://127.0.0.1:11439 and AI_OLLAMA_MODEL=m9-05-fixture:v1.
 * This service has no tools, upstream calls, or tenant-data persistence.
 */
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 11439;
const model = "m9-05-fixture:v1";
const markers = [
  { fieldKey: "certification_held", needle: "ISO 9001:2015" },
  { fieldKey: "valid_until", needle: "2027-12-31" },
];

function fail(response, status) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "invalid fixture request" }));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/chat") {
    fail(response, 404);
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100_000) {
      fail(response, 413);
      return;
    }
    chunks.push(chunk);
  }
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (payload.model !== model || !Array.isArray(payload.messages)) {
      fail(response, 400);
      return;
    }
    const userMessage = payload.messages.find((entry) => entry.role === "user");
    const pages = JSON.parse(userMessage.content).pages;
    if (!Array.isArray(pages) || pages.length !== 1) {
      fail(response, 400);
      return;
    }
    const page = pages[0];
    const codepoints = Array.from(page.text);
    const candidates = markers.map(({ fieldKey, needle }) => {
      const target = Array.from(needle);
      const startOffset = codepoints.findIndex((_, index) =>
        target.every(
          (character, offset) => codepoints[index + offset] === character,
        ),
      );
      if (startOffset < 0) throw new Error("Fixture text marker missing");
      const endOffset = startOffset + target.length;
      if (codepoints.slice(startOffset, endOffset).join("") !== needle)
        throw new Error("Invalid fixture span");
      return {
        fieldKey,
        candidateGroup: fieldKey,
        originalValue: needle,
        confidence: 0.97,
        sourceSpan: { page: page.page, startOffset, endOffset, quote: needle },
      };
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model,
        message: { role: "assistant", content: JSON.stringify({ candidates }) },
        done_reason: "stop",
        prompt_eval_count: 300,
        eval_count: 100,
      }),
    );
  } catch {
    fail(response, 400);
  }
}).listen(port, host, () => {
  process.stdout.write(`M9-05 fixture listening on http://${host}:${port}\n`);
});
