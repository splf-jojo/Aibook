export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const TOKEN_STORAGE_KEY = "canvas_access_token";

export type PageTemplate = "ruled" | "dotted" | "grid" | "plain";

export type CanvasPage = {
  id: string;
  width: number;
  height: number;
  pageTemplate: PageTemplate;
  elements: unknown[];
  appleDrawingData?: string | null;
};

export type CanvasContent = {
  schemaVersion: 2;
  pages: CanvasPage[];
};

export type CanvasSummary = {
  id: string;
  title: string;
  elementCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CanvasRecord = {
  id: string;
  title: string;
  content: CanvasContent;
  createdAt: string;
  updatedAt: string;
};

export function apiHeaders(
  token?: string,
  json = false,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}
