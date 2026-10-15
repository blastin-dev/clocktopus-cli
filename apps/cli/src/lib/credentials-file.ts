import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

// The ingest token and receiver for an agent whose hook gets no environment from its
// config (Cursor, Codex), in a file Clocktopus owns beside that agent's config.

const CredentialsSchema = z.object({
  token: z.string().min(1),
  endpoint: z.string().min(1),
});

export type AgentCredentials = z.infer<typeof CredentialsSchema>;

// Null when missing or unreadable, which reports as unconfigured.
export function readCredentialsFile(path: string): {
  path: string;
  modifiedAt: Date | null;
  credentials: AgentCredentials | null;
} {
  if (!existsSync(path)) return { path, modifiedAt: null, credentials: null };
  const modifiedAt = statSync(path).mtime;
  try {
    const parsed = CredentialsSchema.safeParse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return {
      path,
      modifiedAt,
      credentials: parsed.success ? parsed.data : null,
    };
  } catch {
    return { path, modifiedAt, credentials: null };
  }
}

// No backup: it would hold the previous token, which nothing reads.
export function writeCredentialsFile(
  credentials: AgentCredentials,
  path: string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.clocktopus-tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      {
        token: credentials.token,
        endpoint: credentials.endpoint.replace(/\/$/, ""),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporaryPath, path);
  rmSync(`${path}.clocktopus-backup`, { force: true });
}

export function removeCredentialsFile(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
