"use client";

import {
  ArrowLeft,
  Brush,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Check,
  Copy,
  CopyPlus,
  Eraser,
  ImagePlus,
  MessageSquarePlus,
  MonitorUp,
  MousePointer2,
  PenLine,
  SendHorizontal,
  Sparkles,
  Spline,
  Scan,
  X,
} from "lucide-react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  PointerEvent as ReactPointerEvent,
  type RefObject,
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

import { API_URL, apiHeaders, type CanvasRecord, type CanvasPage } from "@/lib/canvas-api";
import { PdfPageBackground } from "@/components/pdf-page-background";
import { findSolutionSpace } from "@/lib/solution-placement";
import { CANVAS_AI_TEXT } from "@/lib/canvas-ai-text";
import { CanvasHandwriting, useCanvasHandwriting } from "./canvas-handwriting";
import type { HandwritingSnapshot } from "@/lib/canvas-handwriting";
import { createSolutionHistoryEntry, undoSolution, redoSolution, type SolutionHistoryEntry } from "@/lib/canvas-solution-history";
import { CanvasPet, type CanvasPetMood } from "./canvas-pet";
import companion from "./canvas-companion.module.css";
import { CanvasAiSettings } from "./canvas-ai-settings";
import { CanvasConversation } from "./canvas-conversation";
import { useCanvasZoom } from "./use-canvas-zoom";
import viewportStyles from "./canvas-viewport.module.css";

