# API Reference

## Server

| Environment | Base URL |
| --- | --- |
| Local | `http://localhost:8000` |
| Local full stack (including handwriting) | `http://localhost` |
| Production | `https://<api-domain>` |
| Swagger UI | `<base-url>/docs` |
| OpenAPI JSON | `<base-url>/openapi.json` |
| WebSocket | `ws://<host>/ws` or `wss://<host>/ws` |

## Authorization

Public API endpoints: `/health`, `/api/auth/register`, `/api/auth/login`. Documentation `/docs`, `/redoc` and `/openapi.json` is also public.

All other endpoints require:

```http
Authorization: Bearer <access_token>
```

Default token lifetime: `10080` minutes. Refresh token is not supported.

`GET /api/auth/me` includes `role: "user" | "dev"`. Registration always creates
`user`; role assignment is an explicit server command, not a profile field.

## Handwriting datasets and publications

The Node web service implements these routes and verifies identity with FastAPI.
Caddy routes `/api/handwriting/*` to web **before** `/api/*` to FastAPI. Use the
shared web origin, not port 8000. These routes are not in `/openapi.json`.

| Method | Path | Access | Result |
| --- | --- | --- | --- |
| GET | `/api/handwriting/datasets` | Owner; dev sees all | Summaries with owner and status |
| POST | `/api/handwriting/datasets` | Signed in | `{dataset, source?}` upload; 200 summary, including retries |
| GET | `/api/handwriting/datasets/{id}` | Owner or dev | `{fingerprint,name,dataset,review,version}` |
| GET | `/api/handwriting/datasets/{id}/source` | Owner or dev | Original archive/geometry or null |
| PATCH | `/api/handwriting/datasets/{id}` | Dev | Versioned review operation |
| GET | `/api/handwriting/datasets/{id}/analysis` | Owner or dev | Analysis, progress and publication ID |
| POST | `/api/handwriting/datasets/{id}/analysis` | Dev | Enqueue `{expectedVersion}`; poll GET |
| POST | `/api/handwriting/datasets/{id}/publish` | Dev | Publish current approved/analyzed `{expectedVersion}` |
| GET | `/api/handwriting/fonts` | Signed in | Latest published version of each dataset |
| GET | `/api/handwriting/fonts/{publicationId}` | Signed in | Immutable transparent glyphs and layout metadata |

Uploads are bounded to 40 MiB and 1–5000 samples. PDF candidates retain schema v1.
Native iPad exports use schema v2:

```json
{
  "dataset": {
    "schemaVersion": 2, "kind": "handwriting-candidates", "name": "My worksheet",
    "samples": [{
      "id": "r0-c0", "latex": "x",
      "image": "data:image/png;base64,...", "context": "data:image/png;base64,...",
      "source": {
        "kind": "pencilkit", "file": "worksheet.pkdrawing", "sha256": "<drawing-sha256>",
        "page": 1, "pageWidth": 595, "pageHeight": 842,
        "box": [20, 40, 50, 50], "crossesCellBoundary": false
      }
    }]
  },
  "source": {
    "worksheetId": "<uuid>", "configuration": {},
    "drawing": "data:application/x-pencilkit;base64,...", "renderScale": 3,
    "cells": [{"id": "r0-c0", "latex": "x", "page": 1, "box": [22, 42, 46, 46]}],
    "boundaryCells": [], "outsideCellStrokes": 0
  }
}
```

Coordinates are unscaled page points, top-left origin, one-based page number.
Samples contain ink without the grid or tracing guides. The original drawing
includes every stroke; its decoded SHA-256 must match sample provenance. IDs
include the authenticated owner and canonical candidate fingerprint. Clients
cannot choose another owner or submit approval/publication authority. Retrying
an upload preserves the existing review. Changing ink creates a new snapshot.

