import page from "./src/index.html";
import { ImportError, importSong } from "./src/server/songsterr";
import { productionRoutes } from "./src/server/static";
import { importRequestSchema } from "./src/shared/model";

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const server = Bun.serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  port,
  development: !production,
  idleTimeout: 60,
  maxRequestBodySize: 8192,
  routes: {
    ...(production ? await productionRoutes() : { "/": page }),
    "/songsterr-note-line.user.js": () => new Response(
      Bun.file(new URL("./scripts/songsterr-note-line.user.js", import.meta.url)),
      { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" } },
    ),
    "/api/health": () => Response.json({ status: "ok" }),
    "/api/import": {
      POST: async (request) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Send a JSON body containing a Songsterr URL." }, { status: 400 });
        }
        const parsed = importRequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Provide a Songsterr URL and an optional nonnegative track ID." }, { status: 400 });
        }
        try {
          return Response.json(await importSong(parsed.data), { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          if (error instanceof ImportError) {
            return Response.json({ error: error.message }, { status: error.status });
          }
          console.error(JSON.stringify({ event: "song_import_failed", error: error instanceof Error ? error.message : String(error) }));
          return Response.json({ error: "The song could not be imported. Try again or paste another Songsterr link." }, { status: 500 });
        }
      },
    },
  },
  fetch: () => Response.json({ error: "This route does not exist." }, { status: 404 }),
});

process.stdout.write(`Note / line is running at http://localhost:${server.port}\n`);
