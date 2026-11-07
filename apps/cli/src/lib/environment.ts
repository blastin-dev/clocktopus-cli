export const ENVIRONMENTS = {
  prod: "https://clocktopus.app",
  staging: "https://staging.clocktopus.app",
  dev: "http://localhost:3000",
} as const;

export const PRODUCTION_API_URL = ENVIRONMENTS.prod;

// An environment is its API URL; a name in `ENVIRONMENTS` is shorthand for one.
// Null for anything that is neither a name nor an http(s) URL.
export function resolveEnvironment(value: string): string | null {
  const trimmed = value.trim();
  const named = Object.entries(ENVIRONMENTS).find(
    ([name]) => name === trimmed.toLowerCase(),
  );
  if (named) return named[1];
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// The name in `ENVIRONMENTS`, else the URL's host (`localhost:3018`).
export function environmentName(apiUrl: string): string {
  const named = Object.entries(ENVIRONMENTS).find(([, url]) => url === apiUrl);
  if (named) return named[0];
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl;
  }
}

export function isProduction(apiUrl: string): boolean {
  return apiUrl === PRODUCTION_API_URL;
}
