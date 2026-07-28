import "server-only";

import { getServerEnvironment } from "@/config/server-environment";

import { ApiError } from "./api-error";
import type { ApiErrorPayload, ApiRequestOptions } from "./api-types";

const defaultTimeoutMs = 5000;

export async function serverApiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse | null> {
  const url = buildApiUrl(path);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? defaultTimeoutMs,
  );

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: buildHeaders(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await toApiError(response);
    }

    return parseJson<TResponse>(response);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError({
      status: 503,
      code: "BACKEND_UNAVAILABLE",
      message: "Backend service is unavailable",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildApiUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiError({
      status: 500,
      code: "INVALID_API_PATH",
      message: "Invalid API request path",
    });
  }

  return new URL(`${getServerEnvironment().apiBaseUrl}${path}`);
}

function buildHeaders(options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.delete("Authorization");

  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function toApiError(response: Response): Promise<ApiError> {
  const payload = await parseJson<ApiErrorPayload>(response);
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : Array.isArray(payload?.message)
        ? payload.message.join("; ")
        : "Backend request failed";

  return new ApiError({
    status: response.status,
    code: payload?.code ?? payload?.error ?? "BACKEND_REQUEST_FAILED",
    message,
    details: payload?.details,
  });
}

async function parseJson<TValue>(response: Response): Promise<TValue | null> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as TValue;
  } catch {
    return null;
  }
}
