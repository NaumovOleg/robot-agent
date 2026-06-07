# Agent Full Flow — Claude Code Style

**Date:** 2026-05-30
**Status:** Approved

---

## Goal

Replace the current LangGraph orchestrator–subagent pipeline with a free agent loop modelled on Claude Code: the LLM receives context and tool schemas, calls tools freely, and iterates until it stops calling tools. All existing code contracts (Zod schemas, LangGraph style, package structure, EventBus patterns) are preserved.

---

## Approach

Option C: structured pre-loop context building (context_selector + file_selector with ripgrep + TF-IDF) injects the right files into the system prompt before the loop starts. The agent loop itself is a simple `agent_node → tools_node → agent_node` LangGraph graph. Deep code analysis is available via an `analyze_code` subagent tool (reader subgraph). The agent decides whether to seek plan approval based on task complexity.

---

## Section 1 — Overall Architecture & Graph Structure

Two phases: a pre-loop context phase, then the agent loop.

```
User input
    │
    ▼
┌──────────────────────────────────────┐
│  Pre-loop Phase                      │
│                                      │
│  context_selector                    │
│    cwd, git status/log, tsconfig,    │
│    package.json, .ROBO.md, .env      │
│                                      │
│  file_selector                       │
│    extract_keywords (LLM)            │
│    → grep (ripgrep)                  │
│    → score (TF-IDF + recency)        │
│    → select_top_k (default 20)       │
└────────────────┬─────────────────────┘
                 │ WorkspaceContext + SelectedFile[]
                 ▼
┌──────────────────────────────────────┐
│  System Prompt Assembly              │
│  workspace snapshot + top-K file     │
│  contents + .ROBO.md + tool schemas  │
└────────────────┬─────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────┐
│  LangGraph Root Graph                │
│                                      │
│   ┌───────────┐    ┌──────────────┐  │
│   │ agent_node│───►│ tools_node   │  │
│   │           │◄───│ (parallel    │  │
│   └─────┬─────┘    │  safe tools) │  │
│         │          └──────────────┘  │
│    no tool calls                     │
│         │                            │
│   ┌─────▼─────┐                      │
│   │summarizer │                      │
│   └───────────┘                      │
└──────────────────────────────────────┘
                 │
                 ▼
          Terminal output
```

The root graph is a two-node loop: `agent_node → tools_node → agent_node`, with `summarizer` as the exit node when the agent returns no tool calls. Everything from spec 1 (reader, plan approval, parallel execution) lives inside tool implementations — not as graph nodes.

**Root graph state:**
```typescript
interface RootState {
  messages:         BaseMessage[]
  cwd:              string
  sessionId:        string
  workspaceContext: WorkspaceContext
  selectedFiles:    SelectedFile[]
}
```

No `steps_state`, `readerOutputs`, or `editIntents` in root state — those concepts are internal to individual tool executions.

---

## Section 2 — Pre-loop Context Building

**context_selector** runs once before the graph. No LLM involved.

Reads from disk in parallel:
- `cwd` absolute path
- `git status --short` + `git log --oneline -10`
- `git diff HEAD` (unstaged changes, truncated at 200 lines)
- `tsconfig.json` → paths, baseUrl, target
- `package.json` → name, dependencies, scripts
- `.eslintrc` / `eslint.config.js` if present
- `.env.example` if present (key names only, no values)
- `.ROBO.md` if present (full content)

Output: `WorkspaceContext` — a serialized block injected into the system prompt. All downstream nodes receive the same snapshot; nothing re-reads disk mid-run.

**file_selector** runs immediately after. Four steps:

**1. extract_keywords** — single LLM call. Receives the user's task. Produces `string[]`: function names, symbol names, file name fragments, import paths, error strings, config keys. Expands beyond what the user literally typed.

**2. grep** — ripgrep scan per keyword:
```
rg --json -l "<keyword>" <cwd>
```
Excludes: `node_modules`, `dist`, `.git`, `*.snap`, `*.lock`. Returns `{ file, matchedKeywords[], lineRanges[] }[]`.

**3. score** — TF-IDF per file:
- term frequency: how many distinct keywords matched in this file
- inverse document frequency: keywords that appear in few files score higher
- recency bonus: files touched in the last 10 commits get +0.2 weight
- explicit bonus: files mentioned by name in the user task get +1.0

