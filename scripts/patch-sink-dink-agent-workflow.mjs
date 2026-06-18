import { readFileSync, writeFileSync } from "node:fs";

const appPath = "server/src/app.ts";
let source = readFileSync(appPath, "utf8");

const importLine = 'import { sinkDinkAgentWorkflowRoutes } from "./routes/sink-dink-agent-workflow.js";';
const afterImport = 'import { sinkDinkAiCampaignRoutes } from "./routes/sink-dink-ai-campaign.js";';

if (!source.includes(importLine)) {
  if (!source.includes(afterImport)) {
    throw new Error("Expected sinkDinkAiCampaignRoutes import not found in app.ts");
  }
  source = source.replace(afterImport, `${afterImport}\n${importLine}`);
}

const mountLine = "  api.use(sinkDinkAgentWorkflowRoutes());";
const afterMount = "  api.use(sinkDinkAiCampaignRoutes());";

if (!source.includes(mountLine)) {
  if (!source.includes(afterMount)) {
    throw new Error("Expected sinkDinkAiCampaignRoutes mount not found in app.ts");
  }
  source = source.replace(afterMount, `${afterMount}\n${mountLine}`);
}

writeFileSync(appPath, source, "utf8");
console.log("Mounted SINK DINK controlled agent workflow route in app.ts");

// Keep SINK/DINK production generation API-only. This import is intentionally
// chained from an existing Docker build patch hook to avoid another Dockerfile edit.
await import("./patch-sink-dink-strict-api-only.mjs");
