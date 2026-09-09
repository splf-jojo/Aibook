"use client";

import { useEffect, useState } from "react";
import { Arrow, Group, Image as KonvaImage, Line, Rect as KonvaRect, Star as KonvaStar, Text as KonvaText } from "react-konva";
import type { HandwritingSnapshot } from "@/lib/canvas-handwriting";

export type StrokeElement = {
  id: string;
  kind: "stroke";
  mode: "draw";
  points: number[];
  samples?: Array<{
    x: number;
    y: number;
    timeOffset?: number | null;
    size?: { width: number; height: number } | null;
    opacity?: number | null;
    force?: number | null;
    azimuth?: number | null;
    altitude?: number | null;
    secondaryScale?: number | null;
    threshold?: number | null;
  }> | null;
  strokeWidth: number;
  stroke?: string;
  tool?: string | null;
  transform?: { a: number; b: number; c: number; d: number; tx: number; ty: number } | null;
  maskData?: string | null;
  renderBounds?: { x: number; y: number; width: number; height: number } | null;
  randomSeed?: number | null;
  source?: "latex";
  formulaInstanceId?: string;
  latexTemplateId?: string;
};
export type StarElement = {
  id: string;
  kind: "star";
  x: number;
  y: number;
  innerRadius: number;
  outerRadius: number;
};
export type TextElement = {
  id: string;
  kind: "text";
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  height?: number;
  fill?: string;
  fontFamily?: string;
  lineHeight?: number;
  rotation?: number;
  source?: "latex";
  formulaInstanceId?: string;
  latexTemplateId?: string;
};
export type ImageElement = {
  id: string;
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  source?: "latex" | "ai-chart";
  latex?: string;
  formulaInstanceId?: string;
  solutionId?: string;
  handwriting?: HandwritingSnapshot;
  latexTemplateId?: string;
};

export type SavedCardElement = {
  id: string;
  kind: "saved-card";
  card: "solution-2-3-11" | "summary-2-3";
  x: number;
  y: number;
  width: number;
  height: number;
};
export type SceneElement = StrokeElement | StarElement | TextElement | ImageElement | SavedCardElement;

const HAND_FONT = "Segoe Print, Comic Sans MS, cursive";
const BLUE_INK = "#2456a6";
const DARK_INK = "#27364a";
const RED_INK = "#c2413b";
const GREEN_INK = "#27835b";

const LARGE_OPERATOR_FONT = '"KaTeX_Size2", "Cambria Math", "STIX Two Math", serif';
const LARGE_OPERATOR_SYMBOLS = new Set(["∫", "∮", "∬", "∭", "∑", "∏"]);
function mathFontFamily(text: string, fallback: string): string {
  return LARGE_OPERATOR_SYMBOLS.has(text) ? LARGE_OPERATOR_FONT : fallback;
}

export function SceneImage({ element }: { element: ImageElement }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = element.dataUrl;
    return () => {
      nextImage.onload = null;
    };
  }, [element.dataUrl]);

  if (!image) return null;
  return (
    <KonvaImage
      height={element.height}
      image={image}
      listening={false}
      width={element.width}
      x={element.x}
      y={element.y}
    />
  );
}

