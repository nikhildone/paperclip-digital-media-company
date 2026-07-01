import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sinkDinkApi } from "../api/sink-dink";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";
import { Copy, RefreshCw, Zap } from "lucide-react";
import { cn } from "../lib/utils";

interface SinkDinkPanelProps {
  companyId: string;
}

export function SinkDinkPanel({ companyId }: SinkDinkPanelProps) {
  const queryClient = useQueryClient();
  const [count, setCount] = useState(1);
  const [agentLimit, setAgentLimit] = useState(1);
  const [model, setModel] = useState("gemini-2.5-flash");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const { data: status, isLoading, error, refetch } = useQuery({
    queryKey: [...queryKeys.dashboard(companyId), "sink-dink"],
    queryFn: () => sinkDinkApi.getProductionStatus(companyId),
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  const startMutation = useMutation({
    mutationFn: async (agentCount: number) => {
      return sinkDinkApi.startProduction(companyId, {
        count: agentCount,
        agentLimit: Math.min(agentCount, agentLimit),
        model,
        topic: topic || undefined,
        tone: tone || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...queryKeys.dashboard(companyId), "sink-dink"] });
    },
  });

  const handleCopyOutput = (output: string) => {
    navigator.clipboard.writeText(output);
    setCopied(output);
    setTimeout(() => setCopied(null), 2000);
  };

  const models = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
  ];

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5" />
          SINK DINK Direct Production
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Test multi-agent production pipeline with dynamic model selection
        </p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Agent Count</label>
          <input
            type="number"
            min="1"
            max="9"
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(9, parseInt(e.target.value) || 1)))}
            disabled={startMutation.isPending}
            className="mt-1 w-full px-3 py-2 border rounded-md text-sm bg-background text-foreground"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Agent Limit</label>
          <input
            type="number"
            min="1"
            max="9"
            value={agentLimit}
            onChange={(e) => setAgentLimit(Math.max(1, Math.min(9, parseInt(e.target.value) || 1)))}
            disabled={startMutation.isPending}
            className="mt-1 w-full px-3 py-2 border rounded-md text-sm bg-background text-foreground"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={startMutation.isPending}
            className="mt-1 w-full px-3 py-2 border rounded-md text-sm bg-background text-foreground"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Topic (optional)</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter topic..."
            disabled={startMutation.isPending}
            className="mt-1 w-full px-3 py-2 border rounded-md text-sm bg-background text-foreground"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-sm font-medium">Tone (optional)</label>
          <input
            type="text"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="e.g., professional, creative, casual..."
            disabled={startMutation.isPending}
            className="mt-1 w-full px-3 py-2 border rounded-md text-sm bg-background text-foreground"
          />
        </div>
      </div>

      {/* Buttons */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading || startMutation.isPending}
          className="gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
        <Button
          size="sm"
          onClick={() => startMutation.mutate(1)}
          disabled={startMutation.isPending || status?.status === "running"}
        >
          Test 1
        </Button>
        <Button
          size="sm"
          onClick={() => startMutation.mutate(3)}
          disabled={startMutation.isPending || status?.status === "running"}
        >
          Test 3
        </Button>
        <Button
          size="sm"
          onClick={() => startMutation.mutate(9)}
          disabled={startMutation.isPending || status?.status === "running"}
          className="md:col-span-2"
        >
          Full 9 Agents
        </Button>
      </div>

      {/* Status Display */}
      <div className="bg-accent/50 rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Status</p>
            <p className="font-semibold capitalize">{status?.status ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Agents</p>
            <p className="font-semibold">{status?.totalAgents ?? "0"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Successful</p>
            <p className="font-semibold text-green-600 dark:text-green-400">{status?.successfulAgents ?? "0"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Failed</p>
            <p className="font-semibold text-red-600 dark:text-red-400">{status?.failedAgents ?? "0"}</p>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-200">
          {error instanceof Error ? error.message : "An error occurred"}
        </div>
      )}

      {/* Loading State */}
      {startMutation.isPending && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-200">
          Starting production run...
        </div>
      )}

      {/* Results Grid */}
      {status?.results && status.results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Agent Results</h3>
          <div className="grid gap-3">
            {status.results.map((result, idx) => (
              <div
                key={result.agentId || idx}
                className={cn(
                  "rounded-lg p-3 border text-sm space-y-2",
                  result.status === "success"
                    ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                    : "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">Agent {idx + 1}</p>
                    <p className="font-medium capitalize">
                      {result.status === "success" ? "✓ Success" : "✗ Failed"}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <p>{result.modelUsed}</p>
                    <p>Attempts: {result.attempts}</p>
                  </div>
                </div>

                {result.output && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Output:</p>
                    <div className="bg-background/50 rounded p-2 font-mono text-xs max-h-20 overflow-y-auto">
                      {result.output.substring(0, 200)}
                      {result.output.length > 200 ? "..." : ""}
                    </div>
                    <button
                      onClick={() => handleCopyOutput(result.output || "")}
                      className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      {copied === result.output ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}

                {result.error && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Error:</p>
                    <div className="bg-background/50 rounded p-2 font-mono text-xs max-h-16 overflow-y-auto text-red-600 dark:text-red-400">
                      {result.error.substring(0, 200)}
                      {result.error.length > 200 ? "..." : ""}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
