"use client";

import { Group, Layer, Rect, Stage } from "react-konva";
import type { CanvasContent } from "@/lib/canvas-api";
import { SceneElementView, type SceneElement } from "./canvas-scene";
import { PdfPageBackground } from "./pdf-page-background";

export default function CanvasPreviewPage({ content, width }: { content: CanvasContent; width: number }) {
  const page = content.pages[0];
  const height = width * 1123 / 794;
  const scale = Math.min(width / page.width, height / page.height);
  return <Stage width={width} height={height} listening={false}>
    <Layer listening={false}>
      <Rect width={width} height={height} fill="#ffffff" />
      <Group x={(width - page.width * scale) / 2} y={(height - page.height * scale) / 2}
        scaleX={scale} scaleY={scale} clipX={0} clipY={0} clipWidth={page.width} clipHeight={page.height}>
        <PdfPageBackground source={content.pdfData} pageIndex={page.pdfPageIndex} width={page.width} height={page.height} />
        {(page.elements as SceneElement[]).map(element => <SceneElementView key={element.id} element={element} />)}
      </Group>
    </Layer>
  </Stage>;
}