function HandwrittenSolution({ element }: { element: SavedCardElement }) {
  return (
    <Group listening={false} x={element.x} y={element.y}>
      <KonvaRect fill="#fde68a" height={43} opacity={0.5} rotation={-1.4} width={360} x={9} y={8} />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={31}
        rotation={-0.8}
        text="2.3-11  решение"
        width={400}
        x={18}
        y={4}
      />
      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={18}
        rotation={0.5}
        text="дано MGF:"
        x={24}
        y={62}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={22}
        rotation={-0.25}
        text="Mₓ(t) = ²⁄₅eᵗ + ¹⁄₅e²ᵗ + ²⁄₅e³ᵗ"
        width={595}
        x={28}
        y={91}
      />
      <Line
        lineCap="round"
        points={[24, 130, 172, 128, 326, 132, 512, 129, 616, 131]}
        stroke="#6b8bc1"
        strokeWidth={2.2}
      />

      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={20}
        rotation={-0.45}
        text="1) коэффициенты → это вероятности"
        width={470}
        x={18}
        y={148}
      />
      <Arrow
        fill={RED_INK}
        pointerLength={9}
        pointerWidth={8}
        points={[400, 174, 452, 184, 493, 181]}
        stroke={RED_INK}
        strokeWidth={2.2}
        tension={0.35}
      />
      <Line
        closed
        lineCap="round"
        lineJoin="round"
        points={[28, 194, 292, 190, 302, 288, 31, 293, 25, 236]}
        stroke={BLUE_INK}
        strokeWidth={2.4}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={20}
        lineHeight={1.45}
        rotation={0.35}
        text={"P(X=1) = 2/5\nP(X=2) = 1/5\nP(X=3) = 2/5"}
        width={245}
        x={52}
        y={202}
      />
      <KonvaText
        fill={GREEN_INK}
        fontFamily={HAND_FONT}
        fontSize={17}
        rotation={-1.2}
        text="✓  2/5 + 1/5 + 2/5 = 1"
        width={290}
        x={330}
        y={220}
      />
      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={17}
        rotation={0.8}
        text="значит pmf готова"
        x={385}
        y={259}
      />

      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={20}
        rotation={0.4}
        text="2) mean — берём первую производную"
        width={520}
        x={22}
        y={320}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={19}
        lineHeight={1.5}
        rotation={-0.25}
        text={"M'ₓ(t) = ²⁄₅eᵗ + ²⁄₅e²ᵗ + ⁶⁄₅e³ᵗ\nμ = M'ₓ(0) = 2/5 + 2/5 + 6/5 = 2"}
        width={605}
        x={34}
        y={358}
      />
      <Line
        lineCap="round"
        points={[392, 430, 428, 434, 470, 429, 514, 433, 545, 430]}
        stroke={RED_INK}
        strokeWidth={2.8}
      />

      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={20}
        rotation={-0.35}
        text="3) variance — нужна вторая производная"
        width={545}
        x={20}
        y={468}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={19}
        lineHeight={1.5}
        rotation={0.3}
        text={"M''ₓ(0) = 2/5 + 4/5 + 18/5 = 24/5\nVar(X) = M''ₓ(0) - [M'ₓ(0)]²\n             = 24/5 - 4 = 4/5"}
        width={590}
        x={36}
        y={505}
      />

      <KonvaRect fill="#f9a8d4" height={45} opacity={0.33} rotation={0.8} width={590} x={25} y={604} />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={21}
        rotation={-0.35}
        text="Ответ:  μ=2,   Var(X)=4/5,   pmf=(2/5, 1/5, 2/5)"
        width={610}
        x={30}
        y={606}
      />
    </Group>
  );
}

