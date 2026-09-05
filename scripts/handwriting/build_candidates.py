"""Build a LOCAL candidate pack from proposed PDF crop boxes. Does not approve labels.

Dependencies: pypdf, Pillow, Poppler (pdftoppm). Source PDFs are never modified.
Manifest: {"name": "...", "samples": [{"file": "8.pdf", "page": 1,
"latex": "x", "box": [x, y, width, height]}]}. Coordinates are PDF points,
top-left origin. Keep manifests and output under ignored output/handwriting/.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw
from pypdf import PdfReader


def png_data(image: Image.Image) -> str:
    stream = io.BytesIO()
    image.save(stream, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def black_ink_preview(image: Image.Image) -> Image.Image:
    """Remove this notes template's (163,183,211) grid and white paper.

    Reconstruct coverage assuming black ink over the blue grid/white background.
    Gray antialiasing remains; no strokes are drawn or repaired. Raw context is
    retained so the human reviewer can reject damage or neighboring ink.
    """
    result = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = image.load()
    result.putdata([(0, 0, 0, max(0, min(255, round(255 - pixels[x, y][2] - (44 / 48) * max(0, pixels[x, y][2] - pixels[x, y][0])))))
                    for y in range(image.height) for x in range(image.width)])
    return result


def build(notes: Path, manifest: dict, pdftoppm: str, cache: Path) -> dict:
    notes = notes.resolve()
    pages: dict[tuple[Path, int], tuple[Image.Image, float, float, str]] = {}
    samples = []
    cache.mkdir(parents=True, exist_ok=True)
    for item in manifest["samples"]:
        pdf = (notes / item["file"]).resolve()
        if not pdf.is_relative_to(notes) or pdf.suffix.lower() != ".pdf":
            raise ValueError("Source must be a PDF inside the notes folder")
        page_number = item["page"]
        key = (pdf, page_number)
        if key not in pages:
            reader = PdfReader(pdf)
            if not isinstance(page_number, int) or not 1 <= page_number <= len(reader.pages):
                raise ValueError("Invalid page number")
            page = reader.pages[page_number - 1]
            if page.rotation or page.mediabox != page.cropbox or float(page.mediabox.left) or float(page.mediabox.bottom):
                raise ValueError("This initial crop builder requires unrotated PDFs with matching zero-origin media/crop boxes")
            width, height = float(page.mediabox.width), float(page.mediabox.height)
            source_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
            prefix = cache / f"{source_hash[:20]}-{page_number}-600dpi"
            if not prefix.with_suffix(".png").exists():
                subprocess.run([pdftoppm, "-f", str(page_number), "-singlefile", "-r", "600", "-png", str(pdf), str(prefix)], check=True)
            with Image.open(prefix.with_suffix(".png")) as opened:
                raster = opened.convert("RGB")
            # Bound RAM when reviewing notes with many pages; rendered PNGs stay cached on disk.
            if len(pages) >= 2:
                pages.pop(next(iter(pages)))[0].close()
            pages[key] = raster, width, height, source_hash
        raster, width, height, source_hash = pages[key]
        x, y, w, h = map(float, item["box"])
        if not all(math.isfinite(v) for v in (x, y, w, h)) or x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
            raise ValueError(f"Invalid crop: {item}")
        sx, sy = raster.width / width, raster.height / height
        crop_box = (math.floor(x * sx), math.floor(y * sy), math.ceil((x + w) * sx), math.ceil((y + h) * sy))
        crop = raster.crop(crop_box)
        if manifest.get("removeBlueGrid", False):
            crop = black_ink_preview(crop)
        # Context includes adjacent handwriting; the outline is never painted on the actual sample.
        cx, cy = max(0, x - 65), max(0, y - 28)
        cr, cb = min(width, x + w + 65), min(height, y + h + 28)
        context_box = (math.floor(cx * sx), math.floor(cy * sy), math.ceil(cr * sx), math.ceil(cb * sy))
        context = raster.crop(context_box)
        draw = ImageDraw.Draw(context)
        draw.rectangle((crop_box[0] - context_box[0], crop_box[1] - context_box[1], crop_box[2] - context_box[0] - 1, crop_box[3] - context_box[1] - 1), outline=(214, 105, 46), width=3)
        context.thumbnail((760, 400), Image.Resampling.LANCZOS)
        identity = f"{source_hash}:{page_number}:{x},{y},{w},{h}"
        samples.append({
            "id": hashlib.sha256(identity.encode()).hexdigest()[:20], "latex": item["latex"],
            "image": png_data(crop), "context": png_data(context),
            "source": {"file": pdf.name, "sha256": source_hash, "page": page_number,
                       "pageWidth": width, "pageHeight": height, "box": [x, y, w, h]},
        })
    return {"schemaVersion": 1, "kind": "handwriting-candidates", "name": manifest["name"], "samples": samples}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notes", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args()
    data = build(args.notes, json.loads(args.manifest.read_text(encoding="utf-8")), args.pdftoppm, args.output.parent / ".render-cache")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(data['samples'])} UNREVIEWED candidates to {args.output}")


if __name__ == "__main__":
    main()
