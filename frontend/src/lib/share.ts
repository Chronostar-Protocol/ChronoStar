import { config } from "./config";

export interface CanonicalScheduleUrlOptions {
  type: "vault" | "stream" | "dca";
  id: string | number;
  network?: string;
  origin?: string;
}

const SECRET_PATTERNS = [
  // Stellar secret seed pattern (starts with S and has 56 base32 characters)
  /\bS[A-Z2-7]{55}\b/,
  // Common secret or signing keys and signature query parameters
  /secret/i,
  /private[_-]?key/i,
  /seed/i,
  /signing[_-]?key/i,
  /signature=/i,
  /sig=/i,
  /signed_xdr/i,
  /auth_token/i,
  /bearer\s+/i,
];

/**
 * Validates that a string contains no secrets, secret keys, or signature payloads.
 */
export function assertNoSecretsInPayload(payload: string): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(payload)) {
      throw new Error("Payload contains forbidden secret or signing data");
    }
  }
}

/**
 * Generates a canonical detail URL identifying the deployment and schedule.
 * Contains only public deployment parameters and schedule identifiers.
 */
export function getCanonicalScheduleUrl({
  type,
  id,
  network,
  origin,
}: CanonicalScheduleUrlOptions): string {
  const base =
    origin?.trim() ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || "https://chronostar.io");

  const cleanBase = base.replace(/\/+$/, "");
  const deploymentNetwork = (network || config.environment || "testnet").toLowerCase();

  const url = new URL(`/${type}/${encodeURIComponent(String(id))}`, cleanBase);
  url.searchParams.set("network", deploymentNetwork);

  const finalUrl = url.toString();
  assertNoSecretsInPayload(finalUrl);

  return finalUrl;
}