**4. select_top_k** — takes top 20 by score. Reads each file's content. Truncates files over 300 lines to first 300 (full content available via `read_file` tool during the loop). Produces `SelectedFile[]` → injected into system prompt.

---

## Section 3 — Tool Set

**Direct file tools** — read-only, always safe to run in parallel:
```
read_file(path, lines?)          → string
list_directory(path, maxDepth?)  → string[]
glob(pattern)                    → string[]
grep(pattern, include?)          → { file, line, match }[]
find_symbol(symbol)              → { file, line, context }[]
git_diff()                       → string
git_log(n?)                      → string
```

**Mutation tools** — execute sequentially, require permission check:
```
write_file(path, content)                      → void
edit_file(path, anchor, replacement)           → void  // str_replace
insert_at_line(path, line, content)            → void
delete_file(path)                              → void
rename_symbol(path, symbol, newSymbol)         → void  // tree-sitter project-wide
bash(command)                                  → { stdout, stderr, exitCode }
run_tests(files[]?)                            → { passed, failed, output }
```

**Control tools** — interrupt the loop:
```
request_approval(plan)    → void   // interrupt() → user sees plan → resume
```

**Subagent tool:**
```
analyze_code(task, files[])  → ReaderOutputSchema
```
Invokes the reader subgraph. Returns structured evidence: functions, classes, imports, references, key findings, and `potential_edit_strategy` with `OperationHint[]`. The agent calls this when it needs AST-level understanding before editing — cross-file refactors, rename operations, anything where reading the file and guessing is insufficient.

**Permission model:**

| Tool | Risk | Default behaviour |
|---|---|---|
| read_*, glob, grep, git_* | none | always allowed |
| write_file, edit_file, insert_at_line | medium | allowed in `acceptEdits` mode, asks otherwise |
| delete_file, rename_symbol | high | always asks |
| bash | depends on command | asks unless in `dontAsk` mode |
| analyze_code | none | always allowed |
| request_approval | none | always allowed |

Modes: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`. Stored in session, toggled via `/approve` slash command.

---

## Section 4 — Reader Subagent (`analyze_code`)

The reader is a LangGraph subgraph invoked as a tool. No checkpointer — it runs to completion and returns `ReaderOutputSchema`. Keeps the existing structure, with tree-sitter replacing ts-morph for all languages.

```
analyze_code(task, files[])
    │
    ▼
┌─────────────────────────────────────┐
│  Reader Subgraph                    │
│                                     │
│  file_reader  ──► ast_parser        │
│      │               │              │
│      └──────┬─────────┘             │
│             ▼                       │
│       import_graph                  │
│             │                       │
│             ▼                       │
│       reader_llm                    │
│    (structured output)              │
└──────────────┬──────────────────────┘
               │ ReaderOutputSchema
               ▼
        back to agent loop
```

**file_reader** — `fs.readFile` for every file in `files[]`, parallel. Missing files logged as warnings, excluded from `filesAnalyzed`.

**ast_parser** — tree-sitter for all languages (TypeScript, JavaScript, and everything else). Extracts per file:
- functions: name, signature, params, returnType, location (`file:line`), bodyPreview (first 5 lines), internal call list
- classes: name, methods, properties, location
- imports: source, specifiers, isDefault, location

**import_graph** — for each file: which imports are local vs external, resolved absolute paths for local imports, cross-file reference map (`symbol → [{file, line, context}]`). Answers "if you change X, these files break."

**reader_llm** — single structured-output LLM call. Receives file contents + AST data + import graph + task. Returns `ReaderOutputSchema` (existing schema, unchanged):
- `status`: `sufficient | insufficient | blocked`
- `summary`, `filesAnalyzed`, `functions`, `classes`, `imports`, `references`
- `key_findings[]`: verbatim snippets with `file`, `lines`, `content`, `comment`
- `potential_edit_strategy`: `goal`, `files_to_modify`, `change_type`, `instructions`, `constraints`, `operation_hints[]`

**Retry logic inside the subgraph:**
- `insufficient` → append `unresolvedQuestions` to next task prompt, expand `files[]` with newly referenced paths, re-run from `file_reader`. Max 2 retries.
- `blocked` → return `blocked` status to the agent loop. Agent decides whether to call `request_approval` with an explanation or surface the question via chat.

---

## Section 5 — Plan Approval & Interrupt/Resume

The agent decides whether to seek approval. The system prompt instructs: call `request_approval` for plans involving multiple file modifications, deletions, renames, or destructive bash commands. Skip it for single-file edits and read-only tasks.

**Flow when agent calls `request_approval(plan)`:**

```
agent_node calls request_approval(plan)
    │
    ▼
