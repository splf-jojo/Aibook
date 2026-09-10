// Isolated browser fixture, bound to loopback. No real accounts, API or database writes.
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = resolve(root, "../output/dev-ui");
await mkdir(out, { recursive: true });
await build({ absWorkingDir: root, entryPoints: ["tests/dev-ui-fixture.tsx"], bundle: true, outdir: out, entryNames: "fixture", format: "esm", sourcemap: true,
  alias: { "next/link": resolve(root, "tests/dev-ui-router.tsx"), "next/navigation": resolve(root, "tests/dev-ui-router.tsx") },
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_API_URL": '""' }, loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
});
const types = { ".js": "text/javascript", ".css": "text/css", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const shell = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dev UI · Synthetic fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/" || path === "/dev" || path.startsWith("/dev/")) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(shell); return; }
  const base = path.startsWith("/fonts/") ? resolve(root, "public") : out;
  const target = resolve(base, `.${path}`);
  if (!target.startsWith(base + sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader("Content-Type", types[extname(target)] ?? "application/octet-stream"); res.end(await readFile(target)); }
  catch { res.writeHead(404).end(); }
}).listen(4318, "127.0.0.1", () => console.log("Synthetic Dev UI: http://127.0.0.1:4318/dev"));
