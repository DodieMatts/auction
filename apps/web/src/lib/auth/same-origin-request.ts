export function assertSameOriginRequest(request: Request): Response | null {
  const origin = request.headers.get("origin");

  if (!origin) {
    return forbiddenResponse();
  }

  const requestOrigins = new Set<string>();

  try {
    requestOrigins.add(new URL(request.url).origin);
  } catch {
    return forbiddenResponse();
  }

  const host = request.headers.get("host");
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol =
      forwardedProto && forwardedProto.length > 0
        ? forwardedProto.split(",")[0].trim()
        : new URL(request.url).protocol.replace(":", "");
    requestOrigins.add(`${protocol}://${host}`);
  }

  if (!requestOrigins.has(origin)) {
    return forbiddenResponse();
  }

  return null;
}

function forbiddenResponse(): Response {
  return Response.json(
    { message: "Cross-origin request rejected" },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        Vary: "Cookie",
      },
    },
  );
}
