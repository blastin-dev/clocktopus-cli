import type { OnboardingState } from "@repo/cli-contract/onboarding";
import { DeclaredTrackerKeyPrefixesSchema } from "@repo/cli-contract/onboarding";
import {
  extractTaskKey,
  extractTaskKeyFromBranch,
  keyPrefix,
  normalizeTaskKeyPrefix,
  TASK_KEY_PREFIX,
} from "@repo/cli-contract/task-key";

import type { InitDeps, InitState } from "./types.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);

// How far back the commit scopes are read, across every branch.
const MAX_COMMITS = "2000";

// How many commits and branches together must carry a prefix before init
// declares it, so a single stray scope such as `feat(v2-1)` is not declared.
export const MIN_PREFIX_USES = 2;

// The prefixes of the `<X>-<n>` keys at least `MIN_PREFIX_USES` of the
// checkout's commit scopes and branch names carry, most used first.
export function findCheckoutKeyPrefixes(deps: Pick<InitDeps, "run">): string[] {
  const lines = (args: string[]) => {
    const result = deps.run("git", args);
    return result.ok ? result.stdout.split("\n") : [];
  };
  const keys = [
    ...lines(["log", "--all", `--max-count=${MAX_COMMITS}`, "--format=%s"]).map(
      (subject) => extractTaskKey(subject, "webhook"),
    ),
    ...lines([
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
    ]).map((branch) => extractTaskKeyFromBranch(branch.trim())),
  ];

  const counts = new Map<string, number>();
  for (const key of keys) {
    const prefix = key ? keyPrefix(key) : null;
    if (prefix && TASK_KEY_PREFIX.test(prefix)) {
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, uses]) => uses >= MIN_PREFIX_USES)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([prefix]) => prefix);
}

// Declares the prefixes the checkout uses on the project without asking; asks
// only when one is another project's, to skip it or type another.
export async function runTrackerKeyPrefixStep(
  deps: InitDeps,
  onboarding: OnboardingState,
  state: InitState,
): Promise<void> {
  const { organizationId, projectId } = state;
  if (!organizationId || !projectId) return;
  const found = findCheckoutKeyPrefixes(deps);
  if (found.length === 0) return;

  const organization = onboarding.organizations.find(
    (org) => org.id === organizationId,
  );
  if (!organization || !ADMIN_ROLES.has(organization.role)) {
    deps.log(
      `– Tracker key prefixes: ${found.join(", ")} found here; an owner or admin of ${organization?.name ?? "the organisation"} declares them on the project page`,
    );
    return;
  }

  const path = `/api/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/tracker-key-prefixes`;
  const declare = async (prefixes: string[]) =>
    DeclaredTrackerKeyPrefixesSchema.parse(
      await deps.api.post(path, { prefixes }),
    );

  const first = await declare(found);
  const declared = [...first.declared];
  let clashes = first.refused;
  while (clashes.length > 0) {
    const [clash, ...rest] = clashes;
    clashes = rest;
    if (!clash) break;

    const typed = await deps.prompt.choose<boolean>(
      `${clash.prefix} is used by ${clash.usedBy}. What should ${state.projectName ?? "this project"} declare instead?`,
      [
        { label: `Skip ${clash.prefix}`, value: false },
        { label: "Type another prefix", value: true },
      ],
      0,
    );
    if (!typed) continue;

    const prefix = normalizeTaskKeyPrefix(
      await deps.prompt.text("Tracker key prefix", ""),
    );
    if (!prefix) {
      deps.log("  Use letters and digits, starting with a letter (up to 10).");
      clashes = [clash, ...clashes];
      continue;
    }
    const next = await declare([prefix]);
    declared.push(...next.declared);
    clashes = [...next.refused, ...clashes];
  }

  if (declared.length > 0) {
    deps.log(`✓ Tracker key prefixes: ${declared.join(", ")}`);
  }
}
