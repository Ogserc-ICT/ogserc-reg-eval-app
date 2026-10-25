/**
 * The app's public base URL (APP_URL), e.g. https://registration.ogserc.gov.ng. The certificate QR code
 * links to `${APP_URL}/verify/{id}`, so it must be right before certificates are issued: required in
 * production (the server refuses to start without it), http://localhost:3000 in development.
 */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.APP_URL?.trim();
  if (!value) {
    if (env.NODE_ENV === "production") {
      throw new Error("APP_URL is not set. The certificate QR code links to it.");
    }
    return "http://localhost:3000";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `APP_URL must be a full URL such as https://registration.ogserc.gov.ng, got "${value}".`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("APP_URL must start with https:// (or http://).");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** Where a certificate's QR code leads: the internal verification page for that submission. */
export function verificationUrl(submissionId: string): string {
  return `${appBaseUrl()}/verify/${submissionId}`;
}

/** The same for an own-use notification's certificate (setting "own-use certificate"). */
export function ownUseVerificationUrl(ownUseNotificationId: string): string {
  return `${appBaseUrl()}/verify/own-use/${ownUseNotificationId}`;
}
