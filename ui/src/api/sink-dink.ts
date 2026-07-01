export interface AgentResult {
  agentId: string;
  status: "success" | "failed";
  modelUsed: string;
  attempts: number;
  output?: string;
  error?: string;
}

export interface ProductionStatusResponse {
  status: "idle" | "running" | "completed" | "failed";
  totalAgents: number;
  successfulAgents: number;
  failedAgents: number;
  results: AgentResult[];
  timestamp: string;
  currentRun?: {
    modelUsed: string;
    attempts: number;
  };
}

export interface StartProductionRequest {
  count: number;
  agentLimit: number;
  model: string;
  topic?: string;
  tone?: string;
}

export interface StartProductionResponse {
  requestId: string;
  status: "accepted";
  message: string;
}

export const sinkDinkApi = {
  getProductionStatus: async (companyId: string): Promise<ProductionStatusResponse> => {
    const res = await fetch(`/api/companies/${companyId}/sink-dink/production/status`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Failed to fetch SINK DINK status (${res.status})`);
    }
    return res.json();
  },

  startProduction: async (
    companyId: string,
    request: StartProductionRequest,
  ): Promise<StartProductionResponse> => {
    const res = await fetch(`/api/companies/${companyId}/sink-dink/production/start`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Failed to start SINK DINK production (${res.status})`);
    }
    return res.json();
  },
};
