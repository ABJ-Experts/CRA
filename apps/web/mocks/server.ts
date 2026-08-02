import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * Server-side MSW interceptor, started from `instrumentation.ts`.
 *
 * The browser worker alone is not enough: anything fetched during SSR or a
 * build would bypass it and hit a URL that does not exist. Running the node
 * interceptor as well means the same handlers answer in both places, so a
 * page can be rendered on the server later without the data layer changing.
 */
export const server = setupServer(...handlers);
