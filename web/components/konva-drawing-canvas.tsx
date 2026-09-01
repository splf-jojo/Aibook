"use client";

import {
  BookOpenText,
  Brush,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  Languages,
  LogOut,
  MonitorUp,
  Moon,
  MousePointer2,
  PenLine,
  Settings,
  Shapes,
  Sparkles,
  Spline,
  Star,
  Sun,
  Sigma,
  X,
} from "lucide-react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Arrow,
  Image as KonvaImage,
  Group,
  Layer,
  Line,
  Rect as KonvaRect,
  Stage,
  Star as KonvaStar,
  Text as KonvaText,
} from "react-konva";

type Tool = "brush" | "eraser" | "select";
type EraserMode = "normal" | "object";
type AppTheme = "light" | "dark";
type AppLanguage = "ru" | "en" | "zh";
type Point = { x: number; y: number };
type SelectionRect = { x: number; y: number; width: number; height: number };
type StageSize = { width: number; height: number };
type ExportedImage = { dataUrl: string; width: number; height: number };
type SceneClipboard = { elements: SceneElement[]; bounds: SelectionRect };
type CanvasContextMenu = { x: number; y: number; point: Point };

type StrokeElement = {
  id: string;
  kind: "stroke";
  mode: "draw" | "erase";
  points: number[];
  strokeWidth: number;
};
type StarElement = {
  id: string;
  kind: "star";
  x: number;
  y: number;
  innerRadius: number;
  outerRadius: number;
};
type TextElement = {
  id: string;
  kind: "text";
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  source?: "complex-integral";
};
type ImageElement = {
  id: string;
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};
type SavedCardElement = {
  id: string;
  kind: "saved-card";
  card: "solution-2-3-11" | "summary-2-3";
  x: number;
  y: number;
  width: number;
  height: number;
};
type SceneElement = StrokeElement | StarElement | TextElement | ImageElement | SavedCardElement;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const MIN_SELECTION_SIZE = 3;
const STROKE_ERASER_RADIUS = 13;
const ERASER_LONG_PRESS_MS = 500;

const tools: Array<{ id: Tool; Icon: typeof Brush }> = [
  { id: "brush", Icon: Brush },
  { id: "eraser", Icon: Eraser },
  { id: "select", Icon: MousePointer2 },
];

const fakeSolutions: Record<AppLanguage, string[]> = {
  ru: [
    "Решение\n3x + 7 = 25\n3x = 18\nx = 6\nОтвет: 6",
    "Решение\nS = a · h / 2\nS = 12 · 7 / 2\nS = 42 см²\nОтвет: 42 см²",
    "Решение\nv = s / t\nv = 180 / 3\nv = 60 км/ч\nОтвет: 60 км/ч",
    "Решение\n2(x − 4) = 14\nx − 4 = 7\nx = 11\nОтвет: 11",
  ],
  en: [
    "Solution\n3x + 7 = 25\n3x = 18\nx = 6\nAnswer: 6",
    "Solution\nS = a · h / 2\nS = 12 · 7 / 2\nS = 42 cm²\nAnswer: 42 cm²",
    "Solution\nv = s / t\nv = 180 / 3\nv = 60 km/h\nAnswer: 60 km/h",
    "Solution\n2(x − 4) = 14\nx − 4 = 7\nx = 11\nAnswer: 11",
  ],
  zh: [
    "解答\n3x + 7 = 25\n3x = 18\nx = 6\n答案：6",
    "解答\nS = a · h / 2\nS = 12 · 7 / 2\nS = 42 cm²\n答案：42 cm²",
    "解答\nv = s / t\nv = 180 / 3\nv = 60 km/h\n答案：60 km/h",
    "解答\n2(x − 4) = 14\nx − 4 = 7\nx = 11\n答案：11",
  ],
};

