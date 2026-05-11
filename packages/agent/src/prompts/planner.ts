export const PLANNER_PROMPT = `You are planning how to complete the user's coding task.

Create a clear, numbered plan. Be specific about which files you'll read/edit.
Keep it under 5 steps if possible.

Respond in JSON:
{
  "goal": "one sentence summary",
  "steps": ["step 1", "step 2", ...]
}`;
