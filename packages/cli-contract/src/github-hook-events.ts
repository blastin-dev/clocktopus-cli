// The events a Clocktopus webhook on GitHub sends: the hook the GitHub App
// installs, and the one `clocktopus init` and people add by hand.
export const CLOCKTOPUS_HOOK_EVENTS = [
  "push",
  "pull_request",
  "pull_request_review",
] as const;

export type ClocktopusHookEvent = (typeof CLOCKTOPUS_HOOK_EVENTS)[number];

// The names GitHub's webhook form shows for each event.
export const GITHUB_HOOK_EVENT_LABELS: Record<ClocktopusHookEvent, string> = {
  push: "Pushes",
  pull_request: "Pull requests",
  pull_request_review: "Pull request reviews",
};