Review PATCH accepts `{type:"decide",expectedVersion,sampleId,status,latex,issue?}`,
`{type:"undo",expectedVersion}` or `{type:"approve",expectedVersion}`. Status is
`accepted|rejected`; issue is `incorrect-outline|incorrect-symbol`. Publication
requires current approval and successfully analyzed real medoids (minimum three
accepted samples per class). It exposes neither the raw archive nor review.
Published versions remain readable after later edits.

Errors are `{error:string}`: 401 requires sign-in, 403 denies a dev action,
404 hides other owners' sources, 409 means stale review/missing approval,
413 means oversized body. Analysis statuses include `queued`, `running`,
`complete`, `partial`, `failed` and `not-run`. POST only queues work.

`/handwriting` is the browser catalog. `/dev` uses a separate HttpOnly cookie
with the same server role checks; see `scripts/handwriting/README.md`.

## Endpoints

| Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/health` | No | `200` | — | `HealthResponse` |
| `POST` | `/api/auth/register` | No | `201` | `Credentials` JSON | `TokenResponse` |
| `POST` | `/api/auth/login` | No | `200` | `Credentials` JSON | `TokenResponse` |
| `GET` | `/api/auth/me` | Yes | `200` | — | `UserResponse` |
| `GET` | `/api/canvases` | Yes | `200` | — | `CanvasSummaryResponse[]` |
| `POST` | `/api/canvases` | Yes | `201` | `CanvasCreate` JSON | `CanvasResponse` |
| `GET` | `/api/canvases/{canvas_id}` | Yes | `200` | Path: `canvas_id` | `CanvasResponse` |
| `PATCH` | `/api/canvases/{canvas_id}` | Yes | `200` | `CanvasUpdate` JSON | `CanvasResponse` |
| `DELETE` | `/api/canvases/{canvas_id}` | Yes | `204` | Path: `canvas_id` | Empty |
| `POST` | `/api/latex/layout` | Yes | `200` | `LatexLayoutRequest` JSON | `LatexLayoutResponse` |
| `POST` | `/api/ai/sidebar` | Yes | `200` | Multipart | `AiSidebarResponse` |
| `POST` | `/api/ai/canvas` | Yes | `200` | Multipart | `AiCanvasResponse` |
| `GET` | `/api/ai/chats` | Yes | `200` | — | `AiChatResponse[]` |
| `POST` | `/api/ai/chats` | Yes | `201` | `AiChatCreate` JSON | `AiChatResponse` |
| `GET` | `/api/ai/chats/{chat_id}` | Yes | `200` | Path: `chat_id` | `AiChatResponse` |
| `POST` | `/api/ai/chats/{chat_id}/reply` | Yes | `200` | `AiChatReplyRequest` JSON | `AiChatReplyResponse` |
| `POST` | `/api/ai/chats/{chat_id}/messages` | Yes | `201` | `AiChatMessageCreate` JSON | `AiChatMessageResponse` |
| `POST` | `/api/images` | Yes | `201` | Multipart | `ImageMetadata` |
| `GET` | `/api/images` | Yes | `200` | — | `ImageMetadata[]` |
| `GET` | `/api/images/{image_id}/content` | Yes | `200` | Path: `image_id` | Binary `image/png` |
| `POST` | `/api/images/{image_id}/ack` | Yes | `204` | Path: `image_id` | Empty |
| `WS` | `/ws` | Yes | `101` | Authorization header | `ImageEvent` |

## Auth

### `POST /api/auth/register`

Request: `application/json`, schema `Credentials`.

Responses:

| Status | Body |
| --- | --- |
| `201` | `TokenResponse` |
| `409` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `POST /api/auth/login`

Request: `application/json`, schema `Credentials`.

Responses:

| Status | Body |
| --- | --- |
| `200` | `TokenResponse` |
| `401` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `GET /api/auth/me`

Responses:

| Status | Body |
| --- | --- |
| `200` | `UserResponse` |
| `401` | `ErrorResponse` |

## Note groups and imported PDFs

All group routes require the user's bearer token. Groups belong to one account, have one level and a nonblank name of up to 120 characters.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/note-groups` | — | `200` array of groups |
| POST | `/api/note-groups` | `{ "name": "Mathematics" }` | `201` group |
| PATCH | `/api/note-groups/{id}` | `{ "name": "Physics" }` | `200` group |
| DELETE | `/api/note-groups/{id}` | — | `204`; notes remain ungrouped |

