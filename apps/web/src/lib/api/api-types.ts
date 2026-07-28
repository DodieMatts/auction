export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  headers?: HeadersInit;
  accessToken?: string;
  timeoutMs?: number;
}

export interface ApiErrorPayload {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  error?: string;
  details?: unknown;
}

export interface ApiHealthResponse {
  status: "ok";
  checks: {
    api: "up";
    database: "up";
  };
}
