import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, sep } from "node:path";

// The form of a local path that leaves the machine: under the home directory it
// becomes `~/…`, so the username in it stays local. Anything else is returned as is.
export function homeRelativePath(path: string, home = safeHomedir()): string {
  if (!home || !isAbsolute(path) || !isAbsolute(home)) return path;
  // A home at the filesystem root would turn every path into `~/…`.
  if (parse(home).root === home) return path;

  const rest = relative(home, path);
  if (rest === "") return "~";
  if (rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)) {
    return path;
  }
  return join("~", rest);
}

function safeHomedir(): string | null {
  try {
    return homedir();
  } catch {
    return null;
  }
}
