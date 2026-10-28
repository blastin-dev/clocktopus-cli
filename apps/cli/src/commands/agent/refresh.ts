import { refreshAgentSetup } from "../../lib/agent-refresh.js";
import { cliVersion } from "../../lib/claude-plugin.js";

// `--quiet` is the copy `refreshIfUpgraded` starts in the background, whose
// output nobody reads.
export function refreshCommand(options: { quiet?: boolean }): void {
  const report = refreshAgentSetup();
  if (options.quiet) return;
  if (report.status === "busy") {
    console.log(report.lines.join("\n"));
    return;
  }
  const version = cliVersion();
  console.log(
    report.lines.length > 0
      ? report.lines.join("\n")
      : `Nothing agent setup installed needed changing for ${version}.`,
  );
  console.log(
    `\nHooks run ${version} from now on. New sessions load the updated plugin and skills; running sessions keep the ones they started with.`,
  );
}