const UI_TEXT = {
  ru: {
    brush: "Кисть",
    eraser: "Ластик",
    select: "Выделение",
    normalMode: "обычный режим",
    objectMode: "объектный режим",
    eraserHint: "Ластик — удерживайте для выбора режима",
    normalEraser: "Обычный ластик",
    objectEraser: "Объектный ластик",
    savedShapes: "Сохранённые фигуры",
    addStar: "Добавить звезду",
    star: "Звезда",
    addSolution: "Добавить решение задачи 2.3-11",
    solution: "Решение 2.3-11",
    addSummary: "Добавить конспект раздела 2.3",
    summary: "Конспект 2.3",
    addIntegral: "Добавить сложный интеграл",
    complexIntegral: "Сложный интеграл",
    settings: "Настройки",
    selectionActions: "Действия с выделением",
    ai1Aria: "ИИ 1 — показать решение в сайдбаре",
    ai1Title: "ИИ 1 — решение в сайдбаре",
    ai2Aria: "ИИ 2 — написать решение на канвасе",
    ai2Title: "ИИ 2 — решение на канвасе",
    copyAria: "Копировать выделенные объекты",
    copy: "Копировать",
    duplicateAria: "Дублировать выделенные объекты",
    duplicate: "Дублировать",
    sendAria: "Отправить выделение на Windows",
    send: "Отправить на Windows",
    ai: "ИИ",
    closeAi: "Закрыть ИИ-сайдбар",
    close: "Закрыть",
    processing: "Обработка",
    aiRequestFailed: "Не удалось получить ответ Qwen. Повторите попытку.",
    canvasActions: "Действия с канвасом",
    paste: "Вставить",
    closeSettings: "Закрыть настройки",
    theme: "Тема",
    light: "Светлая",
    dark: "Тёмная",
    language: "Язык",
    logout: "Выйти из аккаунта",
  },
  en: {
    brush: "Brush",
    eraser: "Eraser",
    select: "Select",
    normalMode: "normal mode",
    objectMode: "object mode",
    eraserHint: "Eraser — press and hold to choose a mode",
    normalEraser: "Normal eraser",
    objectEraser: "Object eraser",
    savedShapes: "Saved shapes",
    addStar: "Add a star",
    star: "Star",
    addSolution: "Add solution for problem 2.3-11",
    solution: "Solution 2.3-11",
    addSummary: "Add notes for section 2.3",
    summary: "Notes 2.3",
    addIntegral: "Add a complex integral",
    complexIntegral: "Complex integral",
    settings: "Settings",
    selectionActions: "Selection actions",
    ai1Aria: "AI 1 — show the solution in the sidebar",
    ai1Title: "AI 1 — sidebar solution",
    ai2Aria: "AI 2 — write the solution on the canvas",
    ai2Title: "AI 2 — canvas solution",
    copyAria: "Copy selected objects",
    copy: "Copy",
    duplicateAria: "Duplicate selected objects",
    duplicate: "Duplicate",
    sendAria: "Send selection to Windows",
    send: "Send to Windows",
    ai: "AI",
    closeAi: "Close AI sidebar",
    close: "Close",
    processing: "Processing",
    aiRequestFailed: "Could not get a response from Qwen. Please try again.",
    canvasActions: "Canvas actions",
    paste: "Paste",
    closeSettings: "Close settings",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    language: "Language",
    logout: "Sign out",
  },
  zh: {
    brush: "画笔",
    eraser: "橡皮擦",
    select: "选择",
    normalMode: "普通模式",
    objectMode: "对象模式",
    eraserHint: "长按橡皮擦以选择模式",
    normalEraser: "普通橡皮擦",
    objectEraser: "对象橡皮擦",
    savedShapes: "已保存的图形",
    addStar: "添加星形",
    star: "星形",
    addSolution: "添加习题 2.3-11 的解答",
    solution: "解答 2.3-11",
    addSummary: "添加第 2.3 节笔记",
    summary: "笔记 2.3",
    addIntegral: "添加复杂积分",
    complexIntegral: "复杂积分",
    settings: "设置",
    selectionActions: "所选对象操作",
    ai1Aria: "AI 1 — 在侧边栏显示解答",
    ai1Title: "AI 1 — 侧边栏解答",
    ai2Aria: "AI 2 — 在画布上书写解答",
    ai2Title: "AI 2 — 画布解答",
    copyAria: "复制所选对象",
    copy: "复制",
    duplicateAria: "创建所选对象的副本",
    duplicate: "创建副本",
    sendAria: "将所选区域发送到 Windows",
    send: "发送到 Windows",
    ai: "AI",
    closeAi: "关闭 AI 侧边栏",
    close: "关闭",
    processing: "处理中",
    aiRequestFailed: "无法获取 Qwen 的回复，请重试。",
    canvasActions: "画布操作",
    paste: "粘贴",
    closeSettings: "关闭设置",
    theme: "主题",
    light: "浅色",
    dark: "深色",
    language: "语言",
    logout: "退出登录",
  },
} satisfies Record<AppLanguage, Record<string, string>>;

const HAND_FONT = "Segoe Print, Comic Sans MS, cursive";
const BLUE_INK = "#2456a6";
const DARK_INK = "#27364a";
const RED_INK = "#c2413b";
const GREEN_INK = "#27835b";

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function normalizeRect(start: Point, end: Point): SelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function randomSolution(language: AppLanguage): string {
  const solutions = fakeSolutions[language];
  return solutions[Math.floor(Math.random() * solutions.length)];
}

const COMPLEX_INTEGRAL_PARTS: Array<Omit<TextElement, "id" | "kind" | "source">> = [
  { x: 48, y: 404, width: 72, text: "∫", fontSize: 112 },
  { x: 78, y: 376, width: 28, text: "1", fontSize: 24 },
  { x: 58, y: 512, width: 28, text: "0", fontSize: 24 },
  { x: 124, y: 404, width: 72, text: "∫", fontSize: 112 },
  { x: 154, y: 370, width: 142, text: "√(1−x²)", fontSize: 24 },
  { x: 134, y: 512, width: 28, text: "0", fontSize: 24 },
  { x: 254, y: 449, width: 26, text: "(", fontSize: 48 },
  { x: 281, y: 450, width: 60, text: "x²", fontSize: 46 },
  { x: 342, y: 450, width: 38, text: "+", fontSize: 44 },
  { x: 382, y: 451, width: 60, text: "y²", fontSize: 46 },
  { x: 443, y: 449, width: 26, text: ")", fontSize: 48 },
  { x: 476, y: 450, width: 38, text: "e", fontSize: 46 },
  { x: 509, y: 426, width: 72, text: "x+y", fontSize: 24 },
  { x: 584, y: 453, width: 34, text: "d", fontSize: 42 },
  { x: 617, y: 453, width: 34, text: "y", fontSize: 42 },
  { x: 663, y: 454, width: 34, text: "d", fontSize: 42 },
  { x: 696, y: 454, width: 34, text: "x", fontSize: 42 },
];