A group has `id`, `name`, `createdAt`, `updatedAt`. Unknown or another account's IDs return `404`.
`groupId` is nullable on canvas create, update, summary and full responses. Omitted on PATCH means unchanged; explicit `null` moves the note to Ungrouped. A non-null ID must belong to the authenticated user. Deleting a group and ungrouping its notes is one transaction; note content is unchanged.

PDF import creates a new schema-2 note. Optional `content.pdfData` holds one original PDF as strict base64, at most **5,000,000 decoded bytes**. Each PDF-backed page has `pdfPageIndex` (zero-based, 0–999); blank/appended pages use null or omit it. PDF page references require `pdfData`. Notes retain the existing 1,000-page limit. iPad also rejects unreadable and encrypted PDFs before creating the note.

The PDF crop box (including page rotation) is fitted proportionally and centered on each A4 canvas page. It is a background, independent of editable ink and undo. Portable PDF annotations use API page coordinates (794 × 1123); iPad converts to/from its native 720-wide page and keeps the original PencilKit archive. Both clients preserve the PDF source and page references when saving, moving or renaming notes. Library responses omit PDF content. When a pre-PDF client omits the new fields on a content save, the server preserves the source and matches existing PDF page references by page ID.

## Canvases

JSON keys use `camelCase`.

Current schema: `2`. Legacy schema `1` requests are accepted and returned as one-page schema `2` documents.

### `GET /api/canvases`

Returns summaries ordered by `updatedAt` descending.

| Status | Body |
| --- | --- |
| `200` | `CanvasSummaryResponse[]` |
| `401` | `ErrorResponse` |

### `POST /api/canvases`

Request: `application/json`, schema `CanvasCreate`.

| Status | Body |
| --- | --- |
| `201` | `CanvasResponse` |
| `401` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `GET /api/canvases/{canvas_id}`

| Parameter | Location | Type | Required |
| --- | --- | --- | --- |
| `canvas_id` | Path | string | Yes |

| Status | Body |
| --- | --- |
| `200` | `CanvasResponse` |
| `401` | `ErrorResponse` |
| `404` | `ErrorResponse` |

### `PATCH /api/canvases/{canvas_id}`

Request: `application/json`, schema `CanvasUpdate`. When `content` is provided, it replaces the complete stored content.

| Status | Body |
| --- | --- |
| `200` | `CanvasResponse` |
| `401` | `ErrorResponse` |
| `404` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `DELETE /api/canvases/{canvas_id}`

| Status | Body |
| --- | --- |
| `204` | Empty |
| `401` | `ErrorResponse` |
| `404` | `ErrorResponse` |

## LaTeX

JSON keys use `camelCase`.

### `POST /api/latex/layout`

Request: `application/json`, schema `LatexLayoutRequest`.

| Status | Body |
| --- | --- |
| `200` | `LatexLayoutResponse` |
| `401` | `ErrorResponse` |
| `422` | `ErrorResponse` or `ValidationErrorResponse` |

## AI

### `POST /api/ai/canvas`

Creates an unaccepted, structured solution. This endpoint never modifies a canvas.

Request: `multipart/form-data`. Required fields: `chat_id` (an owned chat), `language`
(`ru`, `en`, or `zh`), and `prompt` (1–20,000 characters). Optional fields: `image`
(PNG/JPEG, up to 20 MiB) and `previous_solution` (the current draft JSON, up to
100,000 characters). Follow-ups use the owned chat history and its latest task image.

