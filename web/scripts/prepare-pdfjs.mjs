import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// Serve workers, CMaps and fonts from our own origin; no CDN or user PDF upload.
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const destination = path.resolve("public", "pdfjs", version);
await mkdir(destination, { recursive: true });
await cp(path.join(root, "build/pdf.worker.min.mjs"), path.join(destination, "pdf.worker.min.mjs"));
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(path.join(root, directory), path.join(destination, directory), { recursive: true });
}
