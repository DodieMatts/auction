import { NextResponse } from "next/server";

import { serverApiRequest } from "@/lib/api/server-api-client";
import type { ApiHealthResponse } from "@/lib/api/api-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const health = await serverApiRequest<ApiHealthResponse>("/health/ready", {
      method: "GET",
    });

    if (
      health?.status !== "ok" ||
      health.checks.api !== "up" ||
      health.checks.database !== "up"
    ) {
      throw new Error("Unexpected backend health response");
    }

    return NextResponse.json(
      {
        status: "ok",
        services: {
          web: "up",
          api: "up",
          database: "up",
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        status: "error",
        services: {
          web: "up",
          api: "down",
          database: "unknown",
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
