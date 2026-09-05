const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function devAccessAllowed(headers: Headers): boolean {
  return (process.env.NODE_ENV === "development" || process.env.HANDWRITING_REVIEW_ENABLED === "1")
    && LOCAL_HOST.test(headers.get("host") ?? "");
}

export function checkDevRequest(request: Request): Response | null {
  if (!devAccessAllowed(request.headers)) return Response.json({ error: "Not found." }, { status: 404 });
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    try {
      if (!origin || new URL(origin).host !== request.headers.get("host") || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ error: "This request must come from the local dev page." }, { status: 403 });
      }
    } catch { return Response.json({ error: "Invalid request origin." }, { status: 403 }); }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return Response.json({ error: "Expected a JSON file." }, { status: 415 });
    }
  }
  return null;
}
