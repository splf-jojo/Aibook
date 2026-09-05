# Handwriting dev tools — phase 1

- `/dev` — **Labeling** and **Analysis**.
- `/dev/labeling` — persistent dataset catalog and **Add dataset**.
- `/dev/labeling/[id]` — human review, gallery, approval and export.
- `/dev/analysis` — approved datasets; `/dev/analysis/[id]` lists eligible symbols
  in **Symbol | Heatmap | Medoid** order. Analysis is not implemented in phase 1:
  **Analyze** is disabled, and no heatmaps or medoids are fabricated.
- `/dev/handwriting` redirects to the labeling catalog.

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
| GET | `/dev/datasets/[id]/analysis` | Approval state and eligible symbol counts |

Every PATCH includes `expectedVersion`. A decide command also includes
`sampleId`, `status`, `latex`, and optionally `issue`. Responses contain the saved
`review` and new `version`; undo also returns `selectedId`. Stale writes return
409. JSON responses are not cached. There is no analysis computation endpoint.

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

## Next phase

Phase 2 adds proportional normalization, alignment, heatmaps, medoid selection,
and saved analysis results keyed to the reviewed data and analysis settings.
The current output remains reviewed PDF crops, not recovered pen trajectories
or a trained font. Changed crops must be reviewed again.

## Checks

```powershell
Set-Location web
node tests/handwriting-dataset.test.mjs
node tests/handwriting-library.test.mjs
npm run typecheck
```

Browser acceptance tests must use synthetic datasets. Never approve personal
samples on the user's behalf.
