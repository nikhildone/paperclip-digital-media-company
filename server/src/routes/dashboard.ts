import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";
import { eq } from "drizzle-orm";
import { agents } from "@paperclipai/db";

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await svc.summary(companyId);
    res.json(summary);
  });

  /**
   * GET /companies/:companyId/sink-dink/production/status
   * Returns the production status for SINK & DINK India AI Media Organisation.
   */
  router.get("/companies/:companyId/sink-dink/production/status", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      // Fetch all agents for this company
      const allAgents = await db
        .select()
        .from(agents)
        .where(eq(agents.companyId, companyId));

      // Filter out terminated and pending_approval agents
      const activeAgents = allAgents.filter(
        (a) => a.status !== "terminated" && a.status !== "pending_approval"
      );

      res.json({
        companyId,
        status: "ready",
        totalAgents: activeAgents.length,
        agents: activeAgents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
        })),
      });
    } catch (error) {
      console.error("Error fetching production status:", error);
      res.status(500).json({ error: "Failed to fetch production status" });
    }
  });

  /**
   * Helper function to determine prompt based on agent role/name/title
   */
  function getAgentPrompt(agent: typeof agents.$inferSelect): string {
    const role = agent.role.toLowerCase();
    const name = (agent.name || "").toLowerCase();
    const title = (agent.title || "").toLowerCase();

    // Match based on role, name, or title
    if (role === "ceo" || name.includes("ceo") || title.includes("ceo")) {
      return "You are the CEO. Coordinate and merge work from all team members into a cohesive upload-ready Instagram content pack.";
    }
    if (
      role === "researcher" ||
      name.includes("research") ||
      title.includes("research")
    ) {
      return "You are the Research role. Create an audience pain map and identify trend angles for the content.";
    }
    if (role === "strategy" || name.includes("strategy") || title.includes("strategy")) {
      return "You are the Strategy role. Create content pillars and positioning strategy.";
    }
    if (role === "content" || name.includes("content") || title.includes("content")) {
      return "You are the Content role. Create hooks, scripts, captions, CTAs, and relevant hashtags.";
    }
    if (
      role === "media_production" ||
      role.includes("media") ||
      name.includes("media") ||
      name.includes("production") ||
      title.includes("media") ||
      title.includes("production")
    ) {
      return "You are the Media Production role. Create scene direction, on-screen text overlays, and thumbnail specifications.";
    }
    if (role === "qa" || name.includes("qa") || title.includes("qa")) {
      return "You are the QA role. Provide brand safety assessment and upload-readiness score.";
    }
    if (
      role === "automation" ||
      name.includes("automation") ||
      title.includes("automation")
    ) {
      return "You are the Automation role. Document repeatable workflow, dashboard notes, and API integration points.";
    }
    if (role === "memory" || name.includes("memory") || title.includes("memory")) {
      return "You are the Memory role. Create reusable memory templates, content backlog, and reference materials.";
    }
    if (role === "growth" || name.includes("growth") || title.includes("growth")) {
      return "You are the Growth role. Define growth loops, CTAs, monetization strategy, and page positioning.";
    }
    if (role === "cmo" || name.includes("cmo") || title.includes("cmo")) {
      return "You are the CMO. Create comprehensive marketing and content strategy with brand positioning.";
    }
    if (role === "designer" || name.includes("designer") || title.includes("designer")) {
      return "You are the Designer. Create visual assets, layouts, and design specifications for Instagram content.";
    }
    if (role === "engineer" || name.includes("engineer") || title.includes("engineer")) {
      return "You are the Engineer. Create technical integration points and API specifications for content delivery.";
    }

    // Default fallback
    return "You are a team member of SINK & DINK India AI Media Organisation. Create role-specific work for upload-ready Instagram content packs. Provide practical, actionable output.";
  }

  /**
   * POST /companies/:companyId/sink-dink/production/start
   * Starts production agent runs using Google Gemini REST API directly.
   * Returns batch results with outputs from each agent.
   */
  router.post("/companies/:companyId/sink-dink/production/start", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      // Determine which API key to use
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "API key not configured" });
      }

      // Fetch all agents for this company
      const allAgents = await db
        .select()
        .from(agents)
        .where(eq(agents.companyId, companyId));

      // Filter out terminated and pending_approval agents
      const activeAgents = allAgents.filter(
        (a) => a.status !== "terminated" && a.status !== "pending_approval"
      );

      // Generate batch ID
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const model = "gemini-2.5-flash-lite";
      const topic = "SINK & DINK India AI Media Organisation";

      // Prepare outputs array
      const outputs: Array<{
        agentId: string;
        agentName: string;
        role: string;
        title: string | null;
        ok: boolean;
        status: string;
        output: string;
        error: string | null;
      }> = [];

      // Process agents with concurrency limit of 3
      const concurrencyLimit = 3;
      let successCount = 0;
      let failureCount = 0;

      // Helper function to run a single agent
      const runAgent = async (agent: typeof agents.$inferSelect) => {
        try {
          // Get role-specific prompt
          const rolePrompt = getAgentPrompt(agent);

          const prompt = `${topic}
${rolePrompt}
Create role-specific work for upload-ready Instagram content packs.
Provide practical, actionable output that can be directly used in production.
Format your response as clear bullet points or structured sections.`;

          // Call Google Gemini REST API
          const geminiUrl =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "X-goog-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: prompt,
                    },
                  ],
                },
              ],
            }),
          });

          if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${errorData}`);
          }

          const data = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const generatedText =
            data.candidates?.[0]?.content?.parts?.[0]?.text || "No output generated";

          successCount++;
          outputs.push({
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            title: agent.title || null,
            ok: true,
            status: "completed",
            output: generatedText,
            error: null,
          });
        } catch (error) {
          failureCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          outputs.push({
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            title: agent.title || null,
            ok: false,
            status: "failed",
            output: "",
            error: errorMessage,
          });
        }
      };

      // Run agents with concurrency limit
      for (let i = 0; i < activeAgents.length; i += concurrencyLimit) {
        const batch = activeAgents.slice(i, i + concurrencyLimit);
        await Promise.all(batch.map((agent) => runAgent(agent)));
      }

      res.json({
        batchId,
        companyId,
        model,
        topic,
        count: activeAgents.length,
        successfulAgents: successCount,
        failedAgents: failureCount,
        outputs,
      });
    } catch (error) {
      console.error("Error starting production batch:", error);
      res.status(500).json({ error: "Failed to start production batch" });
    }
  });

  return router;
}
