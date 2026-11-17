/** Assembles the MCP server: every tool group plus the coaching prompts. */

import type { McpServer } from "@modelcontextprotocol/server";
import { isWriteEnabled } from "@/lib/config";
import { registerPrompts } from "./prompts";
import { createContext } from "./tool";
import { registerActivityTools } from "./tools/activities";
import { registerHealthTools } from "./tools/health";
import { registerInsightTools } from "./tools/insights";
import { registerPlanningTools } from "./tools/planning";
import { registerProfileTools } from "./tools/profile";
import { registerTrainingTools } from "./tools/training";

export const SERVER_INFO = { name: "garmin-mcp", version: "0.1.0" } as const;

export const SERVER_INSTRUCTIONS =
  "Tools for reading the user's own Garmin Connect data: activities, sleep, HRV, stress, Body Battery, training readiness and status, fitness metrics, and the training calendar. " +
  "Start with get_daily_briefing or get_weekly_review for broad questions, then use the specific tools for detail. " +
  "Dates are YYYY-MM-DD in the user's timezone and default to today. Garmin units: distances in metres, durations in seconds, speeds in metres per second, weight in grams; convert to the user's preferred units when presenting. " +
  "If a tool reports an authentication problem, call garmin_status and relay its instructions.";

export function registerAll(server: McpServer, writeEnabled: boolean = isWriteEnabled()): void {
  const ctx = createContext(server, writeEnabled);
  registerInsightTools(ctx);
  registerActivityTools(ctx);
  registerHealthTools(ctx);
  registerTrainingTools(ctx);
  registerPlanningTools(ctx);
  registerProfileTools(ctx);
  registerPrompts(server);
}
