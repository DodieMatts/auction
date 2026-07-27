import "server-only";

export type ServerEnvironment = Readonly<{
  apiBaseUrl: string;
}>;

const invalidEnvironmentMessage = "Invalid server environment configuration";

let cachedEnvironment: ServerEnvironment | null = null;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  const apiBaseUrl = normalizeApiBaseUrl(process.env.API_BASE_URL);
  cachedEnvironment = Object.freeze({ apiBaseUrl });

  return cachedEnvironment;
}

function normalizeApiBaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(invalidEnvironmentMessage);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(invalidEnvironmentMessage);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(invalidEnvironmentMessage);
  }

  return url.toString().replace(/\/+$/, "");
}
