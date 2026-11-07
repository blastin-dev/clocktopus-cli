import { realpathSync } from "node:fs";
import { dirname } from "node:path";

import { cliVersion } from "./claude-plugin.js";
import { getApiUrl } from "./config.js";
import { environmentName, isProduction } from "./environment.js";
import { homeRelativePath } from "./home-relative-path.js";
import { currentInstallMethod, runningScript } from "./install-method.js";

// What `clocktopus env --json` prints and `tasks --json` carries as
// `environment`: the server this CLI talks to and the build that answered. The
// Claude Code panel shows a banner from it when either isn't a production
// release.
export function describeEnvironment() {
  const apiUrl = getApiUrl();
  const installMethod = currentInstallMethod();
  const isCheckout = installMethod === "checkout";
  return {
    name: environmentName(apiUrl),
    apiUrl,
    isProduction: isProduction(apiUrl),
    cli: {
      version: cliVersion(),
      installMethod,
      isCheckout,
      // The checkout's `apps/cli`, from its `dist/bin/clocktopus.js`.
      path: isCheckout ? checkoutPath() : null,
    },
  };
}

function checkoutPath() {
  const script = runningScript();
  if (!script) return null;
  let real = script;
  try {
    real = realpathSync(script);
  } catch {
    // A script that moved keeps the path it was started by.
  }
  return homeRelativePath(dirname(dirname(dirname(real))));
}
