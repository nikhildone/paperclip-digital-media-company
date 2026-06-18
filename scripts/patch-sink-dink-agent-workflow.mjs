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

const artifactImportLine = 'import { sinkDinkArtifactRoutes } from "./routes/sink-dink-artifacts.js";';
if (!source.includes(artifactImportLine)) {
  if (!source.includes(importLine)) {
    throw new Error("Expected sinkDinkAgentWorkflowRoutes import not found before artifact mount");
  }
  source = source.replace(importLine, `${importLine}\n${artifactImportLine}`);
}

const artifactMountLine = "  api.use(sinkDinkArtifactRoutes());";
if (!source.includes(artifactMountLine)) {
  if (!source.includes(mountLine)) {
    throw new Error("Expected sinkDinkAgentWorkflowRoutes mount not found before artifact mount");
  }
  source = source.replace(mountLine, `${mountLine}\n${artifactMountLine}`);
}

writeFileSync(appPath, source, "utf8");
console.log("Mounted SINK DINK controlled agent workflow and artifact preview routes in app.ts");

// Keep SINK/DINK production generation API-only. This import is intentionally
// chained from an existing Docker build patch hook to avoid another Dockerfile edit.
await import("./patch-sink-dink-strict-api-only.mjs");
