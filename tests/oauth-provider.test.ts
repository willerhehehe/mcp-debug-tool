import { describe, expect, it, vi } from "vitest";
import { InMemoryOAuthProvider } from "../src/server/oauth-provider";

describe("InMemoryOAuthProvider", () => {
  it("keeps OAuth state, verifier, registrations, and tokens in memory", async () => {
    const redirect = vi.fn();
    const provider = new InMemoryOAuthProvider("http://127.0.0.1:3333/oauth/callback", redirect);
    const state = await provider.state();

    expect(provider.matchesState(state)).toBe(true);
    expect(provider.matchesState(`${state}x`)).toBe(false);
    expect(provider.matchesState(null)).toBe(false);
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none");

    provider.saveCodeVerifier("verifier");
    expect(provider.codeVerifier()).toBe("verifier");

    provider.saveClientInformation({ client_id: "debug-client", issuer: "https://auth.example" }, { issuer: "https://auth.example" });
    provider.saveTokens({ access_token: "secret", token_type: "bearer", issuer: "https://auth.example" }, { issuer: "https://auth.example" });
    expect(provider.clientInformation({ issuer: "https://auth.example" })?.client_id).toBe("debug-client");
    expect(provider.tokens()?.access_token).toBe("secret");

    await provider.redirectToAuthorization(new URL("https://auth.example/authorize"));
    expect(redirect).toHaveBeenCalledOnce();

    provider.invalidateCredentials("all");
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation({ issuer: "https://auth.example" })).toBeUndefined();
    expect(() => provider.codeVerifier()).toThrow("No OAuth PKCE verifier");
  });
});
