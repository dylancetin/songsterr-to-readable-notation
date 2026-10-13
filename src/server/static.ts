import { fileURLToPath } from "node:url";
import { join } from "node:path";

export async function productionRoutes(directory = fileURLToPath(new URL("../../dist/", import.meta.url))) {
  const index = Bun.file(join(directory, "index.html"));
  if (!(await index.exists())) {
    throw new Error("The production frontend is missing. Run bun run build or bun run prod first.");
  }

  const routes: Record<string, Response> & { "/": Response } = {
    "/": new Response(index, { headers: { "Cache-Control": "no-cache" } }),
  };
  // Register only built asset paths, never arbitrary paths from incoming requests.
  for await (const path of new Bun.Glob("assets/**/*").scan({ cwd: directory, onlyFiles: true })) {
    routes[`/${path}`] = new Response(Bun.file(join(directory, path)), {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }
  return routes;
}
