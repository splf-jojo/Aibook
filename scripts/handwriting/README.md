# Handwriting dev tools

- `/dev` — **Datasets** and **Writing**.
- `/dev/dataset` — **Analysis** and **Labeling**.
- `/dev/dataset/labeling` — persistent dataset catalog and **Add dataset**.
- `/dev/dataset/labeling/[id]` — human review, gallery, approval and export.
- `/dev/dataset/analysis` — approved datasets; `/dev/dataset/analysis/[id]` computes and displays
  **Symbol | Heatmap | Medoid**. Switch between **Centered** and **Aligned**;
  open a sample count to inspect the normalized examples.
- `/dev/writing` — text/LaTeX input, available medoids, settings and handwriting.
- Old `/dev/analysis`, `/dev/labeling` and their dataset links redirect to the
  new routes. `/dev/handwriting` redirects to the labeling catalog.

All dev UI labels and errors are English. Follow `docs/UI_DESIGN_PROMPT.md`.

## Local run

```powershell
$env:HANDWRITING_REVIEW_ENABLED = "1"
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --no-deps --wait --wait-timeout 120 web
```

Open `http://localhost/dev`. The flag defaults to `0` in production. Pages and
JSON routes additionally require a localhost/loopback Host; mutations require
same-origin JSON requests. This is a local developer tool, not a public,
multi-user service. Do not expose its storage or enable it on a public proxy.

Compose mounts `./data/handwriting/datasets` into the web container at
`/app/data/handwriting/datasets`. Files survive container recreation and browser
storage cleanup. In `next dev` started from `web/`, the same repository folder
is used by default. `HANDWRITING_DATA_DIR` overrides the path. A Linux bind mount
must be writable by the web container user (UID 1001).

## Storage and review

Each dataset has its own directory identified by the SHA-256 of the canonical
candidate pack:

- `candidates.json` — immutable crops, labels and PDF provenance.
- `state.json` — display name, review decisions, undo history, approval and version.
- `original-approved.json` — archived imported approval, when present.
- `analysis/index.json` — latest analysis metadata.
- `analysis/[key].json` — computed images, measurements, settings and source version.

The whole `data/handwriting/` tree is ignored by Git and excluded from image
tracing. Back up this folder separately. Dataset names never become filesystem
paths. Imports publish a complete directory atomically. Saves use a temporary
file, flush and atomic rename; version checks and a per-dataset exclusive lock
prevent stale tabs from overwriting decisions. A save failure leaves the current
sample on screen with a **Reload** action. If a process is forcibly killed during
a write, an orphan `.review.lock` may remain: stop the web service before removing
that specific lock, then restart it. Never remove an active writer's lock.

**Add dataset** accepts candidate JSON up to 40 MB, 1–5000 samples, schema version
1, kind `handwriting-candidates`. Each sample carries `id`, `latex`, embedded PNG
`image` and `context`, and `source` with `file`, PDF `sha256`, one-based `page`,
`pageWidth`, `pageHeight`, and `box: [x, y, width, height]` in PDF points from the
top left. IDs and source crops must be unique; bounds, LaTeX and PNG data URLs
are validated. Approval claims inside a candidate file are ignored. New packs
start unreviewed; importing an identical pack opens its existing decisions.

Review shortcuts: **Left** rejects, **Right** accepts, **Up** records a correct
symbol with a wrong outline, **Down** records a correct outline with a wrong
symbol. The two partial outcomes are rejections with an `issue` field. They stay
in the audit and are excluded from eligible samples. Auto-repeat and shortcuts
while editing are suppressed. Images must load before acceptance.

The gallery supports filters, label search, correction and undo. **Approve
dataset** requires a decision on every candidate and at least one symbol with
three accepted examples. Export and the analysis preview include only symbols
meeting that threshold. Revising or undoing a decision clears approval.

## Import an existing approved review

Approved exports omit rejected crops and underrepresented symbols. Import them
with their exact original candidate pack to preserve **all** review decisions:

```powershell
node scripts/handwriting/import_reviewed.mjs approved.json candidates.json "Dataset name"
```

