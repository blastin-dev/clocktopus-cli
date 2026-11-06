import { revParseOf } from "./panel";

// The tools that write a file, by the argument naming it.
const WRITING_TOOLS: Record<string, string> = {
  Edit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path",
};
const LEADING_CD =
  /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;|\n|$)/;

// The absolute folder a call worked in: a written file's, or the one a Bash command starts by
// changing into. Null when it names none or names it relative to the session's own.
export function workedInOf(tool: string, input: Record<string, unknown>) {
  if (tool === "Bash") {
    const match =
      typeof input.command === "string" ? LEADING_CD.exec(input.command) : null;
    const folder = match?.[1] ?? match?.[2] ?? match?.[3];
    return folder?.startsWith("/") ? folder.replace(/(.)\/+$/, "$1") : null;
  }
  const field = WRITING_TOOLS[tool];
  const path = field ? input[field] : undefined;
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

// Each argument is `revParseOf`'s stdout, in the session's folder and in the one a call worked
// in. Returns both roots when the call worked in another linked worktree of the session's
// repository.
export function strayWorktreeOf(sessionStdout: string, workedStdout: string) {
  const session = revParseOf(sessionStdout);
  const worked = revParseOf(workedStdout);
  if (!session || !worked || worked.commonDir !== session.commonDir)
    return null;
  if (worked.root === session.root || !worked.isWorktree) return null;
  const mainRoot = session.commonDir.slice(
    0,
    session.commonDir.lastIndexOf("/"),
  );
  return {
    root: worked.root,
    sessionRoot: session.root,
    // EnterWorktree, from a session already in a worktree, reaches only those under
    // `<main checkout>/.claude/worktrees/`.
    mayNeedExit:
      session.isWorktree &&
      !worked.root.startsWith(`${mainRoot}/.claude/worktrees/`),
  };
}

export const strayWorktreeNote = ({
  root,
  sessionRoot,
  mayNeedExit,
}: NonNullable<ReturnType<typeof strayWorktreeOf>>) =>
  `This call worked in the git worktree ${root}, but the session's directory is still ${sessionRoot}, so its hooks, the Clocktopus panel and the session's branch report that checkout instead of the one you are working in. Move the session into the worktree with the EnterWorktree tool and path "${root}", then work there without cd.${
    mayNeedExit
      ? ` If EnterWorktree refuses it because the session is already in a worktree, run ExitWorktree with action "keep" first, then EnterWorktree again.`
      : ""
  }`;
