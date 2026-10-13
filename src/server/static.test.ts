import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { productionRoutes } from "./static";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "note-line-static-"));
  await mkdir(join(directory, "assets"));
  await Bun.write(join(directory, "index.html"), "<h1>Built frontend</h1>");
  await Bun.write(join(directory, "assets/app-abc123.js"), "console.log('built');");
  await Bun.write(join(directory, "private.txt"), "not a public asset");
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("production frontend", () => {
  test("serves built HTML and immutable assets, but no arbitrary files", async () => {
    const routes = await productionRoutes(directory);
    expect(Object.keys(routes).sort()).toEqual(["/", "/assets/app-abc123.js"]);
    expect(await routes["/"]!.text()).toBe("<h1>Built frontend</h1>");
    expect(routes["/"]!.headers.get("Cache-Control")).toBe("no-cache");
    expect(routes["/"]!.headers.get("Content-Type")).toContain("text/html");
    const asset = routes["/assets/app-abc123.js"]!;
    expect(await asset.text()).toBe("console.log('built');");
    expect(asset.headers.get("Cache-Control")).toContain("immutable");
    expect(asset.headers.get("Content-Type")).toContain("javascript");
  });

  test("explains how to build when dist is missing", async () => {
    await expect(productionRoutes(join(directory, "missing"))).rejects.toThrow("bun run prod");
  });
});
