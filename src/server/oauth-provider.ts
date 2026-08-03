import { randomUUID, timingSafeEqual } from "node:crypto";
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";

type RedirectHandler = (authorizationUrl: URL) => void | Promise<void>;

export class InMemoryOAuthProvider implements OAuthClientProvider {
  private stateValue = randomUUID();
  private readonly clientInformationByIssuer = new Map<string, StoredOAuthClientInformation>();
  private readonly tokensByIssuer = new Map<string, StoredOAuthTokens>();
  private latestTokens?: StoredOAuthTokens;
  private verifier?: string;
  private discovery?: OAuthDiscoveryState;
  private resource?: string;

  constructor(
    private readonly callbackUrl: string,
    private onRedirect: RedirectHandler,
  ) {}

  setRedirectHandler(handler: RedirectHandler) {
    this.onRedirect = handler;
  }

  get redirectUrl() {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "MCP Debug Tool",
      client_uri: "https://github.com/willerhehehe/mcp-debug-tool",
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state() {
    this.stateValue = randomUUID();
    return this.stateValue;
  }

  matchesState(candidate: string | null) {
    if (!candidate) return false;
    const expected = Buffer.from(this.stateValue);
    const received = Buffer.from(candidate);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  clientInformation(ctx?: OAuthClientInformationContext) {
    if (ctx) return this.clientInformationByIssuer.get(ctx.issuer);
    return this.clientInformationByIssuer.values().next().value;
  }

  saveClientInformation(value: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext) {
    const issuer = ctx?.issuer ?? value.issuer;
    if (!issuer) throw new Error("OAuth client information is missing its issuer");
    this.clientInformationByIssuer.set(issuer, value);
  }

  tokens(ctx?: OAuthClientInformationContext) {
    return ctx ? this.tokensByIssuer.get(ctx.issuer) : this.latestTokens;
  }

  saveTokens(value: StoredOAuthTokens, ctx?: OAuthClientInformationContext) {
    const issuer = ctx?.issuer ?? value.issuer;
    if (!issuer) throw new Error("OAuth tokens are missing their issuer");
    this.tokensByIssuer.set(issuer, value);
    this.latestTokens = value;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    return this.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.verifier) throw new Error("No OAuth PKCE verifier is available");
    return this.verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.discovery = state;
  }

  discoveryState() {
    return this.discovery;
  }

  saveResourceUrl(resourceUrl: string) {
    this.resource = resourceUrl;
  }

  resourceUrl() {
    return this.resource;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.clientInformationByIssuer.clear();
    if (scope === "all" || scope === "tokens") {
      this.tokensByIssuer.clear();
      this.latestTokens = undefined;
    }
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
    if (scope === "all" || scope === "discovery") {
      this.discovery = undefined;
      this.resource = undefined;
    }
  }
}
