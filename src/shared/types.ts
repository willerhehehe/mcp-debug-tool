export type TransportKind = "stdio" | "http";

export type ConnectConfig =
  | {
      transport: "stdio";
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    }
  | {
      transport: "http";
      url: string;
      headers?: Record<string, string>;
      bearerToken?: string;
    };

export interface LogEntry {
  id: number;
  at: string;
  direction: "in" | "out" | "system" | "stderr";
  label: string;
  payload?: unknown;
}

export interface Catalog {
  tools: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  resourceTemplates: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
  errors: Partial<Record<"tools" | "resources" | "resourceTemplates" | "prompts", string>>;
}

export interface ConnectionStatus {
  connected: boolean;
  transport?: TransportKind;
  server?: { name: string; version: string };
  capabilities?: Record<string, unknown>;
  pid?: number | null;
  connectedAt?: string;
  target?: string;
  auth?: {
    state: "required" | "exchanging" | "error";
    authorizationUrl?: string;
    message?: string;
  };
}