function HandwrittenSummary({ element }: { element: SavedCardElement }) {
  return (
    <Group listening={false} x={element.x} y={element.y}>
      <KonvaRect fill="#86efac" height={44} opacity={0.35} rotation={-0.8} width={625} x={18} y={8} />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={27}
        rotation={-0.45}
        text="2.3 • Special Mathematical Expectations"
        width={655}
        x={16}
        y={4}
      />
      <KonvaText
        fill={RED_INK}
        fontFamily={HAND_FONT}
        fontSize={16}
        rotation={0.7}
        text="главные формулы + как ими пользоваться"
        width={420}
        x={232}
        y={55}
      />
      <Line
        lineCap="round"
        points={[14, 86, 160, 84, 310, 88, 477, 84, 662, 87]}
        stroke="#7aa2d6"
        strokeWidth={2.2}
      />

      <KonvaText
        fill={RED_INK}
        fontFamily={HAND_FONT}
        fontSize={22}
        rotation={-0.7}
        text="1. mean & moments"
        x={18}
        y={104}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={18}
        lineHeight={1.52}
        rotation={0.25}
        text={"Σ f(x)=1\nμ=E(X)=Σx f(x)\nE(X-μ)=0\n\nabout origin:\nE(Xʳ)=Σxʳf(x)\n\nabout b:\nE[(X-b)ʳ]=Σ(x-b)ʳf(x)"}
        width={295}
        x={28}
        y={143}
      />
      <Line
        closed
        lineCap="round"
        points={[17, 181, 306, 178, 311, 232, 20, 237]}
        stroke={GREEN_INK}
        strokeWidth={2}
      />

      <KonvaText
        fill={RED_INK}
        fontFamily={HAND_FONT}
        fontSize={22}
        rotation={0.5}
        text="2. variance"
        x={20}
        y={420}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={18}
        lineHeight={1.55}
        rotation={-0.2}
        text={"σ²=Var(X)=E[(X-μ)²]\n          =E(X²)-[E(X)]²\nσ=√Var(X)\n\nE(aX+b)=aE(X)+b\nVar(aX+b)=a²Var(X)"}
        width={310}
        x={29}
        y={458}
      />
      <KonvaText
        fill={GREEN_INK}
        fontFamily={HAND_FONT}
        fontSize={15}
        rotation={-1}
        text="+b сдвигает mean, но не variance!"
        width={305}
        x={13}
        y={648}
      />

      <Line
        lineCap="round"
        points={[338, 105, 342, 255, 338, 408, 343, 566, 339, 674]}
        stroke="#bfdbfe"
        strokeWidth={2.2}
      />

      <KonvaText
        fill={RED_INK}
        fontFamily={HAND_FONT}
        fontSize={22}
        rotation={0.6}
        text="3. factorial moments"
        x={362}
        y={106}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={17}
        lineHeight={1.55}
        rotation={-0.3}
        text={"E[(X)ᵣ] = E[X(X-1)...(X-r+1)]\n\nE[X(X-1)] = E(X²)-E(X)\n\nVar(X)=E[X(X-1)] + E(X)\n             - [E(X)]²"}
        width={305}
        x={365}
        y={146}
      />

      <KonvaText
        fill={RED_INK}
        fontFamily={HAND_FONT}
        fontSize={22}
        rotation={-0.55}
        text="4. MGF  ★"
        x={366}
        y={330}
      />
      <KonvaRect fill="#fde68a" height={37} opacity={0.42} rotation={1.1} width={300} x={360} y={370} />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={18}
        lineHeight={1.52}
        rotation={0.2}
        text={"Mₓ(t)=E(eᵗˣ)=Σeᵗˣf(x)\nMₓ(0)=1\n\nкоэффициент при eᵗᵇ = P(X=b)\n→ MGF определяет distribution\n\nM'ₓ(0)=E(X)\nM''ₓ(0)=E(X²)\nMₓ⁽ʳ⁾(0)=E(Xʳ)"}
        width={305}
        x={366}
        y={368}
      />
      <Line
        lineCap="round"
        points={[361, 642, 441, 638, 532, 643, 655, 639]}
        stroke={RED_INK}
        strokeWidth={2.4}
      />

      <KonvaRect fill="#fde68a" height={40} opacity={0.45} rotation={-0.6} width={230} x={18} y={703} />
      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={20}
        rotation={-0.4}
        text="быстрый алгоритм"
        x={25}
        y={702}
      />
      <KonvaText
        fill={BLUE_INK}
        fontFamily={HAND_FONT}
        fontSize={16.5}
        lineHeight={1.55}
        rotation={0.2}
        text={"1) раскрыть / узнать M(t)\n2) прочитать pmf или найти derivatives\n3) подставить t=0\n4) Var = M''(0)-[M'(0)]²"}
        width={320}
        x={26}
        y={752}
      />
      <Arrow
        fill={GREEN_INK}
        pointerLength={10}
        pointerWidth={8}
        points={[320, 758, 350, 777, 374, 770]}
        stroke={GREEN_INK}
        strokeWidth={2}
        tension={0.5}
      />
      <KonvaText
        fill={DARK_INK}
        fontFamily={HAND_FONT}
        fontSize={14.5}
        lineHeight={1.55}
        rotation={-0.35}
        text={"uniform 1..m:  μ=(m+1)/2,  σ²=(m²-1)/12\nhypergeom:  μ=np,  σ²=np(1-p)(N-n)/(N-1)\ngeometric:  μ=1/p,  σ²=q/p²"}
        width={315}
        x={367}
        y={744}
      />
      <KonvaText
        fill="#7890aa"
        fontFamily={HAND_FONT}
        fontSize={12.5}
        rotation={0.5}
        text="section 2.3 • pp. 56-63"
        x={485}
        y={884}
      />
    </Group>
  );
}

function SavedCard({ element }: { element: SavedCardElement }) {
  return element.card === "solution-2-3-11" ? (
    <HandwrittenSolution element={element} />
  ) : (
    <HandwrittenSummary element={element} />
  );
}


/** Shared by the editor and library previews so saved content renders identically. */
export function SceneElementView({ element }: { element: SceneElement }) {
  if (element.kind === "stroke") {
    return (
      <Line
        key={element.id}
        lineCap="round"
        lineJoin="round"
        listening={false}
        points={element.points}
        stroke={element.stroke ?? "#111827"}
        strokeWidth={element.strokeWidth}
        tension={0.35}
      />
    );
  }
  if (element.kind === "star") {
    return (
      <KonvaStar
        innerRadius={element.innerRadius}
        key={element.id}
        listening={false}
        numPoints={5}
        outerRadius={element.outerRadius}
        stroke="#111827"
        strokeWidth={4.5}
        x={element.x}
        y={element.y}
      />
    );
  }
  if (element.kind === "text") {
    return (
      <KonvaText
        fill={element.fill ?? "#2563eb"}
        fontFamily={mathFontFamily(
          element.text,
          element.fontFamily ?? "Segoe Print, Comic Sans MS, cursive",
        )}
        fontSize={element.fontSize}
        key={element.id}
        lineHeight={element.lineHeight ?? 1.5}
        listening={false}
        rotation={element.rotation ?? 0}
        text={element.text}
        width={element.width}
        wrap="word"
        x={element.x}
        y={element.y}
      />
    );
  }
  if (element.kind === "saved-card") {
    return <SavedCard element={element} key={element.id} />;
  }
  return <SceneImage element={element} key={element.id} />;
}
