import { NextResponse } from "next/server";
import { authenticateDev, authApi, checkDevRequest, checkDevTransport, DEV_SESSION_COOKIE } from "@/lib/handwriting-access.server";
import { failure, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const options = (request: Request) => ({ httpOnly: true, sameSite: "strict" as const, path: "/dev", secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" });

export async function POST(request: Request) {
  const denied = checkDevTransport(request); if (denied) return denied;
  try {
    const body = await readJson(request, 8192) as { token?: unknown; username?: unknown; password?: unknown };
    if (!body || typeof body !== "object") return json("Invalid sign-in request.", 400);
    let token: string;
    if (typeof body.token === "string") token = body.token;
    else {
      if (typeof body.username !== "string" || body.username.length < 3 || body.username.length > 64) return json("Enter your username.", 400);
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) return json("Enter your dev password.", 400);
      const response = await authApi("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: body.username, password: body.password }) });
      if (response.status === 401) return json("Incorrect username or password.", 401);
      if (!response.ok) return json("Sign in is unavailable. Try again.", 503);
      const credentials = await response.json(); token = credentials.access_token;
      if (typeof token !== "string") return json("Sign in is unavailable. Try again.", 503);
    }
    const auth = await authenticateDev(token);
    if (auth.status !== 200) return json(auth.error, auth.status);
    const response = NextResponse.json({ username: auth.user.username }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(DEV_SESSION_COOKIE, token, { ...options(request), maxAge: 8 * 60 * 60 });
    return response;
  } catch (error) {
    if (error instanceof Error && "status" in error) return failure(error);
    return json("Sign in is unavailable. Try again.", 503);
  }
}

export async function GET(request: Request) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  return NextResponse.json({ username: "dev" }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const denied = checkDevTransport(request); if (denied) return denied;
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(DEV_SESSION_COOKIE, "", { ...options(request), maxAge: 0 });
  return response;
}
