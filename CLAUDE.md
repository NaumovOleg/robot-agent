# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages in dependency order
pnpm build

# Development (CLI with live reload)
pnpm dev

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run a single test file
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/rootRoute.test.ts

# Lint
pnpm lint

# TypeScript type-check (per package, no emit)
npx tsc --noEmit --project packages/agent/tsconfig.json
npx tsc --noEmit --project packages/shared/tsconfig.json

# View debug log at runtime
pnpm debug   # tails ~/.robocode/debug.log

# Clean all build artifacts and node_modules
pnpm clean
```

The build order is strict (enforced by `pnpm build`): `core` → `shared` → `config` → `providers` → `tools` → `agent` → `ui` → `cli`.

Tests live in `__tests__/` (agent, ast, llm, shared) and inside `packages/` (matched by `**/*.test.ts`). The Jest config maps `@robocode-packages/*` to `packages/*/src` so tests run against source directly without building.

## Architecture Overview

Robocode is a **pnpm monorepo** (`apps/cli` + `packages/*`) implementing an AI coding assistant CLI. The core concept is an **orchestrator–subagent** pattern built on LangGraph state machines.

### Package Dependency Graph

```
config  ←  core  ←  shared  ←  tools  ←  agent  ←  (apps/cli)
  ↑__________↑_________↑_________↑
  (all packages peer-depend on config)
```

- **`config`** — static constants: paths (`~/.robocode/`), `TOOL_RISK` map, `AI_PROVIDERS` enum, subagent turn limits. No runtime dependencies.
- **`shared`** — Zod schemas (`ReaderOutputSchema`, `IntentSchema`, editor schemas), TypeScript types, `EventBus` (typed `EventEmitter`), utilities (`buildEditIntent`, `debug`, git helpers, AST parser wrappers). The `AppEvents` interface in `src/types/event.ts` is the single source of truth for all inter-component events.
- **`core`** — runtime services: `SessionService`, `MessageService`, `AuditService`, `Checkpointer` (SQLite via `@langchain/langgraph-checkpoint-sqlite` at `~/.robocode/checkpoints.db`), `ContextService` (project context with TTL cache), `ProfileConfig`, `EventBus` re-export.
- **`providers`** — API key storage via `keytar` (OS keychain).
- **`tools`** — LangChain tool definitions grouped by subagent: `READER_TOOLS_SET` (list_dir, glob, grep, read_file, find_definition, search_files, ast_analyzer), `EDITOR_TOOLS_SET` (edit_file, patch_file, write_file), git tools, bash, undo, validate_project. Root delegate tools (`makeReaderTool`, `makeEditorTool`) wrap subagent invocations.
- **`agent`** — all LangGraph graphs, nodes, prompts, and the `RoboAgent` singleton.
- **`apps/cli`** — React/Ink terminal UI. Screens: Welcome → Profile → Chat (assistant). Uses `RouterProvider`, `ProfileProvider`, `SessionProvider`.

### Agent Architecture (LangGraph)

The system has **one root graph** and **three subagent graphs**, all compiled with the shared SQLite `Checkpointer` (except the reader graph, which has no checkpointer).

#### Root Graph (`packages/agent/src/main/root/graph.ts`)

Nodes: `agent` → `tools` → (router) → `collect_reader_answers` | `edit_intent` | `after_tool`

- **`agentNode`**: Root LLM (orchestrator). Bound tools: `validate_project`, `delegate_to_reader`, `delegate_to_writer`, `delegate_to_git`. Never reads/writes files directly.
- **`rootToolsNode`**: LangGraph `ToolNode` that executes tool calls. The reader tool wraps `readerAgent.run()`.
- **`collect_reader_answers`**: When reader returns `unresolved_questions`, this node uses `interrupt()` to ask the user questions one at a time. Resumed via `agent:resume:reader_questions` event → `RoboAgent.resumeReaderQuestions()`.
- **`editIntentNode`**: Converts `ReaderOutput` → `IntentSchema` using a two-stage LLM call (`buildEditIntent` scaffold → structured output).
- Root router (`route.ts`): After `tools`, checks last ToolMessage — if it contains a reader payload with `unresolved_questions` → `collect_reader_answers`; if it has a resolved payload → `edit_intent`; otherwise → `after_tool` (currently a passthrough).

#### Reader Subagent (`packages/agent/src/main/subagents/reader/`)

Graph: `START → agent → (router) → tools → agent → ... → final → END`

- No checkpointer. Called as a regular LangChain tool.
- `agentNode`: LLM with `READER_TOOLS_SET`. Performs code investigation.
- `finalReadNode`: Structured-output LLM call producing `ReaderOutputSchema` (v2). Includes `unresolved_questions`, `potential_edit_strategy`, AST evidence.
- Output flows back to root as `{ editIntentInputPayload }` in the tool result.

#### Editor Subagent (`packages/agent/src/main/subagents/editor/`)

Graph: `START → agent → tool_approval → tools → final → END`

- Has checkpointer. Supports `interrupt()` for tool approval.
- `initializeWriteNode`: Injects system prompt + project context + reader handoff.
- `toolApprovalNode`: Checks `TOOL_RISK` — `destructive` tools trigger `interrupt()` and emit `agent:tool_pending`.
- `finalEditorNode`: Synthesis LLM producing `EditorResponseSchema`.
- Resumed via `agent:resume:editor` event → `EditorAgent.resume()`.

#### Git Subagent (`packages/agent/src/main/subagents/git/`)

Graph shell exists but nodes are commented out — not yet active.

### Key Data Flow

```
User message
  → RoboAgent.run()
  → root graph: agentNode (orchestrator LLM)
  → delegate_to_reader tool
    → readerAgent.run() → reader graph → ReaderOutput { unresolved_questions, potential_edit_strategy }
  → if unresolved_questions: collect_reader_answers (interrupt per question)
  → editIntentNode: buildEditIntent(readerOutput) → EDIT_INTENT_HUMAN_PROMPT → IntentSchema
  → delegate_to_writer tool (not yet wired to editor subagent in root tools)
```

### Schema Pipeline

`ReaderOutputSchema` (`packages/shared/src/schemas/reader/output.ts`) → `buildEditIntent()` (`packages/shared/src/utils/editIntent.ts`) → `EDIT_INTENT_HUMAN_PROMPT` → `IntentSchema` (`packages/shared/src/schemas/editor/intent.ts`)

- `ReaderOutput.status`: `sufficient` | `insufficient` | `blocked`. Only `sufficient` produces a non-null `potential_edit_strategy`.
- `IntentSchema` contains `edits[]` (union of `TextEditSchema | AstEditSchema | FileEditSchema`), `verification[]`, `confidence`.
- `buildEditIntent` builds a scaffold (goal, summary, targetFiles with evidence, constraints, verification). Evidence is prioritized: `operation > finding > function > class > import > reference`.

### Interrupt / Resume Pattern

All human-in-the-loop interactions use LangGraph's `interrupt()`:

- Plan approval: `agent:plan_pending` → `interrupt()` → `agent:resume` event
- Tool approval (editor): `agent:tool_pending` → `interrupt()` → `agent:resume:editor` event
- Reader questions: `agent:question_pending` → `interrupt()` → `agent:resume:reader_questions` event

Resume calls go through `graph.invoke(new Command({ resume: value }), config)` with the graph's thread ID.

### Session & State Persistence

- Sessions indexed at `.robocode/index.json` (relative to cwd) and stored as JSON/MD/audit files under `.robocode/sessions/`.
- LangGraph checkpoints persisted in `~/.robocode/checkpoints.db` (SQLite).
- Thread IDs: `{sessionId}_main` (root), `{sessionId}_writer` (editor), etc.
- `ContextService` caches project context (file tree, git state, tech stack, policy files) with 60s TTL.
- `debug()` writes to `~/.robocode/debug.log`.

### Event Bus

All cross-component communication uses `EventBus` (typed `EventEmitter` in `packages/core/src/utils/event.ts`). The full event contract is `AppEvents` in `packages/shared/src/types/event.ts`. Key events: `llm:start/end/token`, `agent:plan_pending`, `agent:tool_pending`, `agent:question_pending`, `agent:resume`, `agent:resume:editor`, `agent:resume:reader_questions`.
