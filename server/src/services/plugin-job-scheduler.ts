/**
 * PluginJobScheduler — cloud-safe scheduled job facade.
 *
 * In this SINK DINK deployment, normal user-facing work is dashboard-first:
 * Assign Task -> direct production route -> model router -> output. Plugin cron
 * jobs are not required for that flow. Supabase pooler environments can cancel
 * background plugin-job scans with PostgreSQL 57014 statement_timeout, which can
 * destabilize the Space after startup. Therefore this scheduler intentionally
 * stays idle unless a future build re-enables plugin jobs after the plugin job
 * tables are validated.
 */

import type { Db } from "@paperclipai/db";
import type { PluginJobStore } from "./plugin-job-store.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import { logger } from "../middleware/logger.js";

export interface PluginJobSchedulerOptions {
  db: Db;
  jobStore: PluginJobStore;
  workerManager: PluginWorkerManager;
  tickIntervalMs?: number;
  jobTimeoutMs?: number;
  maxConcurrentJobs?: number;
}

export interface TriggerJobResult {
  runId: string;
  jobId: string;
}

export interface SchedulerDiagnostics {
  running: boolean;
  activeJobCount: number;
  activeJobIds: string[];
  tickCount: number;
  lastTickAt: string | null;
}

export interface PluginJobScheduler {
  start(): void;
  stop(): void;
  registerPlugin(pluginId: string): Promise<void>;
  unregisterPlugin(pluginId: string): Promise<void>;
  triggerJob(jobId: string, trigger?: "manual" | "retry"): Promise<TriggerJobResult>;
  tick(): Promise<void>;
  diagnostics(): SchedulerDiagnostics;
}

export function createPluginJobScheduler(
  options: PluginJobSchedulerOptions,
): PluginJobScheduler {
  const log = logger.child({ service: "plugin-job-scheduler" });
  let logged = false;

  function logIdleMode() {
    if (logged) return;
    logged = true;
    log.info(
      {
        tickIntervalMs: options.tickIntervalMs ?? 30_000,
        maxConcurrentJobs: options.maxConcurrentJobs ?? 10,
      },
      "plugin scheduled job loop is idle in this cloud build; dashboard agents and SINK DINK production continue to run normally",
    );
  }

  return {
    start(): void {
      logIdleMode();
    },

    stop(): void {
      log.debug("plugin job scheduler idle stop acknowledged");
    },

    async registerPlugin(pluginId: string): Promise<void> {
      logIdleMode();
      log.debug({ pluginId }, "plugin job scheduler idle; registration acknowledged");
    },

    async unregisterPlugin(pluginId: string): Promise<void> {
      logIdleMode();
      log.debug({ pluginId }, "plugin job scheduler idle; unregistration acknowledged");
    },

    async triggerJob(jobId: string): Promise<TriggerJobResult> {
      logIdleMode();
      throw new Error(`Plugin scheduled job loop is idle in this cloud build; cannot trigger job ${jobId}.`);
    },

    async tick(): Promise<void> {
      logIdleMode();
    },

    diagnostics(): SchedulerDiagnostics {
      return {
        running: false,
        activeJobCount: 0,
        activeJobIds: [],
        tickCount: 0,
        lastTickAt: null,
      };
    },
  };
}
