import {
  CLI_LATEST_HEADER,
  CLI_UPGRADE_COMMAND,
  CLI_VERSION_HEADER,
  isCliVersionBelow,
} from "@repo/cli-contract/cli-version";

import { cliVersion } from "./claude-plugin.js";
import { getApiUrl, getToken } from "./config.js";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  authenticated?: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message?: string,
  ) {
    super(message || `API Error: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {}, authenticated = true } = options;

  const url = `${getApiUrl()}${path}`;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    [CLI_VERSION_HEADER]: cliVersion(),
    ...headers,
  };

  if (authenticated) {
    const token = getToken();
    if (token) {
      requestHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  // A 426's own message already names the upgrade command.
  if (response.status !== 426) {
    noteNewerCli(response.headers.get(CLI_LATEST_HEADER));
  }

  if (!response.ok) {
    const errorText = await response.text();
    // The web app's `handleApiError` serializes errors as
    // `{ error: { message, stack? }, timestamp, path }`.
    const message = extractErrorMessage(errorText) ?? errorText;
    // The server refuses this CLI's version, and its message says how to
    // upgrade; exiting here keeps each command's "Failed to …" prefix off it.
    if (response.status === 426) {
      console.error(message);
      process.exit(1);
    }
    throw new ApiError(response.status, response.statusText, message);
  }

  return response.json() as Promise<T>;
}

let newerCliNoted = false;

// Only for a person at a terminal: stderr that is not a TTY is a script's or an
// agent's, and the agent hook never goes through this client.
function noteNewerCli(latest: string | null) {
  if (newerCliNoted || !process.stderr.isTTY) return;
  const current = cliVersion();
  if (!latest || !isCliVersionBelow(current, latest)) return;
  newerCliNoted = true;
  console.error(
    `A newer Clocktopus CLI is available (${current} → ${latest.trim()}). Run: ${CLI_UPGRADE_COMMAND}`,
  );
}

function extractErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const err = record.error;
      if (err && typeof err === "object") {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === "string" && msg.length > 0) return msg;
      }
      if (typeof record.message === "string" && record.message.length > 0) {
        return record.message;
      }
    }
  } catch {
    // Not JSON; the caller shows the raw text.
  }
  return null;
}

export async function get<T>(path: string, authenticated = true): Promise<T> {
  return request<T>(path, { method: "GET", authenticated });
}

export async function post<T>(
  path: string,
  body: Record<string, unknown>,
  authenticated = true,
): Promise<T> {
  return request<T>(path, { method: "POST", body, authenticated });
}

export async function put<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  return request<T>(path, { method: "PUT", body });
}
