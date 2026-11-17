/** Reusable coaching prompts, exposed to MCP clients that support prompts. */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "daily_checkin",
    {
      title: "Daily check-in",
      description: "How recovered am I today, and what should today's training look like?",
    },
    async () =>
      userPrompt(
        "Call get_daily_briefing for today. Tell me in a few sentences how recovered I am, citing the specific numbers that drive your view (sleep, HRV against baseline, training readiness, Body Battery, recent load). " +
          "Then recommend what to do today: go ahead with what is scheduled, adjust it, or rest. If the data points in different directions, say so rather than averaging it away.",
      ),
  );

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly review",
      description: "Review the last 7 days of training and recovery and plan the next week.",
    },
    async () =>
      userPrompt(
        "Call get_weekly_review, get_training_status and get_calendar. Summarise my last 7 days: volume and load by sport, how the key sessions went, and how sleep, HRV and resting heart rate moved across the week. " +
          "Point out anything that looks like accumulating fatigue or undertraining. Finish with concrete suggestions for the coming week based on what is already on my calendar.",
      ),
  );

  server.registerPrompt(
    "race_readiness",
    {
      title: "Race readiness",
      description: "Assess readiness for an upcoming race and suggest pacing.",
      argsSchema: z.object({
        race: z.string().describe("The race, e.g. 'Lisbon Half Marathon on 2027-03-14'"),
        goal: z.string().optional().describe("Target time or goal, if you have one"),
      }),
    },
    async ({ race, goal }) =>
      userPrompt(
        `I am preparing for: ${race}.${goal ? ` My goal: ${goal}.` : ""} ` +
          "Use get_race_predictions (with a 90-day range to see the trend), get_fitness_metrics, get_training_load for the last 8 weeks, get_personal_records and get_training_zones. " +
          "Tell me whether the goal is realistic given the evidence, what the biggest gap in my preparation is, and propose a pacing plan with target pace and heart-rate ranges.",
      ),
  );
}