Response: `{ "status": "solution" | "clarification", "explanation": string, "steps": [...] }`.
Explanations are concise plain prose. Each step contains `latex`, `explanation`, and
an optional `chart` (`bars: [{label, value}]`, `x_label`, `y_label`). A chart-only step
may have empty `latex`; otherwise a formula is required. A clarification has no steps.
Malformed model output is repaired once and then returns `502` if still invalid.
Other errors include `401`, `404` (unowned chat), `413`, `415`, `422`, and `503`
(model not configured).

The web client renders formulas with MathJax and local handwriting outlines, finds
unoccupied regions, and creates temporary continuation pages as needed. Accepting
merges the whole draft into `CanvasContent` and saves it with the existing canvas
PATCH endpoint. Discarding or stopping does not save temporary objects or pages.

### `POST /api/ai/sidebar`

Request: `multipart/form-data`.

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `image` | PNG file | Yes | `Content-Type: image/png`, 1 byte–20 MiB |
| `language` | string enum | Yes | `ru`, `en`, `zh` |

| Status | Body |
| --- | --- |
| `200` | `AiSidebarResponse` |
| `401` | `ErrorResponse` |
| `413` | `ErrorResponse` |
| `415` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |
| `502` | `ErrorResponse` |
| `503` | `ErrorResponse` |

### `GET /api/ai/chats`

Returns chats and nested messages ordered by `created_at` ascending.

| Status | Body |
| --- | --- |
| `200` | `AiChatResponse[]` |
| `401` | `ErrorResponse` |

### `POST /api/ai/chats`

Request: `application/json`, schema `AiChatCreate`.

| Status | Body |
| --- | --- |
| `201` | `AiChatResponse` |
| `401` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `POST /api/ai/chats/{chat_id}/messages`

Request: `application/json`, schema `AiChatMessageCreate`.

| Status | Body |
| --- | --- |
| `201` | `AiChatMessageResponse` |
| `401` | `ErrorResponse` |
| `404` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `GET /api/ai/chats/{chat_id}`

Returns one owned `AiChatResponse`, including its messages. Returns `401` without
authentication and `404` for a missing chat or another user's chat.

For this endpoint and `/reply`, a missing or inaccessible chat has a structured
error: `{"detail":{"code":"chat_not_found","message":"Chat not found."}}`.
A router-level `404` without this code means the endpoint is unavailable, not
that the user's chat was deleted. Clients must preserve the saved chat ID in
that case. Deploy these routes before releasing a client that uses them.

| Status | Body |
| --- | --- |
| `200` | `AiChatResponse` |
| `401` | `ErrorResponse` |
| `404` | `ErrorResponse` |

### `POST /api/ai/chats/{chat_id}/reply`

Conversational endpoint used by the iPad sidebar. Request is JSON:

```json
{
  "request_id": "a25915a7-bfbf-4ca6-b35e-ccfca03c95b9",
  "prompt": "Explain the last step",
  "language": "en",
  "image_data_url": null
}
```

`request_id` is a UUID generated by the client and reused when retrying the same
message. `prompt` is trimmed and must contain 1–20,000 characters. `language` is
`ru`, `en` (default), or `zh`. Optional `image_data_url` accepts a base64 PNG/JPEG,
up to 20 MiB decoded. No image is needed for a text conversation. The latest 16
messages supply history; a follow-up without a new image reuses the most recent
image in that history.

Returns `200` with `{ "user_message": AiChatMessageResponse,
"assistant_message": AiChatMessageResponse }`. Both messages are saved in one
transaction after a successful model call. Do not also post them to `/messages`.
Question and answer timestamps increase strictly within the chat, including
when the server clock returns identical ticks. Concurrent saves serialize only
the persistence step; the database lock is not held while waiting for the model.
Retrying a completed request returns the saved turn; reusing its ID with another
prompt or image returns `409`. Other errors: `401`, `404`, `413`, `415`, `422`,
`502` (model failure), `503` (model not configured). Failed model calls leave
history unchanged. This endpoint does not modify the canvas.

## Images

### `POST /api/images`

