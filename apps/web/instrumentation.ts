/**
 * Next.js runs this once per server process, before any request is handled.
 *
 * It is where the node-side MSW interceptor is started, so server rendering
 * and the production build resolve `/api/*` the same way the browser does.
 * Guarded on the runtime because `msw/node` depends on node internals and
 * cannot be loaded on the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false") return;

  const { server } = await import("./mocks/server");
  server.listen({
    /* The app also fetches Google Fonts and Next's own internals during a
     * build. Erroring on anything unhandled would break those, so unmatched
     * requests pass straight through. */
    onUnhandledRequest: "bypass",
  });
}
