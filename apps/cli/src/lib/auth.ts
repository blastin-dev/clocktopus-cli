import { getApiUrl } from "./config.js";

const CLIENT_ID = "clocktopus-cli";

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
};

type TokenErrorResponse = {
  error:
    | "authorization_pending"
    | "slow_down"
    | "access_denied"
    | "expired_token"
    | "invalid_request";
  error_description?: string;
};

export type DeviceCodeResult = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
};

export async function requestDeviceCode(): Promise<DeviceCodeResult> {
  const url = `${getApiUrl()}/api/auth/device/code`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to request device code: ${errorText}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type PollResult =
  | { status: "success"; accessToken: string }
  | { status: "pending" }
  | { status: "slow_down"; newInterval: number }
  | { status: "denied"; message: string }
  | { status: "expired"; message: string }
  | { status: "error"; message: string };

export async function pollForToken(
  deviceCode: string,
  interval: number,
): Promise<PollResult> {
  const url = `${getApiUrl()}/api/auth/device/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  // The web app rate-limits `/device/token`, and a 429 body has no `error` field, so
  // it is treated as `slow_down` rather than an unexpected response.
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("x-retry-after"));
    return {
      status: "slow_down",
      newInterval: retryAfter > 0 ? retryAfter + interval : interval + 5,
    };
  }

  const data = (await response.json()) as TokenResponse | TokenErrorResponse;

  if ("access_token" in data) {
    return { status: "success", accessToken: data.access_token };
  }

  if ("error" in data) {
    switch (data.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down", newInterval: interval + 5 };
      case "access_denied":
        return {
          status: "denied",
          message: data.error_description || "Access denied by user",
        };
      case "expired_token":
        return {
          status: "expired",
          message: data.error_description || "Device code expired",
        };
      default:
        return {
          status: "error",
          message: data.error_description || "Unknown error",
        };
    }
  }

  return { status: "error", message: "Unexpected response" };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