type Tool = "brush" | "eraser" | "select";
type EraserMode = "normal" | "object";
type AppLanguage = "ru" | "en" | "zh";
type Point = { x: number; y: number };
type SelectionRect = { x: number; y: number; width: number; height: number };
type StageSize = { width: number; height: number };
type ExportedImage = { dataUrl: string; width: number; height: number };
type SceneClipboard = { elements: SceneElement[]; bounds: SelectionRect };
type CanvasContextMenu = { x: number; y: number; point: Point };
type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image_data_url?: string | null;
};
type AiChat = { id: string; title: string; messages: AiChatMessage[] };
type SidebarResizeState = { startX: number; startWidth: number };
type StrokeElement = {
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
  height?: number;
  fill?: string;
  fontFamily?: string;
  lineHeight?: number;
  rotation?: number;
  source?: "latex";
  formulaInstanceId?: string;
  latexTemplateId?: string;
};
type ImageElement = {
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

type AiSolutionResponse = {
  status: "solution" | "clarification";
  explanation: string;
  steps: Array<{ latex: string; explanation: string; chart?: { bars: { label: string; value: number }[]; x_label: string; y_label: string } | null }>;
};
type CanvasSolution = {
  id: string;
  chatId: string;
  pages: CanvasPage[];
  pieces: Array<{ element: ImageElement; pageIndex: number; stepIndex: number }>;
  response: AiSolutionResponse;
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

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const MIN_SELECTION_SIZE = 3;
const STROKE_ERASER_RADIUS = 13;
const ERASER_LONG_PRESS_MS = 500;
const LARGE_OPERATOR_FONT = '"KaTeX_Size2", "Cambria Math", "STIX Two Math", serif';
const LARGE_OPERATOR_SYMBOLS = new Set(["∫", "∮", "∬", "∭", "∑", "∏"]);
const tools: Array<{ id: Tool; Icon: typeof Brush }> = [
  { id: "brush", Icon: Brush },
  { id: "eraser", Icon: Eraser },
  { id: "select", Icon: MousePointer2 },
];

function replaceStrokePoints(stroke: StrokeElement, points: number[], id = stroke.id): StrokeElement {
  const next = { ...stroke, id, points };
  delete next.samples;
  delete next.transform;
  delete next.maskData;
  delete next.renderBounds;
  delete next.randomSeed;
  return next;
}

const UI_TEXT = {
  ru: {
    brush: "Кисть",
    eraser: "Ластик",
    select: "Выделение",
    addPhoto: "Добавить фото (PNG, JPEG, JPG)",
    photoLoading: "Загрузка фото…",
    photoInvalid: "Выберите изображение PNG, JPEG или JPG.",
    photoTooLarge: "Размер фото не должен превышать 20 МБ.",
    photoFailed: "Не удалось открыть фото. Попробуйте другой файл.",
    elementBounds: "Границы элементов",
    normalMode: "обычный режим",
    objectMode: "объектный режим",
    eraserHint: "Ластик — удерживайте для выбора режима",
    normalEraser: "Обычный ластик",
    objectEraser: "Объектный ластик",
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
    openAi: "Открыть ИИ-сайдбар",
    closeAi: "Закрыть ИИ-сайдбар",
    close: "Закрыть",
    processing: "Обработка",
    aiRequestFailed: "Не удалось получить ответ Qwen. Повторите попытку.",
    chats: "Чаты",
    newChat: "Новый чат",
    emptyChat: "Выделите область и выберите ИИ 1, чтобы начать решение.",
    inputPlaceholder: "Напишите сообщение…",
    sendMessage: "Отправить сообщение",
    selectedArea: "Выделенная область",
    removeAttachment: "Убрать изображение",
    imagePrompt: "Реши математическую задачу",
    copyResponse: "Копировать ответ",
    goodResponse: "Хороший ответ",
    badResponse: "Плохой ответ",
    retryResponse: "Повторить ответ",
    moreActions: "Ещё действия",
    resizeSidebar: "Изменить ширину ИИ-сайдбара",
    canvasActions: "Действия с канвасом",
    backToCanvases: "К канвасам",
    saving: "Сохранение…",
    saved: "Сохранено",
    saveFailed: "Не сохранено",
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
    addPhoto: "Add photo (PNG, JPEG, JPG)",
    photoLoading: "Loading photo…",
    photoInvalid: "Choose a PNG, JPEG or JPG image.",
    photoTooLarge: "The photo must be no larger than 20 MB.",
    photoFailed: "Could not open the photo. Try another file.",
    elementBounds: "Element bounds",
    normalMode: "normal mode",
    objectMode: "object mode",
    eraserHint: "Eraser — press and hold to choose a mode",
    normalEraser: "Normal eraser",
    objectEraser: "Object eraser",
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
    openAi: "Open AI sidebar",
    closeAi: "Close AI sidebar",
    close: "Close",
    processing: "Processing",
    aiRequestFailed: "Could not get a response from Qwen. Please try again.",
    chats: "Chats",
    newChat: "New chat",
    emptyChat: "Select an area and choose AI 1 to start a solution.",
    inputPlaceholder: "Write a message…",
    sendMessage: "Send message",
    selectedArea: "Selected area",
    removeAttachment: "Remove image",
    imagePrompt: "Solve the math problem",
    copyResponse: "Copy response",
    goodResponse: "Good response",
    badResponse: "Bad response",
    retryResponse: "Retry response",
    moreActions: "More actions",
    resizeSidebar: "Resize AI sidebar",
    canvasActions: "Canvas actions",
    backToCanvases: "Back to canvases",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Not saved",
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
    addPhoto: "添加照片（PNG、JPEG、JPG）",
    photoLoading: "正在加载照片…",
    photoInvalid: "请选择 PNG、JPEG 或 JPG 图片。",
    photoTooLarge: "照片大小不能超过 20 MB。",
    photoFailed: "无法打开照片，请尝试其他文件。",
    elementBounds: "元素边界",
    normalMode: "普通模式",
    objectMode: "对象模式",
    eraserHint: "长按橡皮擦以选择模式",
    normalEraser: "普通橡皮擦",
    objectEraser: "对象橡皮擦",
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
    openAi: "打开 AI 侧边栏",
    closeAi: "关闭 AI 侧边栏",
    close: "关闭",
    processing: "处理中",
    aiRequestFailed: "无法获取 Qwen 的回复，请重试。",
    chats: "聊天",
    newChat: "新建聊天",
    emptyChat: "选择一个区域，然后点击 AI 1 开始解答。",
    inputPlaceholder: "输入消息…",
    sendMessage: "发送消息",
    selectedArea: "所选区域",
    removeAttachment: "移除图片",
    imagePrompt: "解答这道数学题",
    copyResponse: "复制回答",
    goodResponse: "好的回答",
    badResponse: "不好的回答",
    retryResponse: "重新生成回答",
    moreActions: "更多操作",
    resizeSidebar: "调整 AI 侧边栏宽度",
    canvasActions: "画布操作",
    backToCanvases: "返回画布列表",
    saving: "正在保存…",
    saved: "已保存",
    saveFailed: "未保存",
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

function mathFontFamily(text: string, fallback: string): string {
  return LARGE_OPERATOR_SYMBOLS.has(text) ? LARGE_OPERATOR_FONT : fallback;
}

function normalizeRect(start: Point, end: Point): SelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
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

function polylineLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function splitStrokeByEraser(stroke: StrokeElement, eraserStart: Point, eraserEnd: Point): StrokeElement[] {
  if (stroke.points.length < 4) return [];
  const sourcePoints: Point[] = [];
  for (let index = 0; index <= stroke.points.length - 2; index += 2) {
    sourcePoints.push({ x: stroke.points[index], y: stroke.points[index + 1] });
  }

  const sampleSpacing = 2;
  const samples: Point[] = [];
  for (let index = 0; index < sourcePoints.length - 1; index += 1) {
    const start = sourcePoints[index];
    const end = sourcePoints[index + 1];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(segmentLength / sampleSpacing));
    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      const progress = step / steps;
      samples.push({
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      });
    }
  }

  const radius = STROKE_ERASER_RADIUS + stroke.strokeWidth / 2;
  const erased = samples.map((point) => distanceToSegment(point, eraserStart, eraserEnd) <= radius);
  if (!erased.some(Boolean)) return [stroke];

  const fragments: Point[][] = [];
  let fragment: Point[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    if (!erased[index]) {
      fragment.push(samples[index]);
      continue;
    }
    if (fragment.length) fragments.push(fragment);
    fragment = [];
  }
  if (fragment.length) fragments.push(fragment);

  const minimumLength = Math.max(1, stroke.strokeWidth * 0.5);
  return fragments
    .filter((points) => points.length >= 2 && polylineLength(points) >= minimumLength)
    .map((points, index) =>
      replaceStrokePoints(
        stroke,
        points.flatMap((point) => [point.x, point.y]),
        index === 0 ? stroke.id : createId(),
      ),
    );
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
    if (element.height !== undefined) {
      return { x: element.x, y: element.y, width: element.width, height: element.height };
    }
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
    return replaceStrokePoints(
      element,
      element.points.map((coordinate, index) => coordinate + (index % 2 === 0 ? dx : dy)),
    );
  }
  return { ...element, x: element.x + dx, y: element.y + dy };
}

function snapshotSceneElement(element: SceneElement): SceneElement {
  return element.kind === "stroke" ? { ...element, points: [...element.points] } : { ...element };
}

function cloneSceneElement(element: SceneElement, dx: number, dy: number): SceneElement {
  if (element.kind === "stroke") {
    return replaceStrokePoints(
      element,
      element.points.map((coordinate, index) => coordinate + (index % 2 === 0 ? dx : dy)),
      createId(),
    );
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

function ElementBoundsOverlay({ sceneLayerRef }: { sceneLayerRef: RefObject<Konva.Layer | null> }) {
  const [bounds, setBounds] = useState<SelectionRect[]>([]);

  useLayoutEffect(() => {
    const layer = sceneLayerRef.current;
    if (!layer) return;
    const updateBounds = () => {
      const next = layer.getChildren().map((node) => node.getClientRect({ relativeTo: layer }));
      setBounds((previous) =>
        previous.length === next.length &&
        previous.every((rect, index) =>
          rect.x === next[index].x &&
          rect.y === next[index].y &&
          rect.width === next[index].width &&
          rect.height === next[index].height,
        )
          ? previous
          : next,
      );
    };
    updateBounds();
    // Follow actual rendering, including images that finish loading after the elements change.
    layer.on("draw.elementBounds", updateBounds);
    return () => {
      layer.off("draw.elementBounds", updateBounds);
    };
  }, [sceneLayerRef]);

  return (
    <Group listening={false} name="element-bounds">
      {bounds.map((rect, index) => (
        <KonvaRect
          {...rect}
          key={index}
          listening={false}
          stroke="rgba(37, 99, 235, 0.45)"
          strokeScaleEnabled={false}
          strokeWidth={1}
        />
      ))}
    </Group>
  );
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
  canvas,
  language,
  onBack,
  onLogout,
  token,
}: {
  canvas: CanvasRecord;
  language: AppLanguage;
  onBack: () => void;
  onLogout: () => void;
  token: string;
}) {
  const workspaceRef = useRef<HTMLElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoRequestRef = useRef(0);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<"photoInvalid" | "photoTooLarge" | "photoFailed" | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const selectionLayerRef = useRef<Konva.Layer | null>(null);
  const sceneLayerRef = useRef<Konva.Layer | null>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<Point | null>(null);
  const draggingSelectionRef = useRef(false);
  const lastDragPointRef = useRef<Point | null>(null);
  const lastEraserPointRef = useRef<Point | null>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const sceneClipboardRef = useRef<SceneClipboard | null>(null);
  const selectionRef = useRef<SelectionRect | null>(null);
  const sidebarRequestRef = useRef<AbortController | null>(null);
  const aiAnimationRef = useRef<number | null>(null);
  const sidebarResizeRef = useRef<SidebarResizeState | null>(null);
  const canvasSaveTimerRef = useRef<number | null>(null);
  const canvasPagesRef = useRef(canvas.content.pages);
  const activePageIndexRef = useRef(0);
  const initialPage = canvas.content.pages[0];
  const elementsRef = useRef<SceneElement[]>(initialPage.elements as SceneElement[]);
  const savedSnapshotRef = useRef(JSON.stringify(canvas.content.pages));
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const eraserPressTimerRef = useRef<number | null>(null);
  const eraserLongPressTriggeredRef = useRef(false);
  const [fitSize, setFitSize] = useState<StageSize>({ width: 0, height: 0 });
  const { stageSize, viewportRef, zoom } = useCanvasZoom(fitSize, () => drawingRef.current || draggingSelectionRef.current);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [elements, setElements] = useState<SceneElement[]>(
    () => initialPage.elements as SceneElement[],
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [tool, setTool] = useState<Tool>("brush");
  const [showElementBounds, setShowElementBounds] = useState(false);
  const [eraserMode, setEraserMode] = useState<EraserMode>("normal");
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboardReady, setClipboardReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [aiChats, setAiChats] = useState<AiChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState("");
  const [pendingAiImage, setPendingAiImage] = useState<ExportedImage | null>(null);
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const [solution, setSolution] = useState<CanvasSolution | null>(null);
  const handwriting = useCanvasHandwriting(token, canvas.id);
  const [solutionHistory, setSolutionHistory] = useState<SolutionHistoryEntry | null>(null);
  const [draftPageIndex, setDraftPageIndex] = useState(0);
  const [inkProgress, setInkProgress] = useState({ step: 0, progress: 0 });
  const [aiError, setAiError] = useState<string | null>(null);
  const aiSubmitRef = useRef(false);
  const taskContextRef = useRef(new Map<string, { pageId: string; bounds?: SelectionRect }>());
  const pendingTaskRef = useRef<{ pageId: string; bounds: SelectionRect } | null>(null);
  const canvasAiBusy = sidebarBusy || Boolean(solution);
  const text = { ...UI_TEXT[language], ...CANVAS_AI_TEXT[language] };
  const activeChat = aiChats.find((chat) => chat.id === activeChatId) ?? null;
  const petMood: CanvasPetMood = sidebarBusy ? (aiAnimationRef.current !== null ? "writing" : "thinking") : solution ? "ready" : "idle";
  const visiblePageIndex = solution ? draftPageIndex : activePageIndex;
  const visiblePages = solution?.pages ?? canvasPagesRef.current;
  const visibleElements = solution ? solution.pages[draftPageIndex].elements as SceneElement[] : elements;

  useEffect(() => () => { photoRequestRef.current += 1; }, []);

  const addPhoto = async (file: File) => {
    const request = ++photoRequestRef.current;
    const pageIndex = activePageIndexRef.current;
    setPhotoError(null);
    if (file.size > 20 * 1024 * 1024) {
      setPhotoError("photoTooLarge");
      return;
    }
    setPhotoLoading(true);
    try {
      const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
      const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
      if (!isPng && !isJpeg) {
        if (request === photoRequestRef.current) setPhotoError("photoInvalid");
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.onabort = () => reject(new Error("photo-read-aborted"));
        reader.readAsDataURL(new Blob([file], { type: isPng ? "image/png" : "image/jpeg" }));
      });
      const photo = new window.Image();
      photo.src = dataUrl;
      await photo.decode();
      if (!photo.naturalWidth || !photo.naturalHeight) throw new Error("empty-photo");
      if (request !== photoRequestRef.current || pageIndex !== activePageIndexRef.current) return;
      const scale = Math.min(1, (PAGE_WIDTH - 80) / photo.naturalWidth, (PAGE_HEIGHT - 80) / photo.naturalHeight);
      const width = photo.naturalWidth * scale;
      const height = photo.naturalHeight * scale;
      const bounds = { x: (PAGE_WIDTH - width) / 2, y: (PAGE_HEIGHT - height) / 2, width, height };
      const element: ImageElement = { id: createId(), kind: "image", ...bounds, dataUrl };
      setElements((current) => [...current, element]);
      setTool("select");
      setSelectedIds([element.id]);
      selectionRef.current = bounds;
      setSelection(bounds);
      setEraserMenuOpen(false);
      setContextMenu(null);
    } catch {
      if (request === photoRequestRef.current) setPhotoError("photoFailed");
    } finally {
      if (request === photoRequestRef.current) setPhotoLoading(false);
    }
  };

  const queueCanvasSave = useCallback((): Promise<boolean> => {
    const snapshotElements = elementsRef.current;
    const snapshotPages = canvasPagesRef.current.map((page, index) =>
      index === activePageIndexRef.current
        ? {
            ...page,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            elements: snapshotElements,
            appleDrawingData: page.elements === snapshotElements ? page.appleDrawingData : undefined,
          }
        : page,
    );
    canvasPagesRef.current = snapshotPages;
    const serialized = JSON.stringify(snapshotPages);
    const save = async (): Promise<boolean> => {
      if (serialized === savedSnapshotRef.current) {
        if (JSON.stringify(canvasPagesRef.current) === serialized) setSaveState("saved");
        return true;
      }
      setSaveState("saving");
      try {
        const response = await fetch(`${API_URL}/api/canvases/${canvas.id}`, {
          method: "PATCH",
          headers: apiHeaders(token, true),
          body: JSON.stringify({
            content: {
              schemaVersion: 2,
              pdfData: canvas.content.pdfData,
              pages: snapshotPages,
            },
          }),
        });
        if (response.status === 401 || response.status === 403) {
          onLogout();
          return false;
        }
        if (!response.ok) throw new Error("canvas-save-failed");
        savedSnapshotRef.current = serialized;
        setSaveState(JSON.stringify(canvasPagesRef.current) === serialized ? "saved" : "saving");
        return true;
      } catch {
        setSaveState("error");
        return false;
      }
    };

    const queued = saveQueueRef.current.catch(() => false).then(save);
    saveQueueRef.current = queued;
    return queued;
  }, [canvas.id, canvas.content.pdfData, onLogout, token]);

  useEffect(() => {
    elementsRef.current = elements;
    canvasPagesRef.current = canvasPagesRef.current.map((page, index) =>
      index === activePageIndexRef.current ? { ...page, elements,
        appleDrawingData: page.elements === elements ? page.appleDrawingData : undefined } : page,
    );
    const serialized = JSON.stringify(canvasPagesRef.current);
    if (serialized === savedSnapshotRef.current) return;
    setSaveState("saving");
    if (canvasSaveTimerRef.current !== null) {
      window.clearTimeout(canvasSaveTimerRef.current);
    }
    canvasSaveTimerRef.current = window.setTimeout(() => {
      canvasSaveTimerRef.current = null;
      void queueCanvasSave();
    }, 700);
    return () => {
      if (canvasSaveTimerRef.current !== null) {
        window.clearTimeout(canvasSaveTimerRef.current);
        canvasSaveTimerRef.current = null;
      }
    };
  }, [elements, queueCanvasSave]);

  useEffect(() => {
    const saveWhenHidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (canvasSaveTimerRef.current !== null) {
        window.clearTimeout(canvasSaveTimerRef.current);
        canvasSaveTimerRef.current = null;
      }
      void queueCanvasSave();
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!solution && !sidebarBusy && JSON.stringify(canvasPagesRef.current) === savedSnapshotRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [queueCanvasSave, sidebarBusy, solution]);

  const returnToCanvases = useCallback(async () => {
    if (photoLoading || canvasAiBusy) return;
    if (canvasSaveTimerRef.current !== null) {
      window.clearTimeout(canvasSaveTimerRef.current);
      canvasSaveTimerRef.current = null;
    }
    if (await queueCanvasSave()) onBack();
  }, [canvasAiBusy, onBack, photoLoading, queueCanvasSave]);

  const openPage = useCallback(
    async (nextIndex: number) => {
      if (solution) {
        if (nextIndex >= 0 && nextIndex < solution.pages.length) setDraftPageIndex(nextIndex);
        return;
      }
      if (sidebarBusy) return;
      if (photoLoading) return;
      if (nextIndex < 0 || nextIndex >= canvasPagesRef.current.length) return;
      if (canvasSaveTimerRef.current !== null) {
        window.clearTimeout(canvasSaveTimerRef.current);
        canvasSaveTimerRef.current = null;
      }
      if (!(await queueCanvasSave())) return;
      const nextPage = canvasPagesRef.current[nextIndex];
      activePageIndexRef.current = nextIndex;
      elementsRef.current = nextPage.elements as SceneElement[];
      setElements(nextPage.elements as SceneElement[]);
      setActivePageIndex(nextIndex);
      setSelectedIds([]);
      selectionRef.current = null;
      setSelection(null);
    },
    [photoLoading, queueCanvasSave, sidebarBusy, solution],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      document.fonts.load('44px "KaTeX_Size2"', "∫"),
      document.fonts.ready,
    ]).then(() => {
      if (cancelled) return;
      stageRef.current?.batchDraw();
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        setFitSize({
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
    const controller = new AbortController();
    fetch(`${API_URL}/api/ai/chats`, {
      headers: apiHeaders(token),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          onLogout();
          return null;
        }
        if (!response.ok) throw new Error("chat-history-request-failed");
        return (await response.json()) as AiChat[];
      })
      .then((chats) => {
        if (!chats?.length) return;
        setAiChats((current) => {
          const currentIds = new Set(current.map((chat) => chat.id));
          return [...chats.filter((chat) => !currentIds.has(chat.id)), ...current];
        });
        setActiveChatId((current) => current ?? chats[0].id);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [onLogout, token]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEraserMenuOpen(false);
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const resize = sidebarResizeRef.current;
      if (!resize) return;
      const nextWidth = Math.max(320, Math.min(720, resize.startWidth + resize.startX - event.clientX));
      setSidebarWidth(nextWidth);
    };
    const finishResize = () => {
      sidebarResizeRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishResize);
    };
  }, []);

  useEffect(
    () => () => {
      sidebarRequestRef.current?.abort();
      if (aiAnimationRef.current !== null) window.cancelAnimationFrame(aiAnimationRef.current);
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

  const eraseStrokesAlong = useCallback((start: Point, end: Point) => {
    setElements((current) =>
      current.flatMap((element): SceneElement[] =>
        element.kind === "stroke" ? splitStrokeByEraser(element, start, end) : [element],
      ),
    );
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
          headers: apiHeaders(token),
          body: data,
        });
        if (response.status === 401 || response.status === 403) onLogout();
      } finally {
        setSending(false);
        setSelection(null);
      }
    },
    [exportSelection, onLogout, scaleX, scaleY, token],
  );

  const persistChatMessage = useCallback(
    async (
      chatId: string,
      role: AiChatMessage["role"],
      content: string,
      imageDataUrl?: string,
    ): Promise<AiChatMessage | null> => {
      try {
        const response = await fetch(`${API_URL}/api/ai/chats/${chatId}/messages`, {
          method: "POST",
          headers: apiHeaders(token, true),
          body: JSON.stringify({ role, content, image_data_url: imageDataUrl ?? null }),
        });
        if (response.status === 401 || response.status === 403) {
          onLogout();
          return null;
        }
        if (!response.ok) return null;
        return (await response.json()) as AiChatMessage;
      } catch {
        return null;
      }
    },
    [onLogout, token],
  );

  const createNewChat = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(`${API_URL}/api/ai/chats`, {
        method: "POST",
        headers: apiHeaders(token, true),
        body: JSON.stringify({ title: `${text.newChat} ${aiChats.length + 1}` }),
      });
      if (response.status === 401 || response.status === 403) {
        onLogout();
        return null;
      }
      if (!response.ok) return null;
      const chat = (await response.json()) as AiChat;
      setAiChats((current) => [...current, chat]);
      setActiveChatId(chat.id);
      setAiDraft("");
      setPendingAiImage(null);
      setSidebarOpen(true);
      return chat.id;
    } catch {
      return null;
    }
  }, [aiChats.length, onLogout, text.newChat, token]);

  const ensureChatWithUserMessage = useCallback(
    async (content: string, imageDataUrl?: string): Promise<string | null> => {
      const currentChatExists = activeChatId !== null && aiChats.some((chat) => chat.id === activeChatId);
      const chatId = currentChatExists && activeChatId ? activeChatId : await createNewChat();
      if (!chatId) return null;
      const message = await persistChatMessage(chatId, "user", content, imageDataUrl);
      if (!message) return null;
      setAiChats((current) =>
        current.map((chat) =>
          chat.id === chatId ? { ...chat, messages: [...chat.messages, message] } : chat,
        ),
      );
      return chatId;
    },
    [activeChatId, aiChats, createNewChat, persistChatMessage],
  );

  const beginSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
  };

  const appendAiMessage = (chatId: string, content: string) => {
    setAiChats((current) => current.map((chat) => chat.id === chatId
      ? { ...chat, messages: [...chat.messages, { id: createId(), role: "assistant", content }] } : chat));
    void persistChatMessage(chatId, "assistant", content);
  };

  const stopCanvasAi = () => {
    sidebarRequestRef.current?.abort();
    sidebarRequestRef.current = null;
    if (aiAnimationRef.current !== null) window.cancelAnimationFrame(aiAnimationRef.current);
    aiAnimationRef.current = null;
    aiSubmitRef.current = false;
    setSidebarBusy(false);
    setLoadingChatId(null);
    if (solution) {
      appendAiMessage(solution.chatId, text.discarded);
      setSolution(null);
    }
  };

  const acceptCanvasSolution = async () => {
    if (!solution || sidebarBusy || aiSubmitRef.current) return;
    aiSubmitRef.current = true;
    const accepted = solution;
    const pages = accepted.pages.map((page, index) => ({
      ...page,
      elements: [...page.elements, ...accepted.pieces.filter((piece) => piece.pageIndex === index).map((piece) => piece.element)],
      appleDrawingData: accepted.pieces.some((piece) => piece.pageIndex === index) ? undefined : page.appleDrawingData,
    }));
    setSolutionHistory(createSolutionHistoryEntry(canvasPagesRef.current, pages, accepted.id));
    canvasPagesRef.current = pages;
    activePageIndexRef.current = draftPageIndex;
    elementsRef.current = pages[draftPageIndex].elements as SceneElement[];
    setActivePageIndex(draftPageIndex);
    setElements(elementsRef.current);
    setSolution(null);
    setSelectedIds([]);
    selectionRef.current = null;
    setSelection(null);
    setAiError(null);
    if (await queueCanvasSave()) appendAiMessage(accepted.chatId, text.accepted);
    else setAiError(text.acceptedSaveFailed);
    aiSubmitRef.current = false;
  };

  const changeSolutionHistory = async (direction: "undo" | "redo") => {
    if (!solutionHistory || canvasAiBusy || aiSubmitRef.current || photoLoading) return;
    aiSubmitRef.current = true;
    setAiError(null);
    const current = canvasPagesRef.current.map((page, index) => index === activePageIndexRef.current ? { ...page, elements: elementsRef.current } : page);
    const pageId = current[activePageIndexRef.current]?.id;
    const result = direction === "undo" ? undoSolution(current, solutionHistory) : redoSolution(current, solutionHistory);
    const index = Math.max(0, result.pages.findIndex(page => page.id === pageId));
    setSolutionHistory(result.entry);
    canvasPagesRef.current = result.pages;
    activePageIndexRef.current = index;
    elementsRef.current = result.pages[index].elements as SceneElement[];
    setActivePageIndex(index);
    setElements(elementsRef.current);
    setSelectedIds([]); setSelection(null); selectionRef.current = null;
    if (!await queueCanvasSave()) setAiError(text.acceptedSaveFailed);
    aiSubmitRef.current = false;
  };

  const runCanvasSolution = async (chatId: string, prompt: string, selectionImage: ExportedImage | null, controller: AbortController) => {
    sidebarRequestRef.current = controller;
    setSidebarOpen(true);
    setSidebarBusy(true);
    setLoadingChatId(chatId);
    setAiError(null);
    let preparingFormulas = false;
    try {
      const handwritingDataset = await handwriting.loadForSolution(controller.signal);
      if (controller.signal.aborted) return;
      const data = new FormData();
      if (selectionImage) {
        const image = await fetch(selectionImage.dataUrl).then((response) => response.blob());
        data.append("image", image, "selection.png");
      }
      data.append("language", language);
      data.append("prompt", prompt);
      data.append("chat_id", chatId);
      if (solution?.chatId === chatId) data.append("previous_solution", JSON.stringify(solution.response));
      const response = await fetch(`${API_URL}/api/ai/canvas`, {
        method: "POST", headers: apiHeaders(token), body: data, signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) { onLogout(); return; }
      if (!response.ok) throw new Error("solution-request-failed");
      const payload = await response.json() as AiSolutionResponse;
      if (controller.signal.aborted) return;
      if (payload.status === "clarification") {
        appendAiMessage(chatId, payload.explanation);
        return;
      }
      preparingFormulas = true;
      const { renderBarChart } = await import("@/lib/latex-image");
      const { renderCanvasHandwriting } = await import("@/lib/canvas-handwriting-renderer");
      const context = taskContextRef.current.get(chatId);
      const pages: CanvasPage[] = canvasPagesRef.current.map((page, index) => ({
        ...page, elements: index === activePageIndexRef.current ? [...elementsRef.current] : [...page.elements],
      }));
      let pageIndex = Math.max(0, pages.findIndex((page) => page.id === context?.pageId));
      let anchor = context?.bounds;
      const id = createId();
      const pieces: CanvasSolution["pieces"] = [];
      for (let stepIndex = 0; stepIndex < payload.steps.length; stepIndex++) {
        if (controller.signal.aborted) return;
        const step = payload.steps[stepIndex];
        const images = step.latex.trim() ? [{ ...await renderCanvasHandwriting(step.latex, handwritingDataset), source: "latex" as const, latex: step.latex }] : [];
        const blocks: Array<ExportedImage & { source: "latex" | "ai-chart"; latex?: string; handwriting?: HandwritingSnapshot }> = [...images];
        if (step.chart) blocks.push({ ...renderBarChart(step.chart), source: "ai-chart" });
        for (const block of blocks) {
          const occupied = (pages[pageIndex].elements as SceneElement[]).map(sceneElementBounds)
            .filter((rect): rect is SelectionRect => rect !== null);
          occupied.push(...pieces.filter((piece) => piece.pageIndex === pageIndex).map((piece) => piece.element));
          let bounds = findSolutionSpace(block.width, block.height, occupied, anchor);
          if (pieces.length && anchor && bounds && bounds.y < anchor.y + anchor.height) bounds = null;
          if (!bounds) {
            if (pages.length >= 1000) throw new Error("page-limit");
            // New draft sheets are inserted immediately after the task/preceding solution sheet.
            pageIndex += 1;
            pages.splice(pageIndex, 0, { id: createId(), width: PAGE_WIDTH, height: PAGE_HEIGHT,
              pageTemplate: pages[pageIndex - 1].pageTemplate, elements: [] });
            for (const piece of pieces) if (piece.pageIndex >= pageIndex) piece.pageIndex += 1;
            bounds = findSolutionSpace(block.width, block.height, []);
          }
          if (!bounds) throw new Error("formula-does-not-fit");
          const element: ImageElement = { id: createId(), kind: "image", ...block, ...bounds,
            formulaInstanceId: createId(), solutionId: id };
          pieces.push({ element, pageIndex, stepIndex });
          anchor = bounds;
        }
      }
      if (controller.signal.aborted) return;
      const prepared = { id, chatId, pages, pieces, response: payload };
      setSolution(prepared);
      setSelectedIds([]);
      setSelection(null);
      selectionRef.current = null;
      setDraftPageIndex(pieces[0].pageIndex);
      setInkProgress({ step: 0, progress: 0 });
      const messageId = createId();
      setAiChats((current) => current.map((chat) => chat.id === chatId
        ? { ...chat, messages: [...chat.messages, { id: messageId, role: "assistant", content: payload.explanation }] } : chat));
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = reducedMotion ? 1 : 1500;
      const started = performance.now();
      let lastStep = -1;
      const animate = (now: number) => {
        if (controller.signal.aborted) return;
        // A frame timestamp can precede performance.now() recorded earlier in that frame.
        const elapsed = Math.max(0, now - started);
        const step = Math.min(pieces.length - 1, Math.floor(elapsed / duration));
        const progress = Math.min(1, (elapsed - step * duration) / (duration * 0.82));
        setInkProgress({ step, progress });
        if (step !== lastStep) {
          lastStep = step;
          setDraftPageIndex(pieces[step].pageIndex);
          const content = [payload.explanation, ...payload.steps.slice(0, pieces[step].stepIndex + 1).map((item, index) => `${index + 1}. ${item.explanation}`)].join("\n\n");
          setAiChats((current) => current.map((chat) => chat.id === chatId ? {
            ...chat, messages: chat.messages.map((message) => message.id === messageId ? { ...message, content } : message),
          } : chat));
        }
        if (elapsed >= duration * pieces.length) {
          aiAnimationRef.current = null;
          setInkProgress({ step: pieces.length, progress: 1 });
          setSidebarBusy(false);
          setLoadingChatId(null);
          sidebarRequestRef.current = null;
          aiSubmitRef.current = false;
          void persistChatMessage(chatId, "assistant", [payload.explanation,
            ...payload.steps.map((item, index) => `${index + 1}. ${item.explanation}`)].join("\n\n"));
          return;
        }
        aiAnimationRef.current = window.requestAnimationFrame(animate);
      };
      aiAnimationRef.current = window.requestAnimationFrame(animate);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[canvas-ai] Could not prepare the solution", error);
        setAiError(preparingFormulas
          ? error instanceof Error && ["formula-too-large", "formula-does-not-fit"].includes(error.message)
            ? text.formulaTooLarge : text.formulaFailed
          : text.aiRequestFailed);
      }
    } finally {
      if (sidebarRequestRef.current === controller && aiAnimationRef.current === null) {
        sidebarRequestRef.current = null;
        setSidebarBusy(false);
        setLoadingChatId(null);
        aiSubmitRef.current = false;
      }
    }
  };

  const submitAiDraft = async (prompt = aiDraft.trim(), selectionImage = pendingAiImage) => {
    if (!prompt || sidebarBusy || aiSubmitRef.current || photoLoading) return;
    aiSubmitRef.current = true;
    const controller = new AbortController();
    sidebarRequestRef.current = controller;
    setSidebarBusy(true);
    setSidebarOpen(true);
    setAiError(null);
    const taskContext = pendingTaskRef.current;
    const chatId = await ensureChatWithUserMessage(prompt, selectionImage?.dataUrl);
    if (controller.signal.aborted) return;
    if (!chatId) {
      aiSubmitRef.current = false;
      sidebarRequestRef.current = null;
      setSidebarBusy(false);
      setAiError(text.chatFailed);
      return;
    }
    if (taskContext) taskContextRef.current.set(chatId, taskContext);
    else if (!taskContextRef.current.has(chatId)) taskContextRef.current.set(chatId, { pageId: canvasPagesRef.current[activePageIndexRef.current].id });
    pendingTaskRef.current = null;
    setAiDraft("");
    setPendingAiImage(null);
    await runCanvasSolution(chatId, prompt, selectionImage, controller);
  };

  const activateTool = useCallback((nextTool: Tool) => {
    setTool(nextTool);
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
    if (canvasAiBusy) return;
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
  }, [canvasAiBusy]);

  const prepareSelectedTask = (solveImmediately: boolean) => {
    if (!selection || !selectedIds.length || canvasAiBusy || photoLoading) return;
    const selectionImage = exportSelection(selection);
    if (!selectionImage) return;
    pendingTaskRef.current = { pageId: canvasPagesRef.current[activePageIndexRef.current].id, bounds: selection };
    setSidebarOpen(true);
    setAiDraft(text.imagePrompt);
    setPendingAiImage(selectionImage);
    setSelectedIds([]);
    selectionRef.current = null;
    setSelection(null);
    if (solveImmediately) void submitAiDraft(text.imagePrompt, selectionImage);
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

    if (tool === "brush") {
      const id = createId();
      activeStrokeIdRef.current = id;
      setSelection(null);
      setElements((current) => [
        ...current,
        {
          id,
          kind: "stroke",
          mode: "draw",
          points: [point.x, point.y, point.x + 0.01, point.y + 0.01],
          strokeWidth: 4.5,
        },
      ]);
    } else if (tool === "eraser" && eraserMode === "normal") {
      setSelection(null);
      lastEraserPointRef.current = point;
      eraseStrokesAlong(point, point);
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

    if (tool === "brush") {
      const id = activeStrokeIdRef.current;
      if (!id) return;
      setElements((current) =>
        current.map((element) =>
          element.id === id && element.kind === "stroke"
            ? { ...element, points: [...element.points, point.x, point.y] }
            : element,
        ),
      );
    } else if (tool === "eraser" && eraserMode === "normal") {
      const previous = lastEraserPointRef.current ?? point;
      eraseStrokesAlong(previous, point);
      lastEraserPointRef.current = point;
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
    lastEraserPointRef.current = null;
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
      if (canvasAiBusy || (event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName)))) return;
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
  }, [canvasAiBusy, copySelectedObjects, pasteClipboardAt, selectedIds.length, tool]);

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
        <div className="absolute left-4 top-4 z-10 flex max-w-[260px] items-center gap-2">
          <button
            aria-label={text.backToCanvases}
            disabled={photoLoading || canvasAiBusy}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#dfe3e8] bg-white text-[#697386] shadow-sm hover:bg-[#eef0f3]"
            onClick={() => void returnToCanvases()}
            title={canvasAiBusy ? text.reviewBeforeLeaving : text.backToCanvases}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={19} strokeWidth={2} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#111827]">{canvas.title}</div>
            <div className={`text-xs ${saveState === "error" ? "text-red-500" : "text-[#697386]"}`}>
              {saveState === "saving"
                ? text.saving
                : saveState === "error"
                  ? text.saveFailed
                  : text.saved}
            </div>
            {visiblePages.length > 1 && (
              <div className="mt-1 flex items-center gap-1 text-xs text-[#697386]">
                <button
                  aria-label="Previous page"
                  className="grid size-5 place-items-center rounded hover:bg-[#eef0f3] disabled:opacity-30"
                  disabled={photoLoading || visiblePageIndex === 0 || (!solution && (sidebarBusy || saveState === "saving"))}
                  onClick={() => void openPage(visiblePageIndex - 1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={14} />
                </button>
                <span>{visiblePageIndex + 1} / {visiblePages.length}</span>
                <button
                  aria-label="Next page"
                  className="grid size-5 place-items-center rounded hover:bg-[#eef0f3] disabled:opacity-30"
                  disabled={photoLoading || visiblePageIndex >= visiblePages.length - 1 || (!solution && (sidebarBusy || saveState === "saving"))}
                  onClick={() => void openPage(visiblePageIndex + 1)}
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
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

          <button
            aria-label={text.elementBounds}
            aria-pressed={showElementBounds}
            className={`grid size-10 place-items-center rounded-lg transition-colors ${
              showElementBounds ? "bg-[#eff6ff] text-[#2563eb]" : "text-[#697386] hover:bg-[#eef0f3]"
            }`}
            onClick={() => setShowElementBounds((visible) => !visible)}
            title={text.elementBounds}
            type="button"
          >
            <Scan aria-hidden="true" size={19} strokeWidth={2} />
          </button>

          <input
            accept=".png,.jpeg,.jpg,image/png,image/jpeg"
            aria-label={text.addPhoto}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void addPhoto(file);
            }}
            ref={photoInputRef}
            type="file"
          />
          <button
            aria-label={photoLoading ? text.photoLoading : text.addPhoto}
            aria-busy={photoLoading}
            className="grid size-10 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3] disabled:opacity-45"
            disabled={photoLoading || canvasAiBusy}
            onClick={() => photoInputRef.current?.click()}
            title={photoLoading ? text.photoLoading : text.addPhoto}
            type="button"
          >
            <ImagePlus aria-hidden="true" size={19} strokeWidth={2} />
          </button>
        </div>

        {photoError && (
          <div className="absolute left-1/2 top-[72px] z-20 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-600 shadow-sm" role="alert">
            {text[photoError]}
            <button aria-label={text.close} className="shrink-0" onClick={() => setPhotoError(null)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        )}

        {!sidebarOpen && (
          <button
            aria-label={text.openAi}
            className={companion.launcher}
            onClick={() => setSidebarOpen(true)}
            title={text.openAi}
            type="button"
          >
            <CanvasPet mood={petMood} />
            <span>{text.petName}</span>
          </button>
        )}

        <div ref={viewportRef} className={viewportStyles.viewport} data-canvas-zoom={zoom}>
        <div className="relative flex min-h-full min-w-full justify-center pb-4" style={{ width: stageSize.width + 48, height: stageSize.height + 16 }}>
        <div
          aria-label="A4 canvas"
          className="keep-white relative flex-none overflow-hidden rounded-[3px] bg-white shadow-[0_4px_24px_rgba(17,24,39,0.08)] ring-1 ring-[#dfe3e8]"
          style={{ height: stageSize.height, width: stageSize.width }}
        >
          {solution && (
            <div className="pointer-events-none absolute bottom-2 right-3 z-10 rounded-md bg-[#eff6ff] px-2 py-1 text-xs text-[#2563eb]">
              {text.draftPage} {draftPageIndex + 1}
            </div>
          )}
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
                <PdfPageBackground source={canvas.content.pdfData} pageIndex={visiblePages[visiblePageIndex]?.pdfPageIndex}
                  width={PAGE_WIDTH} height={PAGE_HEIGHT} />
              </Layer>
              <Layer listening={false} ref={sceneLayerRef} scaleX={scaleX} scaleY={scaleY}>
                {visibleElements.map((element) => {
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
                })}
              </Layer>
              {solution && (
                <Layer listening={false} scaleX={scaleX} scaleY={scaleY}>
                  {solution.pieces.map((piece, index) => ({ ...piece, index })).filter((piece) => piece.pageIndex === draftPageIndex && piece.index <= inkProgress.step).map((piece) => {
                    const progress = piece.index < inkProgress.step ? 1 : inkProgress.progress;
                    const { element } = piece;
                    return (
                      <Group key={element.id}>
                        <KonvaRect x={element.x - 7} y={element.y - 7} width={element.width + 14} height={element.height + 14}
                          cornerRadius={5} fill="rgba(37,99,235,0.025)" stroke="rgba(37,99,235,0.3)" strokeWidth={1} dash={[5, 5]} />
                        <Group clipX={element.x - 2} clipY={element.y - 2} clipWidth={(element.width + 4) * progress} clipHeight={element.height + 4} opacity={0.83}>
                          <SceneImage element={element} />
                        </Group>
                        {progress > 0 && progress < 1 && (
                          <Line points={[element.x + element.width * progress, element.y + element.height,
                            element.x + element.width * progress + 7, element.y + element.height - 12]}
                            stroke="#2456a6" strokeWidth={3} lineCap="round" />
                        )}
                      </Group>
                    );
                  })}
                </Layer>
              )}
              <Layer listening={false} ref={selectionLayerRef} scaleX={scaleX} scaleY={scaleY}>
                {showElementBounds && <ElementBoundsOverlay sceneLayerRef={sceneLayerRef} />}
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
                onClick={() => prepareSelectedTask(true)}
                title={text.ai1Title}
                type="button"
              >
                <Sparkles aria-hidden="true" size={17} strokeWidth={2} />
              </button>
              <button
                aria-label={text.ai2Aria}
                className="grid size-9 place-items-center rounded-lg text-[#2563eb] hover:bg-[#eff6ff] disabled:cursor-wait disabled:opacity-50"
                disabled={canvasAiBusy}
                onClick={() => prepareSelectedTask(false)}
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
        </div>
        </div>
      </section>

      {sidebarOpen && (
        <aside
          aria-label={text.ai}
          className={companion.sidebar}
          style={{ width: sidebarWidth }}
        >
          <div
            aria-label={text.resizeSidebar}
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={720}
            aria-valuenow={sidebarWidth}
            className={companion.resizeHandle}
            onPointerDown={beginSidebarResize}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setSidebarWidth((width) => Math.max(320, Math.min(720, width + (event.key === "ArrowLeft" ? 20 : -20))));
            }}
            role="separator"
            tabIndex={0}
            title={text.resizeSidebar}
          />
          <div className={companion.header}>
            <div className="flex items-center gap-1">
              <CanvasAiSettings label={text.sidebarSettings}>
                <CanvasHandwriting model={handwriting} language={language} disabled={canvasAiBusy || photoLoading || saveState === "saving"}
                  snapshots={(solution ? solution.pieces.map(piece => piece.element) : visibleElements)
                    .flatMap(element => element.kind === "image" && element.handwriting ? [element.handwriting] : [])}
                  historyState={solutionHistory?.state}
                  onUndo={() => void changeSolutionHistory("undo")} onRedo={() => void changeSolutionHistory("redo")} />
              </CanvasAiSettings>
              <button
                aria-label={text.newChat}
                disabled={canvasAiBusy}
                className={companion.iconButton}
                onClick={createNewChat}
                title={text.newChat}
                type="button"
              >
                <MessageSquarePlus aria-hidden="true" size={16} strokeWidth={1.7} />
              </button>
              <button
                aria-label={text.closeAi}
                className={companion.iconButton}
                onClick={() => setSidebarOpen(false)}
                title={text.close}
                type="button"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.7} />
              </button>
            </div>
          </div>
          <div aria-label={text.chats} className={companion.chats}>
            {aiChats.map((chat) => (
              <button
                aria-pressed={chat.id === activeChatId}
                className={companion.chatTab}
                key={chat.id}
                disabled={canvasAiBusy && chat.id !== activeChatId}
                onClick={() => setActiveChatId(chat.id)}
                type="button"
              >
                {chat.title}
              </button>
            ))}
          </div>
          <CanvasConversation messages={activeChat?.messages ?? []} chatId={activeChatId} labels={text} mood={petMood}
            pending={sidebarBusy && loadingChatId === activeChatId && aiAnimationRef.current === null} />
          {(solution || sidebarBusy) && (
            <div className={companion.draft} aria-live="polite">
              <div className={companion.draftStatus}>
                {sidebarBusy ? <PenLine aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
                {sidebarBusy ? (aiAnimationRef.current !== null ? text.writing : text.thinking) : text.draftTitle}
              </div>
              {solution && !sidebarBusy && <p className={companion.draftHint}>{text.draftHint}</p>}
              <div className={companion.draftActions}>
                {solution && !sidebarBusy && (
                  <button className={companion.accept}
                    onClick={() => void acceptCanvasSolution()} type="button"><Check aria-hidden="true" size={14} />{text.acceptDraft}</button>
                )}
                <button className={companion.discard}
                  onClick={stopCanvasAi} type="button">{sidebarBusy ? text.stopAi : text.discardDraft}</button>
              </div>
            </div>
          )}
          {aiError && (
            <div className={companion.error} role="alert">
              {aiError}
              {saveState === "error" && <button onClick={() => void queueCanvasSave().then((saved) => { if (saved) setAiError(null); })} type="button">{text.retrySave}</button>}
            </div>
          )}
          <form
            className={companion.composer}
            onSubmit={(event) => {
              event.preventDefault();
              submitAiDraft();
            }}
          >
            {pendingAiImage && (
              <div className="relative w-fit max-w-full overflow-hidden rounded-xl border border-[#dfe3e8] bg-[#f8fafc] p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={text.selectedArea}
                  className="max-h-28 max-w-full rounded-lg object-contain"
                  src={pendingAiImage.dataUrl}
                />
                <button
                  aria-label={text.removeAttachment}
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-[#111827]/75 text-white hover:bg-[#111827]"
                  onClick={() => setPendingAiImage(null)}
                  title={text.removeAttachment}
                  type="button"
                >
                  <X aria-hidden="true" size={15} strokeWidth={2.2} />
                </button>
              </div>
            )}
            <div className={companion.inputRow}>
              <input
                aria-label={text.inputPlaceholder}
                className={companion.input}
                onChange={(event) => setAiDraft(event.target.value)}
                placeholder={solution ? text.revisePlaceholder : text.inputPlaceholder}
                value={aiDraft}
              />
              <button
                aria-label={text.sendMessage}
                className={companion.send}
                disabled={sidebarBusy || !aiDraft.trim()}
                title={text.sendMessage}
                type="submit"
              >
                <SendHorizontal aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
          </form>
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
    </>
  );
}