function createComplexIntegralElements(offset: number): TextElement[] {
  return COMPLEX_INTEGRAL_PARTS.map((part) => ({
    ...part,
    id: createId(),
    kind: "text",
    source: "complex-integral",
    x: part.x + offset,
    y: part.y + offset,
  }));
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function strokeTouchesPoint(stroke: StrokeElement, point: Point): boolean {
  const threshold = STROKE_ERASER_RADIUS + stroke.strokeWidth / 2;
  if (stroke.points.length === 2) {
    return Math.hypot(point.x - stroke.points[0], point.y - stroke.points[1]) <= threshold;
  }
  for (let index = 0; index <= stroke.points.length - 4; index += 2) {
    const start = { x: stroke.points[index], y: stroke.points[index + 1] };
    const end = { x: stroke.points[index + 2], y: stroke.points[index + 3] };
    if (distanceToSegment(point, start, end) <= threshold) return true;
  }
  return false;
}

function sceneElementBounds(element: SceneElement): SelectionRect | null {
  if (element.kind === "stroke") {
    if (element.points.length < 2) return null;
    const xs = element.points.filter((_, index) => index % 2 === 0);
    const ys = element.points.filter((_, index) => index % 2 === 1);
    const padding = element.strokeWidth / 2;
    const minX = Math.min(...xs) - padding;
    const minY = Math.min(...ys) - padding;
    const maxX = Math.max(...xs) + padding;
    const maxY = Math.max(...ys) + padding;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  if (element.kind === "star") {
    return {
      x: element.x - element.outerRadius,
      y: element.y - element.outerRadius,
      width: element.outerRadius * 2,
      height: element.outerRadius * 2,
    };
  }
  if (element.kind === "text") {
    const charactersPerLine = Math.max(1, Math.floor(element.width / (element.fontSize * 0.56)));
    const lineCount = element.text
      .split("\n")
      .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: lineCount * element.fontSize * 1.5,
    };
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

function rectsIntersect(first: SelectionRect, second: SelectionRect): boolean {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

function rectContainsPoint(rect: SelectionRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function boundsForElements(elements: SceneElement[], ids: string[]): SelectionRect | null {
  const selected = new Set(ids);
  const bounds = elements
    .filter((element) => selected.has(element.id))
    .map(sceneElementBounds)
    .filter((rect): rect is SelectionRect => rect !== null);
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map((rect) => rect.x));
  const minY = Math.min(...bounds.map((rect) => rect.y));
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function moveSceneElement(element: SceneElement, selected: Set<string>, dx: number, dy: number): SceneElement {
  if (!selected.has(element.id)) return element;
  if (element.kind === "stroke") {
    return {
      ...element,
      points: element.points.map((coordinate, index) => coordinate + (index % 2 === 0 ? dx : dy)),
    };
  }
  return { ...element, x: element.x + dx, y: element.y + dy };
}

function snapshotSceneElement(element: SceneElement): SceneElement {
  return element.kind === "stroke" ? { ...element, points: [...element.points] } : { ...element };
}

function cloneSceneElement(element: SceneElement, dx: number, dy: number): SceneElement {
  if (element.kind === "stroke") {
    return {
      ...element,
      id: createId(),
      points: element.points.map((coordinate, index) => coordinate + (index % 2 === 0 ? dx : dy)),
    };
  }
  return { ...element, id: createId(), x: element.x + dx, y: element.y + dy };
}

function placementOffset(bounds: SelectionRect, point: Point, gap = 12): Point {
  const desiredX = point.x + gap;
  const desiredY = point.y + gap;
  const targetX = Math.max(0, Math.min(desiredX, PAGE_WIDTH - bounds.width));
  const targetY = Math.max(0, Math.min(desiredY, PAGE_HEIGHT - bounds.height));
  return { x: targetX - bounds.x, y: targetY - bounds.y };
}

function selectionHandles(rect: SelectionRect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

function SceneImage({ element }: { element: ImageElement }) {
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

export function KonvaDrawingCanvas({
  appTheme,
  language,
  onLanguageChange,
  onLogout,
  onThemeChange,
  token,
}: {
  appTheme: AppTheme;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onThemeChange: (theme: AppTheme) => void;
  token: string;
}) {
  const workspaceRef = useRef<HTMLElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const selectionLayerRef = useRef<Konva.Layer | null>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<Point | null>(null);
  const draggingSelectionRef = useRef(false);
  const lastDragPointRef = useRef<Point | null>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const sceneClipboardRef = useRef<SceneClipboard | null>(null);
  const selectionRef = useRef<SelectionRect | null>(null);
  const sidebarRequestRef = useRef<AbortController | null>(null);
  const sidebarTypingRef = useRef<number | null>(null);
  const canvasDelayRef = useRef<number | null>(null);
  const canvasTypingRef = useRef<number | null>(null);
  const eraserPressTimerRef = useRef<number | null>(null);
  const eraserLongPressTriggeredRef = useRef(false);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const [elements, setElements] = useState<SceneElement[]>([]);
  const [tool, setTool] = useState<Tool>("brush");
  const [eraserMode, setEraserMode] = useState<EraserMode>("normal");
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboardReady, setClipboardReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarText, setSidebarText] = useState("");
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [canvasAiBusy, setCanvasAiBusy] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const text = UI_TEXT[language];

  const scaleX = stageSize.width / PAGE_WIDTH || 1;
  const scaleY = stageSize.height / PAGE_HEIGHT || 1;

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const resize = () => {
      const availableWidth = Math.max(1, workspace.clientWidth - 48);
      const availableHeight = Math.max(1, workspace.clientHeight - 88);
      const pageScale = Math.min(1, availableWidth / PAGE_WIDTH, availableHeight / PAGE_HEIGHT);
      if (pageScale > 0) {
        setStageSize({
          width: Math.max(1, Math.floor(PAGE_WIDTH * pageScale)),
          height: Math.max(1, Math.floor(PAGE_HEIGHT * pageScale)),
        });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(workspace);
    const frame = window.requestAnimationFrame(resize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setEraserMenuOpen(false);
        setShapesOpen(false);
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(
    () => () => {
      sidebarRequestRef.current?.abort();
      if (sidebarTypingRef.current !== null) window.clearInterval(sidebarTypingRef.current);
      if (canvasDelayRef.current !== null) window.clearTimeout(canvasDelayRef.current);
      if (canvasTypingRef.current !== null) window.clearInterval(canvasTypingRef.current);
      if (eraserPressTimerRef.current !== null) window.clearTimeout(eraserPressTimerRef.current);
    },
    [],
  );

  const pointFromStage = useCallback((): Point | null => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: Math.max(0, Math.min(PAGE_WIDTH, pointer.x / scaleX)),
      y: Math.max(0, Math.min(PAGE_HEIGHT, pointer.y / scaleY)),
    };
  }, [scaleX, scaleY]);

  const eraseObjectAtPoint = useCallback((point: Point) => {
    setElements((current) => {
      let candidateId: string | null = null;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const element = current[index];
        const hit =
          element.kind === "stroke"
            ? element.mode === "draw" && strokeTouchesPoint(element, point)
            : rectContainsPoint(sceneElementBounds(element)!, point);
        if (hit) {
          candidateId = element.id;
          break;
        }
      }
      return candidateId ? current.filter((element) => element.id !== candidateId) : current;
    });
  }, []);

  const exportSelection = useCallback(
    (rect: SelectionRect): ExportedImage | null => {
      const stage = stageRef.current;
      const selectionLayer = selectionLayerRef.current;
      if (!stage || rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) return null;
      selectionLayer?.hide();
      selectionLayer?.draw();
      const pixelRatio = window.devicePixelRatio || 1;
      const dataUrl = stage.toDataURL({
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
        pixelRatio,
        mimeType: "image/png",
      });
      selectionLayer?.show();
      selectionLayer?.draw();
      return { dataUrl, width: rect.width, height: rect.height };
    },
    [scaleX, scaleY],
  );

  const sendSelection = useCallback(
    async (rect: SelectionRect) => {
      const cropped = exportSelection(rect);
      if (!cropped) return;
      setSending(true);
      try {
        const blob = await fetch(cropped.dataUrl).then((response) => response.blob());
        const data = new FormData();
        data.append("image", blob, "canvas.png");
        data.append("width", String(Math.max(1, Math.round(rect.width * scaleX * (window.devicePixelRatio || 1)))));
        data.append("height", String(Math.max(1, Math.round(rect.height * scaleY * (window.devicePixelRatio || 1)))));
        const response = await fetch(`${API_URL}/api/images`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: data,
        });
        if (response.status === 401) onLogout();
      } finally {
        setSending(false);
        setSelection(null);
      }
    },
    [exportSelection, onLogout, scaleX, scaleY, token],
  );

  const runSidebarAi = useCallback(async (selectionImage: ExportedImage) => {
    sidebarRequestRef.current?.abort();
    if (sidebarTypingRef.current !== null) window.clearInterval(sidebarTypingRef.current);
    const controller = new AbortController();
    sidebarRequestRef.current = controller;
    setSidebarOpen(true);
    setSidebarText("");
    setSidebarBusy(true);

    try {
      const image = await fetch(selectionImage.dataUrl).then((response) => response.blob());
      const data = new FormData();
      data.append("image", image, "selection.png");
      data.append("language", language);
      const response = await fetch(`${API_URL}/api/ai/sidebar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: data,
        signal: controller.signal,
      });
      if (response.status === 401) {
        setSidebarBusy(false);
        onLogout();
        return;
      }
      if (!response.ok) throw new Error("qwen-request-failed");
      const payload = (await response.json()) as { text?: unknown };
      if (typeof payload.text !== "string" || !payload.text.trim()) {
        throw new Error("qwen-empty-response");
      }

      const answer = payload.text.trim();
      let index = 0;
      const charactersPerTick = Math.max(1, Math.ceil(answer.length / 240));
      sidebarTypingRef.current = window.setInterval(() => {
        index += charactersPerTick;
        setSidebarText(answer.slice(0, index));
        if (index >= answer.length) {
          if (sidebarTypingRef.current !== null) window.clearInterval(sidebarTypingRef.current);
          sidebarTypingRef.current = null;
          setSidebarBusy(false);
        }
      }, 20);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSidebarText(UI_TEXT[language].aiRequestFailed);
      setSidebarBusy(false);
    } finally {
      if (sidebarRequestRef.current === controller) sidebarRequestRef.current = null;
    }
  }, [language, onLogout, token]);

  const runCanvasAi = useCallback((rect: SelectionRect) => {
    if (canvasDelayRef.current !== null) window.clearTimeout(canvasDelayRef.current);
    if (canvasTypingRef.current !== null) window.clearInterval(canvasTypingRef.current);
    setCanvasAiBusy(true);
    const solution = randomSolution(language);
    const id = createId();
    canvasDelayRef.current = window.setTimeout(() => {
      const fontSize = 30;
      const width = Math.max(270, PAGE_WIDTH - Math.max(40, rect.x) - 40);
      const estimatedHeight = solution.split("\n").length * fontSize * 1.5;
      let x = Math.max(40, rect.x);
      let y = rect.y + rect.height + 24;
      if (x + width > PAGE_WIDTH - 40) x = 40;
      if (y + estimatedHeight > PAGE_HEIGHT - 40) y = Math.max(40, rect.y - estimatedHeight - 20);
      setElements((current) => [
        ...current,
        { id, kind: "text", x, y, width: Math.min(width, PAGE_WIDTH - x - 40), text: "", fontSize },
      ]);
      let index = 0;
      canvasTypingRef.current = window.setInterval(() => {
        index += 1;
        setElements((current) =>
          current.map((element) =>
            element.id === id && element.kind === "text"
              ? { ...element, text: solution.slice(0, index) }
              : element,
          ),
        );
        if (index >= solution.length) {
          if (canvasTypingRef.current !== null) window.clearInterval(canvasTypingRef.current);
          canvasTypingRef.current = null;
          setCanvasAiBusy(false);
        }
      }, 34);
    }, 650);
  }, [language]);

  const addSavedStar = useCallback(() => {
    if (canvasAiBusy) return;
    const outerRadius = 92;
    setElements((current) => [
      ...current,
      {
        id: createId(),
        kind: "star",
        x: PAGE_WIDTH / 2,
        y: PAGE_HEIGHT / 2,
        innerRadius: outerRadius * 0.44,
        outerRadius,
      },
    ]);
    setShapesOpen(false);
    setSelectedIds([]);
    setSelection(null);
  }, [canvasAiBusy]);

  const addSavedCard = useCallback(
    (card: SavedCardElement["card"]) => {
      if (canvasAiBusy) return;
      setElements((current) => {
        const copies = current.filter(
          (element) => element.kind === "saved-card" && element.card === card,
        ).length;
        const offset = (copies % 3) * 16;
        const isSolution = card === "solution-2-3-11";
        const width = isSolution ? 650 : 690;
        const height = isSolution ? 650 : 920;
        return [
          ...current,
          {
            id: createId(),
            kind: "saved-card",
            card,
            x: (PAGE_WIDTH - width) / 2 + offset,
            y: (isSolution ? 86 : 64) + offset,
            width,
            height,
          },
        ];
      });
      setShapesOpen(false);
      setSelectedIds([]);
      setSelection(null);
    },
    [canvasAiBusy],
  );

  const addComplexIntegral = useCallback(() => {
    if (canvasAiBusy) return;
    setElements((current) => {
      const partCount = current.filter(
        (element) => element.kind === "text" && element.source === "complex-integral",
      ).length;
      const copies = Math.floor(partCount / COMPLEX_INTEGRAL_PARTS.length);
      const offset = (copies % 3) * 14;
      return [...current, ...createComplexIntegralElements(offset)];
    });
    setShapesOpen(false);
    setSelectedIds([]);
    setSelection(null);
  }, [canvasAiBusy]);

  const activateTool = useCallback((nextTool: Tool) => {
    setTool(nextTool);
    setShapesOpen(false);
    setEraserMenuOpen(false);
    setContextMenu(null);
    if (nextTool !== "select") {
      setSelectedIds([]);
      setSelection(null);
    }
  }, []);

  const beginEraserPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (eraserPressTimerRef.current !== null) window.clearTimeout(eraserPressTimerRef.current);
    eraserLongPressTriggeredRef.current = false;
    eraserPressTimerRef.current = window.setTimeout(() => {
      eraserLongPressTriggeredRef.current = true;
      eraserPressTimerRef.current = null;
      setTool("eraser");
      setShapesOpen(false);
      setSelectedIds([]);
      setSelection(null);
      setEraserMenuOpen(true);
    }, ERASER_LONG_PRESS_MS);
  };

  const finishEraserPress = () => {
    if (eraserPressTimerRef.current !== null) {
      window.clearTimeout(eraserPressTimerRef.current);
      eraserPressTimerRef.current = null;
    }
  };

  const clickEraser = () => {
    if (eraserLongPressTriggeredRef.current) {
      eraserLongPressTriggeredRef.current = false;
      return;
    }
    activateTool("eraser");
  };

  const chooseEraserMode = (mode: EraserMode) => {
    setEraserMode(mode);
    setTool("eraser");
    setEraserMenuOpen(false);
    setShapesOpen(false);
    setSelectedIds([]);
    setSelection(null);
  };

  const copySelectedObjects = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    const copiedElements = elements
      .filter((element) => selected.has(element.id))
      .map(snapshotSceneElement);
    const bounds = boundsForElements(copiedElements, copiedElements.map((element) => element.id));
    if (!copiedElements.length || !bounds) return;
    sceneClipboardRef.current = {
      elements: copiedElements,
      bounds: { ...bounds },
    };
    setClipboardReady(true);
    setSelectedIds([]);
    selectionRef.current = null;
    setSelection(null);
  }, [elements, selectedIds]);

  const duplicateSelectedObjects = useCallback(() => {
    if (!selectedIds.length) return;
    const bounds = boundsForElements(elements, selectedIds);
    if (!bounds) return;
    const dx = bounds.x + bounds.width + 18 <= PAGE_WIDTH ? 18 : bounds.x >= 18 ? -18 : 0;
    const dy = bounds.y + bounds.height + 18 <= PAGE_HEIGHT ? 18 : bounds.y >= 18 ? -18 : 0;
    const selected = new Set(selectedIds);
    const clones = elements
      .filter((element) => selected.has(element.id))
      .map((element) => cloneSceneElement(element, dx, dy));
    if (!clones.length) return;
    setElements((current) => [...current, ...clones]);
    const cloneIds = clones.map((element) => element.id);
    const nextBounds = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
    setSelectedIds(cloneIds);
    selectionRef.current = nextBounds;
    setSelection(nextBounds);
  }, [elements, selectedIds]);

  const pasteClipboardAt = useCallback((point: Point) => {
    const clipboard = sceneClipboardRef.current;
    if (!clipboard) return;
    const offset = placementOffset(clipboard.bounds, point);
    const clones = clipboard.elements.map((element) => cloneSceneElement(element, offset.x, offset.y));
    const nextBounds = {
      ...clipboard.bounds,
      x: clipboard.bounds.x + offset.x,
      y: clipboard.bounds.y + offset.y,
    };
    setElements((current) => [...current, ...clones]);
    setTool("select");
    setSelectedIds(clones.map((element) => element.id));
    selectionRef.current = nextBounds;
    setSelection(nextBounds);
    setContextMenu(null);
  }, []);

  const runSelectedSidebarAi = () => {
    if (!selection || !selectedIds.length) return;
    const selectionImage = exportSelection(selection);
    if (!selectionImage) return;
    setSelectedIds([]);
    selectionRef.current = null;
    setSelection(null);
    void runSidebarAi(selectionImage);
  };

  const runSelectedCanvasAi = () => {
    if (!selection || !selectedIds.length) return;
    const selectedArea = selection;
    setSelectedIds([]);
    selectionRef.current = null;
    setSelection(null);
    runCanvasAi(selectedArea);
  };

  const sendSelectedToWindows = () => {
    if (!selection || !selectedIds.length || sending) return;
    const selectedArea = selection;
    setSelectedIds([]);
    selectionRef.current = null;
    setSelection(null);
    void sendSelection(selectedArea);
  };

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    if (event.evt.button !== 0 || canvasAiBusy) return;
    const point = pointFromStage();
    if (!point) return;
    drawingRef.current = true;
    startRef.current = point;

    if (
      tool === "select" &&
      selectedIds.length > 0 &&
      selectionRef.current &&
      rectContainsPoint(selectionRef.current, point)
    ) {
      draggingSelectionRef.current = true;
      lastDragPointRef.current = point;
      return;
    }

    draggingSelectionRef.current = false;
    lastDragPointRef.current = null;
    setSelectedIds([]);

    if (tool === "brush" || (tool === "eraser" && eraserMode === "normal")) {
      const id = createId();
      activeStrokeIdRef.current = id;
      setSelection(null);
      setElements((current) => [
        ...current,
        {
          id,
          kind: "stroke",
          mode: tool === "eraser" ? "erase" : "draw",
          points: [point.x, point.y, point.x + 0.01, point.y + 0.01],
          strokeWidth: tool === "eraser" ? 27 : 4.5,
        },
      ]);
    } else if (tool === "eraser") {
      setSelection(null);
      eraseObjectAtPoint(point);
    } else {
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    }
  };

  const handlePointerMove = () => {
    if (!drawingRef.current) return;
    const point = pointFromStage();
    if (!point) return;

    if (draggingSelectionRef.current && tool === "select") {
      const last = lastDragPointRef.current;
      const currentBounds = selectionRef.current;
      if (!last || !currentBounds) return;
      const rawDx = point.x - last.x;
      const rawDy = point.y - last.y;
      const dx = Math.max(-currentBounds.x, Math.min(rawDx, PAGE_WIDTH - currentBounds.x - currentBounds.width));
      const dy = Math.max(-currentBounds.y, Math.min(rawDy, PAGE_HEIGHT - currentBounds.y - currentBounds.height));
      if (dx !== 0 || dy !== 0) {
        const selected = new Set(selectedIds);
        setElements((current) => current.map((element) => moveSceneElement(element, selected, dx, dy)));
        const nextBounds = { ...currentBounds, x: currentBounds.x + dx, y: currentBounds.y + dy };
        selectionRef.current = nextBounds;
        setSelection(nextBounds);
      }
      lastDragPointRef.current = point;
      return;
    }

    if (tool === "brush" || (tool === "eraser" && eraserMode === "normal")) {
      const id = activeStrokeIdRef.current;
      if (!id) return;
      setElements((current) =>
        current.map((element) =>
          element.id === id && element.kind === "stroke"
            ? { ...element, points: [...element.points, point.x, point.y] }
            : element,
        ),
      );
    } else if (tool === "eraser") {
      eraseObjectAtPoint(point);
    } else if (startRef.current) {
      setSelection(normalizeRect(startRef.current, point));
    }
  };

  const handleCanvasContextMenu = (event: KonvaEventObject<MouseEvent>) => {
    event.evt.preventDefault();
    const point = pointFromStage();
    if (!point) return;
    setShapesOpen(false);
    setEraserMenuOpen(false);
    setContextMenu({
      x: Math.max(8, Math.min(event.evt.clientX, window.innerWidth - 196)),
      y: Math.max(8, Math.min(event.evt.clientY, window.innerHeight - 64)),
      point,
    });
  };

  const finishPointer = () => {
    if (!drawingRef.current) return;
    const end = pointFromStage();
    const start = startRef.current;
    drawingRef.current = false;
    startRef.current = null;
    activeStrokeIdRef.current = null;
    if (draggingSelectionRef.current) {
      draggingSelectionRef.current = false;
      lastDragPointRef.current = null;
      return;
    }
    if (!start || !end || tool !== "select") return;
    const rect = normalizeRect(start, end);
    const valid = rect.width >= MIN_SELECTION_SIZE && rect.height >= MIN_SELECTION_SIZE;
    if (!valid) {
      setSelectedIds([]);
      setSelection(null);
      return;
    }
    const ids = elements
      .filter((element) => {
        const bounds = sceneElementBounds(element);
        return bounds !== null && rectsIntersect(rect, bounds);
      })
      .map((element) => element.id);
    const activeBounds = boundsForElements(elements, ids);
    setSelectedIds(ids);
    selectionRef.current = activeBounds;
    setSelection(activeBounds);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || tool !== "select") return;
      if (event.key.toLowerCase() === "c" && selectedIds.length) {
        event.preventDefault();
        copySelectedObjects();
      }
      if (event.key.toLowerCase() === "v" && sceneClipboardRef.current) {
        event.preventDefault();
        const source = selectionRef.current;
        pasteClipboardAt({ x: (source?.x ?? 0) + 6, y: (source?.y ?? 0) + 6 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectedObjects, pasteClipboardAt, selectedIds.length, tool]);

  const cursor = tool === "select" ? (selectedIds.length ? "move" : "cell") : "crosshair";
  const selectionIslandLeft = selection
    ? stageSize.width < 208
      ? stageSize.width / 2
      : Math.max(104, Math.min((selection.x + selection.width / 2) * scaleX, stageSize.width - 104))
    : 0;
  const selectionIslandTop = selection
    ? selection.y * scaleY >= 58
      ? selection.y * scaleY - 52
      : (selection.y + selection.height) * scaleY + 10
    : 0;

  return (
    <>
    <main className="flex h-dvh w-dvw overflow-hidden bg-[#f4f5f7]">
      <section
        className="relative flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden px-6 pb-4 pt-[72px]"
        ref={workspaceRef}
      >
        <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-[#dfe3e8] bg-white p-1.5 shadow-sm">
          {tools.map(({ id, Icon }) => {
            const label = text[id];
            if (id === "eraser") {
              return (
                <div className="relative" key={id}>
                  <button
                    aria-label={`${label}: ${eraserMode === "normal" ? text.normalMode : text.objectMode}`}
                    aria-pressed={tool === id}
                    className={`grid size-10 touch-none select-none place-items-center rounded-lg transition-colors ${
                      tool === id ? "bg-[#eff6ff] text-[#2563eb]" : "text-[#697386] hover:bg-[#eef0f3]"
                    }`}
                    onClick={clickEraser}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerCancel={finishEraserPress}
                    onPointerDown={beginEraserPress}
                    onPointerLeave={finishEraserPress}
                    onPointerUp={finishEraserPress}
                    title={text.eraserHint}
                    type="button"
                  >
                    <Eraser aria-hidden="true" size={19} strokeWidth={2} />
                  </button>
                  {eraserMenuOpen && (
                    <div className="absolute left-1/2 top-12 z-30 w-[210px] -translate-x-1/2 rounded-2xl border border-[#dfe3e8] bg-white p-1.5 shadow-lg">
                      <button
                        aria-pressed={eraserMode === "normal"}
                        className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${
                          eraserMode === "normal"
                            ? "bg-[#eff6ff] text-[#2563eb]"
                            : "text-[#334155] hover:bg-[#eef0f3]"
                        }`}
                        onClick={() => chooseEraserMode("normal")}
                        type="button"
                      >
                        <Eraser aria-hidden="true" size={18} strokeWidth={2} />
                        <span>{text.normalEraser}</span>
                      </button>
                      <button
                        aria-pressed={eraserMode === "object"}
                        className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${
                          eraserMode === "object"
                            ? "bg-[#eff6ff] text-[#2563eb]"
                            : "text-[#334155] hover:bg-[#eef0f3]"
                        }`}
                        onClick={() => chooseEraserMode("object")}
                        type="button"
                      >
                        <Spline aria-hidden="true" size={18} strokeWidth={2} />
                        <span>{text.objectEraser}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                aria-label={label}
                aria-pressed={tool === id}
                className={`grid size-10 place-items-center rounded-lg transition-colors ${
                  tool === id ? "bg-[#eff6ff] text-[#2563eb]" : "text-[#697386] hover:bg-[#eef0f3]"
                }`}
                key={id}
                onClick={() => activateTool(id)}
                title={label}
                type="button"
              >
                <Icon aria-hidden="true" size={19} strokeWidth={2} />
              </button>
            );
          })}

          <div className="relative">
            <button
              aria-expanded={shapesOpen}
              aria-label={text.savedShapes}
              className={`grid size-10 place-items-center rounded-lg transition-colors ${
                shapesOpen ? "bg-[#eff6ff] text-[#2563eb]" : "text-[#697386] hover:bg-[#eef0f3]"
              }`}
              onClick={() => setShapesOpen((open) => !open)}
              title={text.savedShapes}
              type="button"
            >
              <Shapes aria-hidden="true" size={19} strokeWidth={2} />
            </button>
            {shapesOpen && (
              <div className="absolute left-1/2 top-12 z-20 w-[248px] -translate-x-1/2 rounded-xl border border-[#dfe3e8] bg-white p-1.5 shadow-lg">
                <button
                  aria-label={text.addStar}
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#334155] hover:bg-[#eef0f3]"
                  onClick={addSavedStar}
                  title={text.star}
                  type="button"
                >
                  <Star aria-hidden="true" className="shrink-0 text-[#697386]" size={19} strokeWidth={2} />
                  <span>{text.star}</span>
                </button>
                <button
                  aria-label={text.addSolution}
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#334155] hover:bg-[#eef0f3]"
                  onClick={() => addSavedCard("solution-2-3-11")}
                  title={text.solution}
                  type="button"
                >
                  <Sigma aria-hidden="true" className="shrink-0 text-[#2563eb]" size={19} strokeWidth={2} />
                  <span>{text.solution}</span>
                </button>
                <button
                  aria-label={text.addSummary}
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#334155] hover:bg-[#eef0f3]"
                  onClick={() => addSavedCard("summary-2-3")}
                  title={text.addSummary}
                  type="button"
                >
                  <BookOpenText
                    aria-hidden="true"
                    className="shrink-0 text-[#0f766e]"
                    size={19}
                    strokeWidth={2}
                  />
                  <span>{text.summary}</span>
                </button>
                <button
                  aria-label={text.addIntegral}
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#334155] hover:bg-[#eef0f3]"
                  onClick={addComplexIntegral}
                  title={text.complexIntegral}
                  type="button"
                >
                  <Sigma aria-hidden="true" className="shrink-0 text-[#7c3aed]" size={19} strokeWidth={2} />
                  <span>{text.complexIntegral}</span>
                </button>
              </div>
            )}
          </div>

          <button
            aria-label={text.settings}
            className="grid size-10 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3]"
            onClick={() => {
              setSettingsOpen(true);
              setShapesOpen(false);
              setEraserMenuOpen(false);
            }}
            title={text.settings}
            type="button"
          >
            <Settings aria-hidden="true" size={19} strokeWidth={2} />
          </button>
        </div>

        <div
          aria-label="A4 canvas"
          className="keep-white relative flex-none overflow-hidden rounded-[3px] bg-white shadow-[0_4px_24px_rgba(17,24,39,0.08)] ring-1 ring-[#dfe3e8]"
          style={{ height: stageSize.height, width: stageSize.width }}
        >
          {stageSize.width > 0 && stageSize.height > 0 && (
            <Stage
              height={stageSize.height}
              onContextMenu={handleCanvasContextMenu}
              onPointerCancel={finishPointer}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointer}
              ref={stageRef}
              style={{ cursor, touchAction: "none" }}
              width={stageSize.width}
            >
              <Layer listening={false} scaleX={scaleX} scaleY={scaleY}>
                <KonvaRect fill="#ffffff" height={PAGE_HEIGHT} width={PAGE_WIDTH} />
              </Layer>
              <Layer listening={false} scaleX={scaleX} scaleY={scaleY}>
                {elements.map((element) => {
                  if (element.kind === "stroke") {
                    return (
                      <Line
                        globalCompositeOperation={element.mode === "erase" ? "destination-out" : "source-over"}
                        key={element.id}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                        points={element.points}
                        stroke={element.mode === "erase" ? "rgba(0,0,0,1)" : "#111827"}
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
                        fill="#2563eb"
                        fontFamily="Segoe Print, Comic Sans MS, cursive"
                        fontSize={element.fontSize}
                        key={element.id}
                        lineHeight={1.5}
                        listening={false}
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
                })}
              </Layer>
              <Layer listening={false} ref={selectionLayerRef} scaleX={scaleX} scaleY={scaleY}>
                {selection && (
                  <KonvaRect
                    dash={[10, 7]}
                    fill={selectedIds.length ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.05)"}
                    height={selection.height}
                    stroke="#2563eb"
                    strokeWidth={selectedIds.length ? 2.2 : 1.5}
                    width={selection.width}
                    x={selection.x}
                    y={selection.y}
                  />
                )}
                {selection &&
                  selectedIds.length > 0 &&
                  selectionHandles(selection).map((handle, index) => (
                    <KonvaRect
                      fill="#ffffff"
                      height={12}
                      key={index}
                      stroke="#2563eb"
                      strokeWidth={2}
                      width={12}
                      x={handle.x - 6}
                      y={handle.y - 6}
                    />
                  ))}
              </Layer>
            </Stage>
          )}
          {selection && selectedIds.length > 0 && (
            <div
              aria-label={text.selectionActions}
              className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-[#dfe3e8] bg-white p-1.5 shadow-lg"
              onPointerDown={(event) => event.stopPropagation()}
              style={{ left: selectionIslandLeft, top: selectionIslandTop }}
            >
              <button
                aria-label={text.ai1Aria}
                className="grid size-9 place-items-center rounded-lg text-[#2563eb] hover:bg-[#eff6ff] disabled:cursor-wait disabled:opacity-50"
                disabled={sidebarBusy}
                onClick={runSelectedSidebarAi}
                title={text.ai1Title}
                type="button"
              >
                <Sparkles aria-hidden="true" size={17} strokeWidth={2} />
              </button>
              <button
                aria-label={text.ai2Aria}
                className="grid size-9 place-items-center rounded-lg text-[#2563eb] hover:bg-[#eff6ff] disabled:cursor-wait disabled:opacity-50"
                disabled={canvasAiBusy}
                onClick={runSelectedCanvasAi}
                title={text.ai2Title}
                type="button"
              >
                <PenLine aria-hidden="true" size={17} strokeWidth={2} />
              </button>
              <button
                aria-label={text.copyAria}
                className={`grid size-9 place-items-center rounded-lg hover:bg-[#eef0f3] ${
                  clipboardReady ? "text-[#0f766e]" : "text-[#697386]"
                }`}
                onClick={copySelectedObjects}
                title={text.copy}
                type="button"
              >
                <Copy aria-hidden="true" size={17} strokeWidth={2} />
              </button>
              <button
                aria-label={text.duplicateAria}
                className="grid size-9 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3]"
                onClick={duplicateSelectedObjects}
                title={text.duplicate}
                type="button"
              >
                <CopyPlus aria-hidden="true" size={17} strokeWidth={2} />
              </button>
              <button
                aria-label={text.sendAria}
                className="grid size-9 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3] disabled:cursor-wait disabled:opacity-50"
                disabled={sending}
                onClick={sendSelectedToWindows}
                title={text.send}
                type="button"
              >
                <MonitorUp aria-hidden="true" size={17} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </section>

      {sidebarOpen && (
        <aside
          aria-label={text.ai}
          className="flex w-[320px] shrink-0 flex-col border-l border-[#dfe3e8] bg-white max-lg:w-[280px]"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#dfe3e8] px-4 text-[#697386]">
            <Sparkles aria-hidden="true" size={18} strokeWidth={2} />
            <button
              aria-label={text.closeAi}
              className="grid size-9 place-items-center rounded-lg hover:bg-[#eef0f3]"
              onClick={() => setSidebarOpen(false)}
              title={text.close}
              type="button"
            >
              <X aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {sidebarBusy && !sidebarText && (
              <div aria-label={text.processing} className="flex h-6 items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-[#2563eb]" />
                <span className="size-1.5 animate-pulse rounded-full bg-[#2563eb] [animation-delay:120ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-[#2563eb] [animation-delay:240ms]" />
              </div>
            )}
            {sidebarText && (
              <div className="whitespace-pre-wrap text-[15px] leading-7 text-[#111827]">{sidebarText}</div>
            )}
          </div>
        </aside>
      )}
    </main>
    {contextMenu && (
      <div
        className="fixed inset-0 z-40"
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu(null);
        }}
        onPointerDown={() => setContextMenu(null)}
      >
        <div
          aria-label={text.canvasActions}
          className="absolute w-[188px] rounded-xl border border-[#dfe3e8] bg-white p-1.5 shadow-xl"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#334155] hover:bg-[#eef0f3] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!clipboardReady}
            onClick={() => pasteClipboardAt(contextMenu.point)}
            role="menuitem"
            type="button"
          >
            <ClipboardPaste aria-hidden="true" size={18} strokeWidth={2} />
            {text.paste}
          </button>
        </div>
      </div>
    )}
    {settingsOpen && (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/35 p-5 backdrop-blur-[2px]"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}
      >
        <div
          aria-labelledby="settings-title"
          aria-modal="true"
          className="flex max-h-[calc(100dvh-40px)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-[#dfe3e8] bg-white shadow-2xl"
          role="dialog"
        >
          <div className="flex h-14 items-center justify-between border-b border-[#dfe3e8] px-5">
            <h2 className="text-base font-semibold text-[#111827]" id="settings-title">
              {text.settings}
            </h2>
            <button
              aria-label={text.closeSettings}
              className="grid size-9 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3]"
              onClick={() => setSettingsOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <div className="text-sm font-medium text-[#334155]">{text.theme}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                aria-pressed={appTheme === "light"}
                className={`flex h-12 items-center gap-3 rounded-xl border px-3 text-sm transition-colors ${
                  appTheme === "light"
                    ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                    : "border-[#dfe3e8] text-[#334155] hover:bg-[#f8fafc]"
                }`}
                onClick={() => onThemeChange("light")}
                type="button"
              >
                <Sun aria-hidden="true" size={18} strokeWidth={2} />
                {text.light}
              </button>
              <button
                aria-pressed={appTheme === "dark"}
                className={`flex h-12 items-center gap-3 rounded-xl border px-3 text-sm transition-colors ${
                  appTheme === "dark"
                    ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                    : "border-[#dfe3e8] text-[#334155] hover:bg-[#f8fafc]"
                }`}
                onClick={() => onThemeChange("dark")}
                type="button"
              >
                <Moon aria-hidden="true" size={18} strokeWidth={2} />
                {text.dark}
              </button>
            </div>

            <div className="my-5 h-px bg-[#e5e7eb]" />
            <div className="flex items-center gap-2 text-sm font-medium text-[#334155]">
              <Languages aria-hidden="true" size={17} strokeWidth={2} />
              {text.language}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  ["ru", "Русский"],
                  ["en", "English"],
                  ["zh", "中文"],
                ] as const
              ).map(([id, label]) => (
                <button
                  aria-pressed={language === id}
                  className={`h-11 rounded-xl border px-2 text-sm transition-colors ${
                    language === id
                      ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                      : "border-[#dfe3e8] text-[#334155] hover:bg-[#f8fafc]"
                  }`}
                  key={id}
                  onClick={() => onLanguageChange(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="my-5 h-px bg-[#e5e7eb]" />
            <button
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50"
              onClick={() => {
                setSettingsOpen(false);
                onLogout();
              }}
              type="button"
            >
              <LogOut aria-hidden="true" size={18} strokeWidth={2} />
              {text.logout}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
