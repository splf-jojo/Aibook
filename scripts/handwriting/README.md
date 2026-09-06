# Handwriting dev tools

- `/dev` — **Datasets** and **Writing**.
- `/dev/dataset` — persistent dataset catalog, **Add dataset**, and **Labeling** /
  **Analysis** actions on each dataset row.
- `/dev/dataset/labeling/[id]` — human review, gallery, approval and export.
- `/dev/dataset/analysis/[id]` computes and displays
  **Symbol | Heatmap | Medoid**. Switch between **Centered** and **Aligned**;
  open a sample count to inspect the normalized examples.
- `/dev/writing` — text/LaTeX input, available medoids, settings and handwriting.
- Old catalog routes `/dev/analysis`, `/dev/labeling`, `/dev/dataset/analysis`,
  `/dev/dataset/labeling` and `/dev/handwriting` redirect to `/dev/dataset`.
  Old individual dataset links redirect to their current review/analysis pages.

All dev UI labels and errors are English. Follow `docs/UI_DESIGN_PROMPT.md`.

## Shared cloud storage and access

Local Docker and ECS run the same stack. `/dev` requires an AIbook account with
the server-side `dev` role; its username can be anything. `/handwriting` is the
signed-in user catalog: published handwriting and the user's own exports.
Owners and dev can read source datasets; only dev can label, approve, analyze
or publish. Other users receive published glyphs, never private source packs.

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait --wait-timeout 120
docker compose --env-file .env.production -f docker-compose.production.yml exec api python -m app.manage grant-dev USERNAME
```

Create the intended account through ordinary registration before assigning its
role. Registration never grants dev access. Do not publish `/dev` by bypassing
authentication. `HANDWRITING_REVIEW_ENABLED=0` hides dev routes if needed; Compose
enables them behind role checks. Dev cookies are HttpOnly, SameSite Strict,
scoped to `/dev`, with an eight-hour maximum lifetime. Mutations require a
same-origin JSON request. Every request revalidates the account with FastAPI.
`INTERNAL_API_URL` is `http://api:8000` inside Docker.

## Storage and review

PostgreSQL stores immutable source snapshots, review decisions/history/version,
analysis jobs and immutable publications. PNGs and original PencilKit archives
are stored as deduplicated `bytea`; JSON uses internal references. Back up the
PostgreSQL volume/database, not browser storage. The old filesystem directory is
only a migration input; `HANDWRITING_DATA_DIR` is no longer a runtime setting.

Imports accept JSON up to 40 MiB and 1–5000 samples. Schema v1 preserves PDF
provenance. Schema v2 carries `source.kind=pencilkit`, pure ink PNGs, original
PKDrawing, worksheet configuration and cell geometry. One-based page numbers and
`[x,y,width,height]` boxes use page points from the top left. Page/cell overshoot
is not silently clipped. iPad groups strokes by the strongest cell intersection;
ambiguous cell crossings are flagged for human review. Unassigned strokes remain
in the original archive. This is cell-based collection, not OCR.

Dataset IDs include the owner and canonical pack fingerprint. Retrying the same
upload returns the existing dataset without overwriting review. Changing the
source creates a new snapshot. Review updates use PostgreSQL compare-and-swap
versions; stale or concurrent changes return 409. Approvals in uploaded candidate
JSON do not grant approval.

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
node scripts/handwriting/import_reviewed.mjs approved.json candidates.json "Dataset name" dev
```

Requires Node 24, installed `web/node_modules`, PostgreSQL environment variables
(`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) and an existing dev-role owner. The command verifies the
source fingerprint, decisions, exported samples and exclusions before writing.
It preserves approval timestamps and archives the original export. Exports do
not contain undo history, so imported history starts empty. Existing library
reviews are never overwritten by a repeated import. The old IndexedDB data and
files in Downloads are not changed. The runtime store no longer uses IndexedDB;
`handwriting-review-storage.ts` remains only as a legacy recovery helper.

## Dev JSON routes

