import type { Catalog, ConnectConfig, ConnectionStatus, LogEntry } from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<ConnectionStatus>("/api/status"),
  connect: (config: ConnectConfig) =>
    request<{ status: ConnectionStatus; catalog: Catalog }>("/api/connect", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  disconnect: () => request<ConnectionStatus>("/api/disconnect", { method: "POST" }),
  catalog: () => request<Catalog>("/api/catalog"),
  refreshCatalog: () => request<Catalog>("/api/catalog/refresh", { method: "POST" }),
  callTool: (name: string, argumentsValue: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/tools/${encodeURIComponent(name)}/call`, {
      method: "POST",
      body: JSON.stringify({ arguments: argumentsValue }),
    }),
  readResource: (uri: string) =>
    request<Record<string, unknown>>("/api/resources/read", {
      method: "POST",
      body: JSON.stringify({ uri }),
    }),
  getPrompt: (name: string, argumentsValue: Record<string, string>) =>
    request<Record<string, unknown>>(`/api/prompts/${encodeURIComponent(name)}/get`, {
      method: "POST",
      body: JSON.stringify({ arguments: argumentsValue }),
    }),
  logs: (after: number) => request<{ logs: LogEntry[] }>(`/api/logs?after=${after}`),
  clearLogs: () => request<void>("/api/logs", { method: "DELETE" }),
};