Request: `multipart/form-data`.

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `image` | PNG file | Yes | `Content-Type: image/png`, 1 byte–20 MiB |
| `width` | integer | Yes | `> 0` |
| `height` | integer | Yes | `> 0` |

| Status | Body |
| --- | --- |
| `201` | `ImageMetadata` |
| `401` | `ErrorResponse` |
| `413` | `ErrorResponse` |
| `415` | `ErrorResponse` |
| `422` | `ValidationErrorResponse` |

### `GET /api/images`

Returns unacknowledged images ordered by `created_at` ascending.

| Status | Body |
| --- | --- |
| `200` | `ImageMetadata[]` |
| `401` | `ErrorResponse` |

### `GET /api/images/{image_id}/content`

| Status | Content-Type | Body |
| --- | --- | --- |
| `200` | `image/png` | Binary PNG |
| `401` | `application/json` | `ErrorResponse` |
| `404` | `application/json` | `ErrorResponse` |

### `POST /api/images/{image_id}/ack`

Deletes the acknowledged image from the server.

| Status | Body |
| --- | --- |
| `204` | Empty |
| `401` | `ErrorResponse` |
| `404` | `ErrorResponse` |

## WebSocket

### `WS /ws`

Handshake header:

```http
Authorization: Bearer <access_token>
```

Invalid authorization closes the connection with code `1008`.

Server message schema: `ImageEvent`.

```json
{
  "type": "image",
  "image": {
    "id": "313771aa-25d9-4b3b-89aa-c9972dca882c",
    "filename": "canvas-20260903-182500.png",
    "mime_type": "image/png",
    "width": 1200,
    "height": 800,
    "size_bytes": 245678,
    "created_at": "2026-09-03T10:25:00Z"
  }
}
```

## Schemas

### `HealthResponse`

| Field | Type | Required | Value |
| --- | --- | --- | --- |
| `status` | string | Yes | `ok` |

### `Credentials`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `username` | string | Yes | 3–64 characters |
| `password` | string | Yes | 8–128 characters |

### `TokenResponse`

| Field | Type | Required | Value |
| --- | --- | --- | --- |
| `access_token` | string | Yes | JWT |
| `token_type` | string | Yes | `bearer` |

### `UserResponse`

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `username` | string | Yes |

### `CanvasCreate`

| Field | Type | Required | Constraints/default |
| --- | --- | --- | --- |
| `title` | string | Yes | 1–120 characters |
| `content` | `CanvasContent` | No | Default empty canvas |
| `groupId` | string or null | No | Owned group; default ungrouped |

### `CanvasUpdate`

At least one non-null field is required.

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `title` | string or null | No | 1–120 characters |
| `content` | `CanvasContent` or null | No | Complete content |
| `groupId` | string or null | No | Omitted: keep group; null: ungroup |

### `CanvasSummaryResponse`

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `title` | string | Yes |
| `elementCount` | integer | Yes |
| `createdAt` | ISO 8601 datetime | Yes |
| `updatedAt` | ISO 8601 datetime | Yes |

### `CanvasResponse`

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `title` | string | Yes |
| `content` | `CanvasContent` | Yes |
| `createdAt` | ISO 8601 datetime | Yes |
| `updatedAt` | ISO 8601 datetime | Yes |

### `CanvasContent`

| Field | Type | Required | Constraints/default |
| --- | --- | --- | --- |
| `schemaVersion` | integer | No | Literal `2`, default `2` |
| `pages` | `CanvasPage[]` | No | 1–1,000 pages, default one empty page |

### `CanvasPage`

| Field | Type | Required | Constraints/default |
| --- | --- | --- | --- |
| `id` | string | No | 1–100 characters, server-generated UUID by default |
| `width` | number | No | `> 0`, `<= 10000`, default `794` |
| `height` | number | No | `> 0`, `<= 10000`, default `1123` |
| `pageTemplate` | string enum | No | `ruled`, `dotted`, `grid`, `plain`; default `plain` |
| `elements` | `CanvasElement[]` | No | Maximum 20,000, default `[]` |
| `pdfPageIndex` | integer or null | No | 0–999, index in shared PDF; null for blank pages |
| `appleDrawingData` | string or null | No | Base64 PKDrawing cache, maximum 30,000,000 characters |