tools_node hits interrupt()
    │
    ▼
EventBus.emit('agent:plan_pending', { sessionId, plan })
    │
    ▼
UI renders plan + y/n prompt
    │
user responds
    │
    ▼
EventBus.emit('agent:resume', { sessionId, approved: bool })
    │
    ▼
graph.invoke(new Command({ resume: approved }), config)
    │
    ▼
agent_node continues
  approved=true  → proceeds with execution
  approved=false → agent reconsiders or stops
```

`plan` is a plain string — the agent composes it naturally as part of its reasoning (typically a numbered list of intended changes). No `PlannerOutputSchema` required.

**Other interrupt points** use existing events:
- `agent:tool_pending` — before a high-risk tool (delete_file, destructive bash)

When `analyze_code` returns `blocked`, the agent receives it as a normal tool result and responds in chat asking the user for clarification. No interrupt — the user replies, the loop continues.

Both interrupt points resume via `graph.invoke(new Command({ resume: value }), config)` with the root graph's thread ID.

---

## Section 6 — Tool Execution & Summarizer

**edit_file (str_replace):**
1. Read current file content from disk
2. Verify `anchor` exists as exact substring — if not found, return error with file snippet (±10 lines around expected location) so agent can retry with corrected anchor
3. Replace anchor with `replacement`
4. Write back to disk
5. Run `tsc --noEmit` on the file if TypeScript, eslint if config present — append errors to tool result immediately

**rename_symbol (tree-sitter):**
1. Parse file with tree-sitter to locate the symbol's definition node
2. `grep(symbol, cwd)` to find all reference sites across the project
3. For each reference site: `edit_file` with the symbol string as anchor, `newSymbol` as replacement
4. Returns count of files modified

**bash:**
- Executes in `cwd` with 30s timeout (configurable)
- Returns `{ stdout, stderr, exitCode }`
- Permission check before execution (always asks unless `dontAsk` mode)
- Blocked: `rm -rf /`, fork bombs — rejected before execution

**run_tests:**
- Detects test runner from `package.json` scripts (`jest`, `vitest`, `mocha`)
- Runs against provided files or full suite if none specified
- Returns `{ passed, failed, output }` — failed tests include assertion message + stack trace

**Summarizer** — final node when agent exits loop:
- `git diff HEAD` of all modified files
- List of created / deleted / renamed files
- Final `tsc --noEmit` exit code
- Test results if `run_tests` was called
- Prose summary via lightweight LLM call (free-form, not structured output)

Output printed to terminal. Failed tool calls listed with their last error.

---

## Section 7 — Session, Compaction & Slash Commands

**Session storage** — unchanged:
- Sessions indexed at `.robocode/index.json` relative to `cwd`
- Messages, tool calls, tool results stored under `.robocode/sessions/`
- LangGraph checkpoints in `~/.robocode/checkpoints.db` (SQLite)
- Thread ID: `{sessionId}_main`

**Context compaction** — triggers automatically at 80% of model context window:
1. Filter to human + assistant messages only
2. LLM summarizes into a concise context block (goals, decisions, findings, current state)
3. Replace message history with single `SystemMessage` containing summary
4. Emit `agent:compact_complete` → UI shows: `◆ Conversation compacted · N messages → 1 summary`

Also triggerable manually via `/compact`.

**Slash commands** — intercepted in `Chat.tsx` before reaching the agent:

| Command | Behaviour |
|---|---|
| `/clear` | Stop agent, delete session, create fresh session |
| `/compact` | Emit `agent:compact_request` |
| `/approve` | Toggle `acceptEdits` permission mode |
| `/help` | Show available commands |
| `/audit [N]` | Show last N audit entries (default 10) |
| `/transcript` | Print session file path |
| `/inspect` | Open session inspector screen |

**Memory** — `.ROBO.md` in `cwd` is the project's persistent instruction file. Read by `context_selector` on every run, injected into system prompt. The agent never writes to it.

---

## Section 8 — Package Structure

```
packages/
├── config/          unchanged — TOOL_RISK map updated with new tool names
├── shared/
│   └── src/
│       ├── schemas/
│       │   ├── reader/output.ts       unchanged (ReaderOutputSchema)
│       │   ├── workspace/context.ts   NEW — WorkspaceContext, SelectedFile
│       │   └── agent/state.ts         NEW — RootState
│       └── types/event.ts             updated — existing events kept
├── core/            unchanged — SessionService, MessageService, Checkpointer
├── providers/       unchanged
├── tools/
│   └── src/
│       ├── file/     read_file, write_file, edit_file, insert_at_line,
│       │             delete_file, list_directory, glob
│       ├── search/   grep, find_symbol
│       ├── symbol/   rename_symbol (tree-sitter)
│       ├── bash/     bash, run_tests
│       └── git/      git_diff, git_log
└── agent/
    └── src/
        ├── context/
        │   ├── selector.ts          context_selector
        │   └── file_selector/
        │       ├── keywords.ts      extract_keywords (LLM call)
        │       ├── grep.ts          ripgrep wrapper
        │       ├── score.ts         TF-IDF + recency scorer
        │       └── index.ts         select_top_k, orchestrates the four steps
        ├── main/
        │   ├── graph.ts             root LangGraph graph
        │   ├── agent_node.ts        LLM call + tool binding
        │   ├── tools_node.ts        ToolNode + permission check + parallel dispatch
        │   ├── summarizer.ts        final node, git diff + prose summary
        │   └── prompt.ts            system prompt assembly
        ├── subagents/
        │   └── reader/              unchanged structure
        │       ├── graph.ts
        │       ├── file_reader.ts
        │       ├── ast_parser.ts    tree-sitter (all languages)
        │       ├── import_graph.ts
        │       └── reader_llm.ts
        └── index.ts                 RoboAgent — pre-loop phase + graph.invoke()
