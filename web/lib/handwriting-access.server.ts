import { LibraryError } from "./handwriting-errors.ts";

export function devAccessAllowed(_headers: Headers): boolean {
  return process.env.HANDWRITING_REVIEW_ENABLED !== "0";
}

export function checkDevTransport(request: Request): Response | null {
  if (!devAccessAllowed(request.headers)) return Response.json({ error: "Not found." }, { status: 404 });
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    try {
      if (!origin || new URL(origin).host !== request.headers.get("host") || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ error: "This request must come from the dev page." }, { status: 403 });
      }
    } catch { return Response.json({ error: "Invalid request origin." }, { status: 403 }); }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return Response.json({ error: "Expected a JSON file." }, { status: 415 });
    }
  }
  return null;
}

export const DEV_SESSION_COOKIE = "aibook_dev_session";
export type Identity = { id: string; username: string; role: "user" | "dev" };
export type DevIdentity = Identity & { role: "dev" };
export type DevAuthentication = { status: 200; user: DevIdentity } | { status: 401 | 403 | 503; error: string };
const authError = (status: 401 | 403 | 503): DevAuthentication => ({ status, error: status === 503 ? "Sign in is unavailable. Try again." : status === 403 ? "A dev account is required." : "Sign in to continue." });

export function devSessionToken(headers: Headers): string {
  const cookie = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${DEV_SESSION_COOKIE}=`));
  try { return cookie ? decodeURIComponent(cookie.slice(DEV_SESSION_COOKIE.length + 1)) : ""; } catch { return ""; }
}

export function authApi(path: "login" | "me", init: RequestInit = {}) {
  const base = process.env.INTERNAL_API_URL || "http://127.0.0.1:8000";
  return fetch(new URL(`/api/auth/${path}`, base), { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
}

export async function authenticateDev(token: string): Promise<DevAuthentication> {
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) return authError(401);
  try {
    const response = await authApi("me", { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401 || response.status === 403) return authError(401);
    if (!response.ok) return authError(503);
    const user = await response.json();
    if (!user || typeof user.id !== "string" || typeof user.username !== "string") return authError(503);
    if (user.role !== "dev") return authError(403);
    return { status: 200, user };
  } catch { return authError(503); }
}

export async function requestIdentity(request: Request, devOnly = false): Promise<Identity> {
  const bearer = request.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : devSessionToken(request.headers);
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new LibraryError("Sign in to continue.", 401);
  // Cookies need same-origin mutation protection; native Bearer uploads do not.
  if (!bearer && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== request.headers.get("host") || request.headers.get("sec-fetch-site") === "cross-site") throw new LibraryError("Invalid request origin.", 403);
  }
  const response = await authApi("me", { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 || response.status === 403) throw new LibraryError("Sign in to continue.", 401);
  if (!response.ok) throw new LibraryError("Sign in is unavailable. Try again.", 503);
  const user = await response.json();
  if (typeof user.id !== "string" || typeof user.username !== "string" || !["user", "dev"].includes(user.role)) throw new LibraryError("Invalid account response.", 503);
  if (devOnly && user.role !== "dev") throw new LibraryError("A dev account is required.", 403);
  return user;
}

export async function checkDevRequest(request: Request): Promise<Response | null> {
  const denied = checkDevTransport(request); if (denied) return denied;
  const auth = await authenticateDev(devSessionToken(request.headers));
  return auth.status === 200 ? null : Response.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
}