These Next.js routes are under `/dev`, separate from the FastAPI `/api` prefix:

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/dev/session` | Sign in with `{ username, password }` or validate an existing `{ token }` |
| GET | `/dev/session` | Verify the current Dev session |
| DELETE | `/dev/session` | Clear the Dev session cookie |
| GET | `/dev/datasets` | Catalog summaries, without embedded images |
| POST | `/dev/datasets` | Import `{ dataset: candidatePack }` |
| GET | `/dev/datasets/[id]` | Dataset and current review |
| PATCH | `/dev/datasets/[id]` | Versioned `decide`, `undo` or `approve` command |
| GET | `/dev/datasets/[id]/analysis` | Current results, eligible counts or progress |
| POST | `/dev/datasets/[id]/analysis` | Enqueue analysis with `{ expectedVersion }` |
| GET | `/dev/datasets/[id]/writing` | Current medoids as transparent PNGs |

Every PATCH includes `expectedVersion`. A decide command also includes
`sampleId`, `status`, `latex`, and optionally `issue`. Responses contain the saved
`review` and new `version`; undo also returns `selectedId`. Stale writes return
409. HTTP responses are not cached; computed results are reused from PostgreSQL.
`POST /dev/datasets/[id]/publish` publishes the current version with
`{ expectedVersion }`. Public client routes and payloads are documented in `API.md`.

## Analysis and publication

The separate `handwriting-worker` service processes persistent jobs serially.
PostgreSQL advisory locking prevents duplicate workers; interrupted jobs return
to the queue after a restart. Work is bounded by per-symbol limits and a job time
budget, with progress and failures stored in the database. The ECS image is built
on the Windows laptop for `linux/amd64`.

Analysis does not publish automatically. **Publish** creates an immutable version
of the available real medoids. All signed-in users can use it. Later review edits
or recomputation leave that publication unchanged; a new approved version needs
another explicit publication. Missing symbols retain the existing font fallback.

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
**Incomplete**. No accepted sample is silently removed. Current limits are
64 samples per class, 60 seconds of pair comparisons per class, and a 120-second
budget checked between groups. Oversized/unfinished groups get an explicit error.

The job key covers owner-scoped dataset ID, review version and algorithm settings.
A changed decision clears approval and hides obsolete analysis; older jobs remain
in PostgreSQL for audit. POST enqueues and returns promptly, GET reports progress.
The single worker uses a database advisory lock. A restart requeues interrupted
jobs. Updating the algorithm requires bumping its settings version. Previously
published glyphs remain immutable and are not rebuilt by analysis.

Implementation: `web/lib/handwriting-analysis.server.ts`, shared settings/types
in `handwriting-analysis.ts`, persistence in `handwriting-store.server.ts`.
PNG decoding and resizing use [Sharp](https://sharp.pixelplumbing.com/api-resize/).

## Writing

Select an analyzed dataset, enter **Text** or **LaTeX**, and adjust **Size** and
**Variation**. On desktop, input, available symbols and previews occupy the left
column; dataset and rendering settings occupy the right. On narrow screens,
settings stack above the workspace. The available symbols appear below the input, each
with its actual medoid underneath. **Examples** inserts one of seven LaTeX presets
(fractions, powers, trigonometry, derivative, integral, sum and multiple lines).
Presets use the same missing-symbol checks as manually entered formulas.
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

Ordinary symbols use a common line cell (0.8 em ascent, 0.2 em descent), with
letters aligned to a baseline and operators centered on the math axis. Superscripts,
subscripts, fractions and large/stretching operators retain their mathematical
placement. Medoids still preserve their proportions and fit within their cells.

**Vertical scatter** independently translates baseline items by up to ±30 px.
At zero, cells on the same baseline are aligned. A base with its scripts, a whole
fraction or root moves as one item, so its internal structure remains intact.
Text compound medoids move as one item too. Scatter is measured in output pixels,
independent of font size. **Variation** applies horizontal jitter, rotation (up to
5 degrees) and uniform scale (up to 6%), without changing the cell baseline or
synthesizing strokes. A fixed seed makes both controls repeatable. With both at
zero the seed has no effect; **Reshuffle variation** changes the shared seed.
**Download PNG** exports the displayed result, including visible
missing-symbol markers. Input/settings stay in the current page session.

**Spacing** contains global **Padding** and **Margin** (0–24 px at the base font
size), with individual top/right/bottom/left controls and **Reset spacing**.
Padding reduces the interior of the existing symbol cell without distorting
the medoid or moving neighboring cells. Insets are proportionally limited per
axis to retain a drawable interior for thin operators and small scripts. The
inspector reports the effective values. Margin expands the space allocated to
each symbol: Text recomputes advances, wrapping and line heights; LaTeX uses
MathML `mpadded` before MathJax layout, so fractions, scripts and tables reflow.
Compound medoids such as `dx` remain one unit; numbers use one unit per digit.
Math spacing scales with the local font size in scripts. Zero insets leave the
line cells unchanged; the ordinary LaTeX preview is unaffected by these settings.
Generated structures, including the radical sign and fraction/root rules, keep
MathJax's structural spacing; the radical inspector reports zero added margin.

**Boxes**, beside **Handwriting**, overlays glyph bounds, cells, padding and
margins. Click a box (or focus it and press Enter/Space) to inspect its dimensions,
position, rotation and applied insets. Variation can move ink outside the cell;
the canvas includes the transformed bounds. The overlay is separate from the
rendered SVG, so toggling it changes neither the handwriting nor the PNG export.

Limits: 2,000 input characters, 600 MathJax paths/text elements, bounded formula
and image dimensions. Runtime code is in `handwriting-writing*.ts`; AI canvas
solutions reuse this renderer as described below. SVG conversion uses the installed
[MathJax SVG output](https://docs.mathjax.org/en/v3.2/options/output/svg.html) with
self-contained paths and no remote fonts or TeX extension loading.

## Почерк в решениях ИИ на web-холсте

В панели ИИ шестерёнка **Settings** слева от **New chat** открывает выбор
**Почерк**, список шрифтовых замен и отмену/возврат решения. Выбор почерка
предлагает **Автоматически**, **Шрифт** и доступные
опубликованные наборы. Доступен обычный вход пользователя: web запрашивает
`/api/handwriting/fonts` с JWT; Dev-сессия и localhost не требуются.
Набор должен быть опубликован после одобрения и анализа.
При частичном анализе используются только успешно обработанные символы.

Автовыбор предпочитает готовый набор с наибольшим числом экспортируемых образцов,
затем наиболее недавно обновлённый. Явный выбор сохраняется в браузере отдельно
для каждого холста; настройки страницы Writing не переносятся. Перед новым
решением набор загружается заново. Если он недоступен, не готов или нет доступа,
решение выводится шрифтом; панель сообщает причину и предлагает открыть датасеты
или обновить список. Отключение Dev-интерфейса не скрывает опубликованные наборы.

Каждый `steps[].latex` из ответа `/api/ai/canvas` проходит математическую
компоновку Writing. Доступные символы заменяются настоящими медоидами; дроби,
степени и таблицы сохраняют структуру. Недостающие символы и пояснения
`\text{...}` остаются шрифтом MathJax. Панель перечисляет шрифтовые символы.
Если рукописный движок не поддерживает компоновку или превышен его лимит длины,
для этого блока применяется обычный формульный рендерер и показывается сообщение.
Проверочный режим Writing по-прежнему отмечает пропуски красными рамками.

Готовый блок становится синим PNG с прозрачным фоном. Вместе с изображением
холст сохраняет исходный LaTeX, `solutionId`, а при использовании набора —
снимок `handwriting`: версии схемы и рендерера, идентификатор и имя набора,
версию исходных данных, время анализа, настройки с повторяемым seed, цвет,
идентификаторы использованных медоидов и сведения о шрифтовых заменах.
Ранее сохранённые изображения не пересчитываются при изменении датасета.

**Отменить решение** и **Вернуть решение** действуют на последнее принятое
решение в текущей сессии холста. Отмена сохраняет последующие пользовательские
штрихи и копии объектов; добавленные решением страницы удаляются только пустыми.
Повтор возвращает снятые объекты с последними позициями, изображениями и
метаданными, без нового рендера. Это отдельная операция, не общая история
редактирования; после перезагрузки страницы её история не восстанавливается.

Реализация: `web/lib/canvas-handwriting.ts`, `canvas-handwriting-renderer.ts`,
`canvas-solution-history.ts` и `web/components/canvas-handwriting.tsx`.
Подключение работает в локальном и production web через опубликованные версии.
iPad экспортирует образцы, но пока не выводит ответы в персональном почерке. PNG содержит растровый
результат, а не восстановленные штрихи пера.

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
node tests/handwriting-access.test.mjs
node tests/handwriting-analysis.test.mjs
node tests/handwriting-writing.test.mjs
npm run typecheck
```

Browser acceptance tests must use synthetic datasets. Never approve personal
samples on the user's behalf.
