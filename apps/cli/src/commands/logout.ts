import { clearToken, isLoggedIn } from "../lib/config.js";

export function logoutCommand(): void {
  if (!isLoggedIn()) {
    console.log("You are not logged in.");
    return;
  }

  clearToken();
  console.log("Logged out successfully.");
}
