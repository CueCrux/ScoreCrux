/**
 * ScoreCrux Top Floor — GitHub Device Flow Auth
 *
 * Allows CLI users to authenticate with GitHub without a browser callback.
 * The user visits github.com/login/device and enters a short code.
 *
 * Usage:
 *   const user = await deviceFlowLogin(clientId);
 *   // Prints: "Go to https://github.com/login/device and enter code: ABCD-1234"
 *   // Polls until user completes auth
 *   console.log(`Linked as @${user.login}`);
 */

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  name: string | null;
}

/**
 * Start the device flow and poll until completion.
 * Prints instructions to stdout for the user.
 */
export async function deviceFlowLogin(clientId: string): Promise<GitHubUser> {
  // Step 1: Request device code
  const codeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "read:user" }),
  });

  if (!codeRes.ok) throw new Error(`Device code request failed: ${codeRes.status}`);
  const codeData = (await codeRes.json()) as DeviceCodeResponse;

  // Step 2: Show user the code
  console.log();
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │  GitHub Login                            │");
  console.log("  │                                          │");
  console.log(`  │  Go to: ${codeData.verification_uri.padEnd(30)} │`);
  console.log(`  │  Enter:  ${codeData.user_code.padEnd(29)} │`);
  console.log("  │                                          │");
  console.log("  └──────────────────────────────────────────┘");
  console.log();

  // Step 3: Poll for token
  const interval = (codeData.interval ?? 5) * 1000;
  const deadline = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: codeData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const tokenData = (await tokenRes.json()) as any;

    if (tokenData.access_token) {
      // Step 4: Fetch user profile
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
      const user = (await userRes.json()) as GitHubUser;

      console.log(`  Linked as @${user.login}${user.name ? ` (${user.name})` : ""}`);
      return user;
    }

    if (tokenData.error === "authorization_pending") {
      process.stdout.write(".");
      continue;
    }

    if (tokenData.error === "slow_down") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (tokenData.error === "expired_token") {
      throw new Error("Code expired. Please try again.");
    }

    if (tokenData.error === "access_denied") {
      throw new Error("Access denied by user.");
    }

    throw new Error(`Unexpected response: ${tokenData.error}`);
  }

  throw new Error("Login timed out. Please try again.");
}
