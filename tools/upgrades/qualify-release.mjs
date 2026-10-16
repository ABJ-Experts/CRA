// Compatibility entry point: qualification always uses the fixed repository
// runner. No arbitrary executable or release-supplied hook is accepted.
import { runReference } from "./reference-runner.mjs";
const [request, output, ...extra] = process.argv.slice(2);
if (!request || !output || extra.length)
  throw new Error("usage: qualify-release.mjs request.json NEW_RESULT.json");
runReference(request, output).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