`CanvasElement` is selected by `kind`:

| `kind` | Schema |
| --- | --- |
| `stroke` | `CanvasStrokeElement` |
| `star` | `CanvasStarElement` |
| `text` | `CanvasTextElement` |
| `image` | `CanvasImageElement` |
| `saved-card` | `CanvasSavedCardElement` |

### `CanvasStrokeElement`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | Yes | 1–100 characters |
| `kind` | string | Yes | Literal `stroke` |
| `mode` | string | Yes | Literal `draw` |
| `points` | number[] | No | 4–200,000 x/y values; generated from `samples` when omitted |
| `samples` | `CanvasStrokeSample[]` or null | No | Maximum 100,000; `points` or at least two samples required |
| `strokeWidth` | number | Yes | `> 0`, `<= 256` |
| `stroke` | string or null | No | Maximum 64 characters |
| `tool` | string or null | No | Maximum 64 characters |
| `transform` | `CanvasAffineTransform` or null | No | — |
| `maskData` | string or null | No | Maximum 5,000,000 characters |
| `renderBounds` | `CanvasRect` or null | No | — |
| `randomSeed` | integer or null | No | `0...4294967295` |
| `source` | string or null | No | Literal `latex` |
| `formulaInstanceId` | string or null | No | Maximum 100 characters |
| `latexTemplateId` | string or null | No | Maximum 100 characters |

### `CanvasStrokeSample`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `x`, `y` | number | Yes | Page coordinates |
| `timeOffset` | number or null | No | `>= 0` |
| `size` | `CanvasSize` or null | No | — |
| `opacity` | number or null | No | `0...1` |
| `force` | number or null | No | `>= 0` |
| `azimuth`, `altitude` | number or null | No | Radians |
| `secondaryScale`, `threshold` | number or null | No | — |

### `CanvasSize`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `width`, `height` | number | Yes | `> 0`, `<= 10000` |

### `CanvasRect`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `x`, `y` | number | Yes | — |
| `width`, `height` | number | Yes | `>= 0`, `<= 100000` |

### `CanvasAffineTransform`

| Field | Type | Required |
| --- | --- | --- |
| `a`, `b`, `c`, `d`, `tx`, `ty` | number | Yes |

### `CanvasStarElement`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | Yes | 1–100 characters |
| `kind` | string | Yes | Literal `star` |
| `x`, `y` | number | Yes | — |
| `innerRadius`, `outerRadius` | number | Yes | `> 0`, `<= 10000` |

### `CanvasTextElement`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | Yes | 1–100 characters |
| `kind` | string | Yes | Literal `text` |
| `x`, `y` | number | Yes | — |
| `width` | number | Yes | `> 0`, `<= 100000` |
| `height` | number or null | No | `> 0`, `<= 100000` |
| `text` | string | Yes | Maximum 1,000,000 characters |
| `fontSize` | number | Yes | `> 0`, `<= 1000` |
| `fill` | string or null | No | Maximum 64 characters |
| `fontFamily` | string or null | No | Maximum 500 characters |
| `lineHeight` | number or null | No | `> 0`, `<= 20` |
| `rotation` | number or null | No | `-360000...360000` |
| `source` | string or null | No | Literal `latex` |
| `formulaInstanceId` | string or null | No | Maximum 100 characters |
| `latexTemplateId` | string or null | No | Maximum 100 characters |

### `CanvasImageElement`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | Yes | 1–100 characters |
| `kind` | string | Yes | Literal `image` |
| `x`, `y` | number | Yes | — |
| `width`, `height` | number | Yes | `> 0`, `<= 100000` |
| `dataUrl` | string | Yes | Maximum 30,000,000 characters |
| `source` | `latex`, `ai-chart`, or null | No | Formula or generated chart |
| `latex` | string or null | No | Original formula, up to 20,000 characters |
| `formulaInstanceId` | string or null | No | Maximum 100 characters |
| `solutionId` | string or null | No | Accepted solution ID, maximum 100 characters |
| `latexTemplateId` | string or null | No | Saved formula template ID, maximum 100 characters |

