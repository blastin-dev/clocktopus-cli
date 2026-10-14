import type { UserResponse } from "@repo/cli-contract/user";
import { UserSchema } from "@repo/cli-contract/user";

import { verifyReceiver } from "../lib/agent-receiver.js";
import { findMachineTelemetry, surveyAgents } from "../lib/agents.js";
import { get } from "../lib/api.js";
import { pollForToken, requestDeviceCode, sleep } from "../lib/auth.js";
import { setToken } from "../lib/config.js";

export type LoginResult =
  | { ok: true; user: UserResponse["user"] | null }
  | { ok: false; message: string };

// The device flow, reporting failure instead of exiting so `init` can run it.
// The existing token is replaced only on success, so a failed login keeps the
// old session.
export async function runLogin(): Promise<LoginResult> {
  console.log("Starting device authorization...\n");

  try {
    const deviceCode = await requestDeviceCode();

    const formattedCode = `${deviceCode.userCode.slice(0, 4)}-${deviceCode.userCode.slice(4)}`;

    const fullUrl = `${deviceCode.verificationUri}?user_code=${deviceCode.userCode}`;

    console.log(`Open this link to authorize:\n`);
    console.log(`  ${fullUrl}\n`);
    console.log(
      `Or visit ${deviceCode.verificationUri} and enter code: ${formattedCode}\n`,
    );
    console.log("Waiting for authorization...");

    let interval = deviceCode.interval;
    const startTime = Date.now();
    const timeoutMs = deviceCode.expiresIn * 1000;

    while (Date.now() - startTime < timeoutMs) {
      await sleep(interval * 1000);

      const result = await pollForToken(deviceCode.deviceCode, interval);

      switch (result.status) {
        case "success": {
          setToken(result.accessToken);

          try {
            const data = await get("/api/auth/me");
            const { user } = UserSchema.parse(data);
            console.log(`\nLogged in as ${user.name} (${user.email})`);
            return { ok: true, user };
          } catch {
            console.log("\nLogin successful!");
            return { ok: true, user: null };
          }
        }

        case "pending":
          process.stdout.write(".");
          break;

        case "slow_down":
          interval = result.newInterval;
          break;

        case "denied":
          return {
            ok: false,
            message: `Authorization denied: ${result.message}`,
          };

        case "expired":
          return {
            ok: false,
            message: `Authorization expired: ${result.message}`,
          };

        case "error":
          return { ok: false, message: `Error: ${result.message}` };
      }
    }

    return {
      ok: false,
      message: "Authorization timed out. Please try again.",
    };
  } catch (error) {
    return {
      ok: false,
      message: `Login failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function loginCommand(): Promise<void> {
  const result = await runLogin();
  if (!result.ok) {
    console.error(`\n${result.message}`);
    process.exit(1);
  }
  if (result.user) await warnIfAgentsReportElsewhere(result.user);
}

// Agent tokens outlive a login, so switching accounts leaves every agent
// reporting to the previous one until `agent setup` runs again.
async function warnIfAgentsReportElsewhere(user: UserResponse["user"]) {
  try {
    const telemetry = findMachineTelemetry(surveyAgents());
    if (!telemetry?.endpoint) return;
    const check = await verifyReceiver(telemetry.endpoint, telemetry.token);
    if (!check.ok || check.userId === null || check.userId === user.id) return;
    console.log(
      `\nThis machine's coding agents report to another Clocktopus account.\nRun 'clocktopus agent setup' to report them to ${user.email} instead.`,
    );
  } catch {
    // A check that fails must not fail the login.
  }
}
