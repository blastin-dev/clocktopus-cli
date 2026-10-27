import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLI_LATEST_HEADER } from "@repo/cli-contract/cli-version";

const TIMEOUT_MS = 4000;

// Where a dry run of `agent hook` writes the requests it would send: a file path, or
// null for stderr. Stdout stays empty either way, because Claude Code parses it.
export type HookDryRun = { file: string | null };

const OFF = new Set(["", "0", "false", "no", "off"]);
const ON = new Set(["1", "true", "yes", "on"]);

// `--dry-run` is `true` or a path; `CLOCKTOPUS_HOOK_DRY_RUN` is a switch or a path.
// The flag's path wins over the variable's.
export function readHookDryRun(
  flag: boolean | string | undefined,
  env: string | undefined,
): HookDryRun | null {
  const value = env?.trim() ?? "";
  const envOn = !OFF.has(value.toLowerCase());
  const envFile = envOn && !ON.has(value.toLowerCase()) ? value : null;

  if (typeof flag === "string" && flag.trim()) {
    return { file: resolve(flag.trim()) };
  }
  if (flag === true || envOn) {
    return { file: envFile ? resolve(envFile) : null };
  }
  return null;
}

function write(dryRun: HookDryRun, text: string): void {
  try {
    if (dryRun.file) appendFileSync(dryRun.file, text, "utf8");
    else process.stderr.write(text);
  } catch {
    // A dry run follows the hook's contract too: it never throws.
  }
}

// Lines starting with `#` say why nothing was sent; the hook has no other output.
export function noteHookDryRun(dryRun: HookDryRun | null, message: string) {
  if (dryRun) write(dryRun, `# ${message}\n`);
}

// Every request `agent hook` makes goes through here, so a dry run prints the same
// bytes a real run sends. The token is never printed. A dry run returns a null status.
// `latest` is the newest CLI the receiver names, null when it names none.
export async function postHookRequest(input: {
  endpoint: string;
  path: `/${string}`;
  token: string;
  body: unknown;
  dryRun: HookDryRun | null;
}): Promise<{
  status: number | null;
  error: string | null;
  latest: string | null;
}> {
  const url = `${input.endpoint.replace(/\/$/, "")}${input.path}`;
  const body = JSON.stringify(input.body);

  if (input.dryRun) {
    write(input.dryRun, `POST ${url}\n${body}\n`);
    return { status: null, error: null, latest: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body,
      signal: controller.signal,
    });
    return {
      status: response.status,
      error: null,
      latest: response.headers.get(CLI_LATEST_HEADER),
    };
  } catch (error) {
    // Recorded for `agent doctor` rather than surfaced to the session.
    return {
      status: null,
      error: error instanceof Error ? error.message : "request failed",
      latest: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
