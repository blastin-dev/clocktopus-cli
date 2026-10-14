// Every request the CLI makes through its API client carries its version here,
// so the server can turn away a CLI older than `MIN_CLI_VERSION` with a 426.
export const CLI_VERSION_HEADER = "X-Clocktopus-Cli-Version";

// The server answers the CLI routes and `/api/auth/me` with the latest
// published CLI version here, so a CLI behind it can say so.
export const CLI_LATEST_HEADER = "X-Clocktopus-Cli-Latest";

export const CLI_UPGRADE_COMMAND =
  "npm install -g @blastin-dev/clocktopus-cli@latest";

// `major.minor.patch`, with any prerelease or build suffix ignored, so a
// release candidate of a version counts as that version.
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseVersion(version: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// A missing, unparseable or `0.0.0` version is unknown, and an unknown version
// is never below another: `0.0.0` is what the CLI reports when it cannot read
// its own `package.json`. An unparseable `other` makes nothing below it.
export function isCliVersionBelow(
  version: string | null,
  other: string | null,
): boolean {
  if (version === null || other === null) return false;
  const current = parseVersion(version);
  const target = parseVersion(other);
  if (!current || !target) return false;
  if (current.every((part) => part === 0)) return false;

  const [major, minor, patch] = current;
  const [targetMajor, targetMinor, targetPatch] = target;
  if (major !== targetMajor) return major < targetMajor;
  if (minor !== targetMinor) return minor < targetMinor;
  return patch < targetPatch;
}