Requires Node 24 and installed `web/node_modules`. The command verifies the
source fingerprint, decisions, exported samples and exclusions before writing.
It preserves approval timestamps and archives the original export. Exports do
not contain undo history, so imported history starts empty. Existing library
reviews are never overwritten by a repeated import. The old IndexedDB data and
files in Downloads are not changed. The runtime store no longer uses IndexedDB;
`handwriting-review-storage.ts` remains only as a legacy recovery helper.

## Local JSON routes

These Next.js routes are under `/dev`, separate from the FastAPI `/api` prefix:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/dev/datasets` | Catalog summaries, without embedded images |
| POST | `/dev/datasets` | Import `{ dataset: candidatePack }` |
| GET | `/dev/datasets/[id]` | Dataset and current review |
| PATCH | `/dev/datasets/[id]` | Versioned `decide`, `undo` or `approve` command |
| GET | `/dev/datasets/[id]/analysis` | Current results, eligible counts or progress |
| POST | `/dev/datasets/[id]/analysis` | Compute analysis with `{ expectedVersion }` |
| GET | `/dev/datasets/[id]/writing` | Current medoids as transparent PNGs |

Every PATCH includes `expectedVersion`. A decide command also includes
`sampleId`, `status`, `latex`, and optionally `issue`. Responses contain the saved
`review` and new `version`; undo also returns `selectedId`. Stale writes return
409. HTTP responses are not cached; valid computed results are reused from disk.

## Analysis — phase 2

Only accepted samples grouped by their **reviewed** LaTeX label participate.
The dataset must remain approved, and each class needs at least three examples.
Rare classes and rejected crops do not get a heatmap or a medoid. No labels,
approval decisions, outliers or missing strokes are inferred or changed.

1. Decode each PNG with Sharp, flatten transparency onto white and convert to
   grayscale. Reject malformed, multi-page, empty or over-4-million-pixel images.
2. Trim the bounding box at 12% ink coverage. Resize proportionally into a
   128×128 canvas with 16 px padding; `\sin`, `\cos`, `dx`, `dy` use 256×128.
   Center by ink mass, reserving enough margin for alignment. There is no
   rotation, slant correction, independent axis stretching or stroke cleanup.
3. Extract contours at 25% ink coverage. Compare each pair with the symmetric
   mean nearest-contour distance, approximated by an 8-neighbour chamfer field
   (horizontal/vertical cost 1, diagonal cost √2). Search translations within
   ±6 px on both axes. This measures outline similarity, not recognition confidence.
4. Choose the real sample minimizing the sum of these pairwise distances.
   Ties are resolved by sample ID. This is the medoid; its displayed image is
   its normalized crop. Align the other examples to this sample by translation.
5. Average grayscale ink coverage per pixel, once before and once after the
   translation. Heatmaps share a fixed 0–100% white-to-dark-red scale, without
   renormalizing each image's maximum. A dark pixel means repeated ink coverage.

Saved results contain both heatmaps, 8-bit grayscale density maps (0 = no ink,
255 = full coverage), every centered/aligned sample, source PDF coordinates,
original pixel sizes, trim boxes, scale, offsets, shifts, distances and medoid ID.
The original PNGs remain in `candidates.json`. Pixel distances compare examples
within one class; normalization removes absolute writing size. The PDF metrics
remain available for future formula layout. Raster normalization does not recover
pen trajectories or train a font.

One invalid accepted crop fails its entire symbol group; other groups can finish.
The page shows the affected group and a Review link, and the catalog says
**Incomplete**. No accepted sample is silently removed. Current local limits are
64 samples per class, 60 seconds of pair comparisons per class, and a 120-second
budget checked between groups. Oversized/unfinished groups get an explicit error.

The cache key covers dataset fingerprint, review version, approval timestamp and
all algorithm settings. Any changed/undone decision clears approval and hides
old results; after approval, **Reanalyze** computes a new version. Results from
earlier review versions remain on disk. Computation never writes `state.json`
or the imported approval. Bump the algorithm version when changing computation
or its image-processing dependency so an older cache cannot be reused.
Concurrent requests in one web process share a promise and progress; at most two
datasets run at once. POST waits for completion, while GET can report progress.
A process restart drops in-memory work but retains completed results. Multiple
processes may duplicate computation; versioned atomic files prevent partial
publication, and readers always compare the cache key with the current review.
This is a local process model, not a distributed job queue.

Implementation: `web/lib/handwriting-analysis.server.ts`, shared settings/types
in `handwriting-analysis.ts`, persistence in `handwriting-store.server.ts`.
PNG decoding and resizing use [Sharp](https://sharp.pixelplumbing.com/api-resize/).

## Writing

Select an analyzed dataset, enter **Text** or **LaTeX**, and adjust **Size** and
**Variation**. The available symbols are shown below the dataset selector.
Text also has letter and line spacing under **Spacing**, and wraps to the result
panel width. LaTeX keeps mathematical spacing and supports the installed MathJax
base/AMS syntax, including fractions, superscripts, subscripts and aligned arrays.
Optional outer `$...$`, `$$...$$`, `\(...\)` or `\[...\]` delimiters are accepted.

The normal mathematical preview uses MathJax's SVG output. Each supported symbol
in the handwriting result is a real medoid, fitted proportionally into the math
layout. Adjacent `dx`/`dy` atoms and function names such as `\sin` can use their
whole saved medoid. Compound matches cannot cross script or fraction boundaries.
Fraction bars and other structural rules are geometric strokes; missing symbol
outlines are never filled by a standard font. Missing symbols appear as red
dashed boxes and in **Missing symbols**. Unsupported commands/layouts and invalid
LaTeX are reported explicitly. The normal preview remains available even before
a dataset has usable medoids.

The Writing endpoint reads the current analysis, takes only successful medoids,
crops their normalized padding and converts white paper to transparent pixels.
It does not modify images on disk, review decisions or approval. Unapproved,
outdated or uncomputed analyses return no glyphs; the page links to review or
analysis. Returning to the browser tab refreshes dataset availability.

Variation applies bounded changes of position, rotation (up to 5 degrees) and
uniform scale (up to 6%); it does not synthesize strokes. A fixed seed makes it
repeatable. At zero variation the seed has no effect; **Reshuffle variation**
changes the seed. **Download PNG** exports the displayed result, including visible
missing-symbol markers. Input/settings stay in the current page session.

Limits: 2,000 input characters, 600 MathJax paths/text elements, bounded formula
and image dimensions. Runtime code is in `handwriting-writing*.ts`; the existing
canvas formula renderer is separate. SVG conversion uses the installed
[MathJax SVG output](https://docs.mathjax.org/en/v3.2/options/output/svg.html) with
self-contained paths and no remote fonts or TeX extension loading.

## Подготовка вырезок

`build_candidates.py` **не выполняет OCR или автоматическую сегментацию**.
Он собирает кандидатов по предложенным координатам, которые затем проверяет
человек. Подписи и координаты можно подготовить отдельно вручную или моделью.
Нужны Python с `pypdf`, `Pillow` и Poppler (`pdftoppm`).

Пример manifest (хранить вместе с личными данными вне Git):

```json
{
  "name": "Очередь проверки",
  "removeBlueGrid": false,
  "samples": [
    { "file": "notes.pdf", "page": 1, "latex": "x", "box": [72, 96, 14, 22] }
  ]
}
```

```powershell
python scripts/handwriting/build_candidates.py --notes C:\path\to\notes --manifest output/handwriting/manifest.json --output output/handwriting/candidates.json
```

Можно передать `--pdftoppm C:\path\to\pdftoppm.exe`. Рендеры кешируются рядом
с выходным файлом в `.render-cache/`. Исходные PDF не меняются.

`removeBlueGrid: true` предназначен только для проверенного шаблона с чёрными
чернилами на белой бумаге с синей сеткой RGB `(163,183,211)`. Это маска цвета,
не дорисовка. Другие цвета чернил/бумаги этим режимом обрабатывать нельзя.
Контекст всегда сохраняет исходные цвета для проверки потерь и соседних штрихов.
Первая версия сборщика требует PDF без поворота, с совпадающими media/crop boxes
и нулевым началом координат; несовместимые документы отклоняются явно.

## Checks

```powershell
Set-Location web
node tests/handwriting-dataset.test.mjs
node tests/handwriting-library.test.mjs
node tests/handwriting-analysis.test.mjs
node tests/handwriting-writing.test.mjs
npm run typecheck
```

Browser acceptance tests must use synthetic datasets. Never approve personal
samples on the user's behalf.
