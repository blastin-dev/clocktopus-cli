// The synchronous SessionStart hook that tells a session which task its branch
// carries (`commands/agent/context.ts`): the telemetry hook's binary, launcher
// and `--provider`, with a different subcommand.
export function contextCommandFor(hookCommand: string): string {
  return hookCommand.replace(/agent\s+hook/, "agent context");
}

export function isContextHookCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    /clocktopus/i.test(command) &&
    /agent\s+context/.test(command)
  );
}
