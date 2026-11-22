import { describe, it, expect } from "vitest";
import { getCanonicalScheduleUrl, assertNoSecretsInPayload } from "./share";

describe("share utility (canonical detail URLs and payload safety)", () => {
  it("generates a canonical detail URL identifying the schedule and default deployment", () => {
    const url = getCanonicalScheduleUrl({
      type: "vault",
      id: 12,
      origin: "https://chronostar.io",
    });

    expect(url).toBe("https://chronostar.io/vault/12?network=testnet");
  });

  it("identifies custom deployment networks and different schedule types", () => {
    const streamUrl = getCanonicalScheduleUrl({
      type: "stream",
      id: 42,
      network: "mainnet",
      origin: "https://app.chronostar.io",
    });
    expect(streamUrl).toBe("https://app.chronostar.io/stream/42?network=mainnet");

    const dcaUrl = getCanonicalScheduleUrl({
      type: "dca",
      id: "policy-99",
      network: "futurenet",
      origin: "https://app.chronostar.io/",
    });
    expect(dcaUrl).toBe("https://app.chronostar.io/dca/policy-99?network=futurenet");
  });

  it("assertNoSecretsInPayload rejects Stellar secret seeds", () => {
    const secretSeed = "SBEXAMPLESECRETSEEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(() => assertNoSecretsInPayload(secretSeed)).toThrow(
      /Payload contains forbidden secret or signing data/,
    );
  });

  it("assertNoSecretsInPayload rejects signatures and signing keys", () => {
    expect(() =>
      assertNoSecretsInPayload("https://chronostar.io/vault/1?signature=deadbeef"),
    ).toThrow(/Payload contains forbidden secret or signing data/);

    expect(() =>
      assertNoSecretsInPayload("https://chronostar.io/vault/1?signing_key=abcd"),
    ).toThrow(/Payload contains forbidden secret or signing data/);
  });

  it("passes payloads that contain only public schedule details and deployment context", () => {
    expect(() =>
      assertNoSecretsInPayload("https://chronostar.io/vault/10?network=testnet"),
    ).not.toThrow();
  });
});