### `CanvasSavedCardElement`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | Yes | 1–100 characters |
| `kind` | string | Yes | Literal `saved-card` |
| `card` | string enum | Yes | `solution-2-3-11`, `summary-2-3` |
| `x`, `y` | number | Yes | — |
| `width`, `height` | number | Yes | `> 0`, `<= 100000` |

### `LatexLayoutRequest`

| Field | Type | Required | Constraints/default |
| --- | --- | --- | --- |
| `latex` | string | Yes | 1–20,000 characters |
| `fontSize` | number | No | `> 0`, `<= 256`, default `44` |
| `maxWidth` | number or null | No | `> 0`, `<= 10000` |
| `maxHeight` | number or null | No | `> 0`, `<= 10000` |

### `LatexLayoutResponse`

| Field | Type | Required |
| --- | --- | --- |
| `objects` | `(LatexTextObject \| LatexLineObject)[]` | Yes |
| `width` | number | Yes |
| `height` | number | Yes |

### `LatexTextObject`

| Field | Type | Required |
| --- | --- | --- |
| `kind` | literal `text` | Yes |
| `text`, `role` | string | Yes |
| `x`, `y`, `width`, `height`, `fontSize` | number | Yes |
| `fontFamily` | string | Yes |

### `LatexLineObject`

| Field | Type | Required |
| --- | --- | --- |
| `kind` | literal `line` | Yes |
| `role` | string | Yes |
| `x1`, `y1`, `x2`, `y2`, `strokeWidth` | number | Yes |

### `AiSidebarResponse`

| Field | Type | Required |
| --- | --- | --- |
| `text` | string | Yes |

### `AiChatCreate`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `title` | string | Yes | 1–120 characters |

### `AiChatMessageCreate`

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `role` | string enum | Yes | `user`, `assistant` |
| `content` | string | Yes | 1–100,000 characters |
| `image_data_url` | string or null | No | Maximum 30,000,000 characters |

### `AiChatMessageResponse`

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `role` | string enum | Yes |
| `content` | string | Yes |
| `image_data_url` | string or null | Yes |
| `created_at` | ISO 8601 datetime | Yes |

### `AiChatResponse`

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `title` | string | Yes |
| `created_at` | ISO 8601 datetime | Yes |
| `messages` | `AiChatMessageResponse[]` | Yes |

### `AiChatReplyRequest`

| Field | Type | Required | Constraints/default |
| --- | --- | --- | --- |
| `request_id` | UUID | Yes | Client-generated idempotency key |
| `prompt` | string | Yes | Trimmed; 1–20,000 characters |
| `language` | string enum | No | `ru`, `en`, `zh`; default `en` |
| `image_data_url` | string or null | No | Base64 PNG/JPEG data URL; maximum 30,000,000 characters |

### `AiChatReplyResponse`

| Field | Type | Required |
| --- | --- | --- |
| `user_message` | `AiChatMessageResponse` | Yes |
| `assistant_message` | `AiChatMessageResponse` | Yes |

### `ImageMetadata`

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | Yes |
| `filename` | string | Yes |
| `mime_type` | string | Yes |
| `width`, `height` | integer | Yes |
| `size_bytes` | integer | Yes |
| `created_at` | ISO 8601 datetime | Yes |

### `ImageEvent`

| Field | Type | Required | Value |
| --- | --- | --- | --- |
| `type` | string | Yes | `image` |
| `image` | `ImageMetadata` | Yes | — |

### `ErrorResponse`

```json
{
  "detail": "Error message"
}
```

### `ValidationErrorResponse`

```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "username"],
      "msg": "String should have at least 3 characters",
      "input": "ab"
    }
  ]
}
```
