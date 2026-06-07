# verify_edits Tool Design

**Date:** 2026-06-04  
**Status:** Approved

## Problem

Agent makes code changes but doesn't reliably verify them. Three failure modes:

1. TypeScript errors left unresolved — `editFile`'s inline `tsc` check runs from `path.dirname(filePath)`, wrong cwd for monorepo, silently misses errors
2. Test failures not caught — system prompt says "run tests" but no enforcement
3. Incomplete logic — agent stops after edits without checking correctness

## Solution

Add an explicit `verify_edits` tool the agent calls when it decides a batch of related edits is complete. Agent controls when to call it and what command to run, making it language-agnostic.

## Tool Design

**File:** `packages/tools/src/tools/verify.ts`

**Input schema:**
```ts
{ command: string, description?: string }
```

**Behavior:**
- Runs `command` as shell from `cwd` (from `config.configurable.cwd`, same pattern as `bashTool`)
- Captures stdout + stderr combined
- On exit 0: returns `"Verification passed.\n<output>"`
- On exit ≠ 0: returns `"Verification FAILED (exit <code>).\n<output>\nFix all errors before proceeding."`

**No new events required.** Existing `tool:start` / `tool:end` events fire for every tool call; LiveZone already renders them.

## Side Fix: Remove broken inline tsc check from editFile

`packages/tools/src/tools/editor/editFile.ts` currently runs `npx tsc --noEmit` from `path.dirname(filePath)`. In a monorepo this finds no tsconfig and silently returns no errors, giving the agent a false all-clear. Remove this check entirely — the explicit `verify_edits` call replaces it.

## Agent Integration

### `packages/agent/src/main/agent_node.ts`
Add `verifyEditsTool` to `AGENT_TOOLS` (between editor tools and control tools).

### `packages/agent/src/main/prompt.ts`
Add one rule to the existing rules block:

```
- After completing a related group of edits, call verify_edits with the appropriate check command (e.g. `npx tsc --noEmit`, `npm test`, `cargo check`). Fix all errors before finishing. Skip only when the change clearly needs no verification (e.g. docs, comments).
```

Existing "Run run_tests after modifying code that has tests" rule stays — `verify_edits` is how that rule gets fulfilled.

## Constants Wiring

| Constant | File | Change |
|----------|------|--------|
| `TOOL_NAMES` | `packages/shared/src/types/agent.ts` | Add `verify_edits = 'verify_edits'` |
| `TOOL_RISK` | `packages/config/src/agent.ts` | Add `verify_edits: 'safe'` |

Risk is `safe` — verification commands read/check only; no approval prompt needed.

## Full Change Set

| What | File |
|------|------|
| New `verifyEditsTool` | `packages/tools/src/tools/verify.ts` |
| Export tool | `packages/tools/src/tools/index.ts` |
| Remove broken tsc check | `packages/tools/src/tools/editor/editFile.ts` |
| Add to `AGENT_TOOLS` | `packages/agent/src/main/agent_node.ts` |
| Add verify rule | `packages/agent/src/main/prompt.ts` |
| Add to `TOOL_NAMES` | `packages/shared/src/types/agent.ts` |
| Add to `TOOL_RISK` | `packages/config/src/agent.ts` |

## Out of Scope

- Graph-level enforcement (approach B/C rejected — agent decides when verification is needed)
- New UI events (existing `tool:start`/`tool:end` sufficient)
- Automatic detection of edit batches