```

**Build order** unchanged: `core → shared → config → providers → tools → agent → ui → cli`

**Deleted entirely:**
- `packages/agent/src/main/root/` — replaced by `main/` flat structure
- `packages/agent/src/main/subagents/editor/` — editor subagent removed, agent uses flat tools directly
- `packages/agent/src/main/subagents/git/` — git tools are flat tools, no subagent needed

---

## Section 9 — Error Handling

**LLM structured output failure** (reader_llm, extract_keywords):
Zod parse error appended to next prompt: `"Your previous response failed validation: [error]. Fix and retry."` Max 3 retries. On third failure: return `blocked` status with the validation error as `unresolvedQuestions`.

**File not found** (file_reader, read_file tool):
Logged as warning. Excluded from `filesAnalyzed`. Tool result includes the error — agent can call `glob` or `find_symbol` to locate the correct path.

**Anchor not found** (edit_file):
Tool returns error with file content ±10 lines around expected location. Agent retries with corrected anchor. After two failures on the same file: falls back to `write_file` with full file content.

**tsc / eslint failure after edit:**
Full compiler output appended to tool result. Agent sees errors in the same turn and issues follow-up `edit_file` calls to fix them.

**bash non-zero exit:**
`stdout` + `stderr` returned as tool result. Agent decides whether to retry, fix the underlying cause, or surface the error.

**Test failure:**
Failed assertion + stack trace returned. Agent can read the failing test, understand the expectation, and fix the implementation within the same loop.

**Graph-level failure** (unhandled exception):
Caught at `RoboAgent` level. Session checkpointed to last successful node. Error emitted via `EventBus` → UI shows error. User can retry or `/clear`.

**Interrupt on high-risk tool without user response:**
Process exit while waiting on an interrupt leaves checkpoint in pending state. On next run with the same session, graph resumes at the interrupt point.

---

## What This Does Not Cover

- Markdown rendering improvements in the UI
- Multi-model provider switching at runtime
- Remote / cloud execution
- IDE integration
- `.ROBO.md` auto-generation from codebase analysis
