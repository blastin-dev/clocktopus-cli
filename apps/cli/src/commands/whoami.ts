import { UserSchema } from "@repo/cli-contract/user";

import { ApiError, get } from "../lib/api.js";
import { isLoggedIn } from "../lib/config.js";

export async function whoamiCommand(): Promise<void> {
  if (!isLoggedIn()) {
    console.log("Not logged in. Use 'clocktopus login' to authenticate.");
    return;
  }

  try {
    const data = await get("/api/auth/me");
    const response = UserSchema.parse(data);
    console.log(`Logged in as ${response.user.name} (${response.user.email})`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      console.log("Session expired. Please run 'clocktopus login' again.");
    } else if (error instanceof Error) {
      console.error(`Failed to fetch user info: ${error.message}`);
    } else {
      console.error("Failed to fetch user info: Unknown error");
    }
    process.exit(1);
  }
}
