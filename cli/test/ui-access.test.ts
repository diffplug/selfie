import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import { PORT, HOST, ORIGIN, UNKNOWN_HASH, UNKNOWN_BATCH, h, app, review, get, change, viewOf } from "./ui-support.ts";

describe("who may ask", () => {
  test("refuses any Host but its own loopback address and port, on every route", async () => {
    const refused = ["evil.example", `evil.example:${PORT}`, "127.0.0.1", "127.0.0.1:1", "0.0.0.0:4173", "[::1]:1"];
    for (const host of refused) {
      for (const url of ["/api/stories", "/", `/api/images/${UNKNOWN_HASH}`, "/assets/a.js"]) {
        const response = await app.request(url, { headers: { host } });
        expect(response.status, `${host} ${url}`).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "bad-host" } });
      }
    }
    expect((await app.request("/api/stories")).status).toBe(403);
    expect((await get("/api/stories", { host: `localhost:${PORT}` })).status).toBe(200);
    expect((await get("/api/stories", { host: HOST })).status).toBe(200);
  });

  describe("a change from another site", () => {
    let batchId: string;
    let target: { story: string; imageHash: string };
    beforeEach(async () => {
      h.stories = [{ id: "a" }];
      ({ batchId } = (await review()).json);
      const [{ story, imageHash }] = (await viewOf(batchId)).rows;
      target = { story, imageHash };
    });
    const body = () => ({ decision: "approved", renders: [target] });
    const nothingDecided = async () => expect((await viewOf(batchId)).counts.undecided).toBe(1);

    test("is refused for a foreign Origin, even with the header and the type", async () => {
      for (const origin of ["https://evil.example", "null", `http://localhost:${PORT}`, "http://127.0.0.1:1"]) {
        const response = await change(`/api/batches/${batchId}/decisions`, body(), { origin });
        expect(response.status, origin).toBe(403);
      }
      await nothingDecided();
    });

    test("is refused as a form could send it", async () => {
      for (const contentType of ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]) {
        const response = await app.request(`/api/batches/${batchId}/decisions`, {
          method: "POST",
          body: JSON.stringify(body()),
          headers: { host: HOST, "content-type": contentType },
        });
        expect(response.status, contentType).toBe(403);
      }
      await nothingDecided();
    });

    test("is refused without the custom header, or with the wrong type, whatever the Origin", async () => {
      const noHeader = await app.request(`/api/batches/${batchId}/decisions`, {
        method: "POST",
        body: JSON.stringify(body()),
        headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
      });
      expect(noHeader.status).toBe(403);
      const wrongType = await change(`/api/batches/${batchId}/decisions`, body(), { "content-type": "text/plain" });
      expect(wrongType.status).toBe(403);
      const accepting = await app.request(`/api/batches/${batchId}/accept`, { method: "POST", body: "{}", headers: { host: HOST } });
      expect(accepting.status).toBe(403);
      await nothingDecided();
    });

    test("gets no CORS answer to a preflight", async () => {
      const response = await app.request(`/api/batches/${batchId}/decisions`, {
        method: "OPTIONS",
        headers: {
          host: HOST,
          origin: "https://evil.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-selfie-request,content-type",
        },
      });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-headers")).toBeNull();
    });

    test("can't be read or framed", async () => {
      expect((await get("/api/stories", { origin: "https://evil.example" })).status).toBe(403);
      const refused = await get("/api/stories", { host: "evil.example" });
      for (const response of [await get("/"), await get("/api/stories"), refused]) {
        expect(response.headers.get("content-security-policy")).toBe(
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
    });

    test("succeeds from the page itself, by either name", async () => {
      expect((await change(`/api/batches/${batchId}/decisions`, body())).status).toBe(200);
      const fromLocalhost = await change(`/api/batches/${batchId}/decisions`, body(), {
        host: `localhost:${PORT}`,
        origin: `http://localhost:${PORT}`,
      });
      expect(fromLocalhost.status).toBe(200);
    });
  });
});

describe("pages", () => {
  test("any page is the client's one document, and an unknown API route isn't", async () => {
    for (const url of ["/", `/batches/${UNKNOWN_BATCH}`, `/batches/${UNKNOWN_BATCH}/accept`, `/batches/${UNKNOWN_BATCH}/stories/a%20story%2Fone`]) {
      const response = await get(url);
      expect(await response.text(), url).toContain("the client");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const unknown = await get("/api/nothing");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "not-found" } });
    expect((await change("/api/nothing", {})).status).toBe(404);
  });

  test("serves assets, but nothing outside the client", async () => {
    const asset = await get("/assets/a.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await get("/assets/missing.js")).status).toBe(404);
    for (const url of ["/assets/../../secret.txt", "/assets/..%2f..%2fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt"]) {
      expect(await (await get(url)).text(), url).not.toContain("not for serving");
    }
  });
});

function modulesLoadedBy(file: string): string[] {
  const script = `
    import { registerHooks } from "node:module";
    const seen = [];
    registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); seen.push(result.url); return result; } });
    await import(${JSON.stringify(pathToFileURL(file).href)});
    console.log(JSON.stringify(seen));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
}

describe("what each entry point loads", () => {
  const root = path.resolve(import.meta.dirname, "../..");

  test("the CLI loads no web server until a command that serves asks for one", () => {
    const loaded = modulesLoadedBy(path.join(root, "cli/src/cli.ts"));
    expect(loaded.length).toBeGreaterThan(5);
    expect(loaded.filter((url) => url.includes("hono") || url.includes("/ui/src/server/") || url.includes("/ui/src/client/"))).toEqual([]);
  });

  test("the routes and their protections need nothing of a platform", () => {
    const loaded = modulesLoadedBy(path.join(root, "ui/src/server/app.ts"));
    expect(loaded.filter((url) => url.startsWith("node:") || url.includes("/server/local") || url.includes("@hono/node-server"))).toEqual([]);
  });
});
