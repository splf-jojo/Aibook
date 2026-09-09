import type Konva from "konva";
import type { EditRect } from "./canvas-editing";

/** Rasterize only an object's content, never the paper or other objects. */
export function captureFragment(node: Konva.Group, rect: EditRect, scaleX: number, scaleY: number): string {
  const images = node.find("Image");
  if (!node.getChildren().length || images.some(image => !image.getAttr("image"))) {
    throw new Error("Canvas content is still loading");
  }
  let resolution = 2;
  for (const image of images) {
    const source = image.getAttr("image") as HTMLImageElement;
    resolution = Math.max(resolution, source.naturalWidth / Math.max(1, image.width()), source.naturalHeight / Math.max(1, image.height()));
  }
  // Bound temporary allocations, independently of the current viewport zoom.
  resolution = Math.min(resolution, 4096 / Math.max(rect.width, rect.height));
  const rendered = node.toCanvas({
    x: rect.x * scaleX, y: rect.y * scaleY,
    width: rect.width * scaleX, height: rect.height * scaleY,
    pixelRatio: resolution / Math.min(scaleX, scaleY),
  });
  return rendered.toDataURL("image/png");
}
