# Executor edit-pipeline contract rework

Date: 2026-06-13
Branch: feat/executor-loop

## Problem

The executor subagent's edit loop fails too often. Concrete failure classes found in audit:

- **`mini_reader produced zero hints`** — the most frequent hard-fail. `MiniReaderOutputSchema` allows an empty `hints[]` (`array.max(30)`, no `min`). An empty result is routed to `step_review` as `insufficient`, retried with the *same* prompt up to `MAX_STEP_RETRIES=4` (no new signal between retries), then fails the step. "Already satisfied" and "model confused" are indistinguishable.
- **Mangled whitespace shipped** — `newContent` is applied verbatim with no indentation reconciliation. For TypeScript, bad indentation is still valid syntax, so the tree-sitter `checkSyntax` tier passes and the mangled code ships.
- **Anchor not found** — the model reproduces anchors with wrong/missing indentation. `resolveMatch` requires a unique exact match; short or re-indented anchors fail and trigger a full apply→rollback→re-run cycle.
- **AST op bugs** — `applyAstInsert` ignores its target node and always appends to EOF; there are two divergent node-finders (`astEdit.ts#findNodeBySymbol` vs `astOps.ts#findNode`, the former dead); LLMs emit TS-compiler node names (`VariableDeclaration`) instead of tree-sitter names (`lexical_declaration`), so node ops throw `Node not found`; `detectLanguage` returns languages (`kotlin`, `cpp`, `swift`, …) with no bundled wasm, so `createAstParser` throws.
- **Expensive retries** — any single bad hint rolls back the whole attempt and re-runs the full mini_reader LLM call.

## Goals

Harden the whole mini_reader → apply → verify contract in one pass: shrink the op surface, make output formatting guaranteed-correct, add a cheap pre-apply validation/repair tier, and give the model a clean way to say "nothing to do" / "blocked".

Non-goals: changing the planner, the reader subagent, or the root graph. No change to how the executor is invoked from root.

## Design

### 1. Op set: 9 → 6

`ExecutorHintSchema.op` enum becomes:

```
edit_text     { file, oldText, newText }       // strict unique-match text edit
replace_node  { file, nodeType, symbol, newText }  // AST structural rewrite of a named node
create_file   { file, newText }
delete_file   { file }
rename_file   { file, target }
rename_symbol { file, symbol, newSymbol }       // AST, whole-file, nodeType-agnostic
```

Field renames: `newContent` → `newText`, `anchor` → folded into `edit_text.oldText`. Removed fields: `insertMode`, standalone `anchor`.

**Dropped ops:** `insert_text`, `remove_text` (both now `edit_text`). `insert_node` (was EOF-broken), `remove_node`.

`edit_text` idioms (taught in the prompt):
- **Insertion** — `oldText` is an existing neighbor line; `newText` = that neighbor plus the added line(s).
- **Deletion** — `newText` stays non-empty (schema requires it), so pure removal is expressed as `oldText` = the construct plus a boundary line, `newText` = the boundary line alone.

**Kept AST ops:** `replace_node` (big block / structural rewrites where naming the node beats a large `oldText`) and `rename_symbol`.

`edit_text` semantics: pure removal of a whole construct is expressed by giving `oldText` = the construct plus a trailing/leading boundary and `newText` = the boundary alone. The prompt documents this; we do **not** special-case empty `newText`.

### 2. MiniReaderOutputSchema — 3-state

```ts
{
  status: 'edits' | 'noop' | 'blocked',
  reason: string,                 // always required
  hints: ExecutorHint[],          // superRefine: status==='edits' ⇒ hints.length >= 1
}
```

- `edits` → at least one hint; proceeds to validate.
- `noop` → step already satisfied on disk; `step_review` records the step **done** with `reason` as output. No retry.
- `blocked` → model cannot proceed (missing info, contradictory constraint); routes straight to `escalate`. No retry burn.

`miniReaderNode` no longer manufactures `lastError: 'mini_reader produced zero hints'` — an empty `edits` is now a schema violation surfaced to the structured-output retry, and a deliberate empty is expressed as `noop`/`blocked`.

### 3. Graph shape

New nodes `validate` and `format`; `mini_reader` routing keys off `status`.

```
step_selector ─(edit/create/delete)→ mini_reader
mini_reader ─ status:
   noop     → step_review (marks done)
   blocked  → escalate
   edits    → validate
validate ─ all anchors resolve? 
   yes → (destructive? approval_gate :) apply
   no  → repair
repair (re-prompt only the failed hints, bounded MAX_REPAIR≈2) → validate
   exhausted → step_review (insufficient → existing retry/escalate path)
apply → format → verify_step → step_review → …
```

- **`validate`**: for each hint, dry-run resolve `oldText`/`replace_node` target against current disk content. No writes. Produces `hintErrors: { index, op, file, reason, nearestCandidate? }[]`. Reuses `fuzzyWhitespaceAnchor` **for diagnostics only** (to suggest the nearest existing text), never for silent application.
- **`repair`**: a focused mini_reader re-prompt containing only the failing hints + their errors + the relevant file slice; returns corrected hints, merged back over the valid ones. Bounded by `MAX_REPAIR` to avoid loops; on exhaustion, fall through to the normal `step_review` insufficient path.
- **`format`**: runs the project formatter on touched files only (see §5).

`hasDestructiveHints` / `approval_gate` keep their place between validate and apply.

### 4. Matcher: strict + rich errors

`edit_text` and `replace_node` require an **exact unique** match.

- Exact unique match → apply.
- No match or non-unique → throw an actionable error: file, line of nearest candidate, the nearest fuzzy candidate text (via `fuzzyWhitespaceAnchor`), and the match count when >1. This error is what `validate` collects and `repair` consumes.
- Keep the idempotency no-op guard (`oldText` gone AND `newText` already present ⇒ skip) so a prior hint that already made the change doesn't fail the batch.
- The leaked-line-number-prefix strip stays (model still leaks `"8 | "` prefixes).

The whitespace-tolerant *silent* apply in `resolveAnchor` is removed — fuzzy is diagnostic-only now. Correct indentation is guaranteed by the formatter pass, not by fuzzy matching.

### 5. Formatter node

After `apply` succeeds (all hints applied + tree-sitter syntax check passes) and before `verify_step`:

- Detect the formatter **per language of the touched file**, not a single project-wide assumption:
  - JS/TS/CSS/MD/JSON → `prettier` (if present) else `eslint --fix`.
  - Go → `gofmt`/`goimports`; Rust → `rustfmt`; Python → `black`/`ruff format`; and similar native formatters keyed by language.
  - Resolve the formatter only if it's actually available in the project (devDep / config / on PATH). Cache the per-language resolution.
- Run it on the touched files only (`producedFiles` of this attempt), scoped to `cwd`.
- Skip cleanly when no formatter resolves for that language. Formatter failure is non-fatal (log + continue) — it must never block a correct edit.

This normalizes the model's indentation/whitespace regardless of what it emitted, making strict matching safe to ship — in any language, falling back to "no formatter" gracefully.

### 6. AST cleanup

- Delete `packages/tools/src/utils/astEdit.ts` (`resolveAstEdit`, `findNodeBySymbol`) — dead duplicate finder.
- `astOps.ts`: keep `findNode`, `applyAstReplace` (for `replace_node`), `applyAstRename` (for `rename_symbol`). Remove `applyAstInsert` and `applyAstRemove` (ops dropped).
- **nodeType normalization** for `replace_node`: map common compiler/casual node names → tree-sitter grammar names, **keyed by language**. The TS/JS map (`VariableDeclaration`→`lexical_declaration`, `FunctionDeclaration`→`function_declaration`, `ClassDeclaration`→`class_declaration`, `InterfaceDeclaration`→`interface_declaration`, `TypeAliasDeclaration`→`type_alias_declaration`, `EnumDeclaration`→`enum_declaration`, …) is the first entry; other languages can add their own without touching the dispatch logic. Apply in `dispatch` before `findNode`. Unknown names pass through unchanged so any valid native tree-sitter type still works.
- **Unsupported-language guard**: `replace_node` / `rename_symbol` on a file whose language has no bundled wasm returns a clear error routed as `blocked` (escalate) rather than an uncaught throw. `edit_text` and file ops are pure text and work on any language.

### 6a. Language-agnostic by design

The executor must work across languages, not just TypeScript. The contract is built so the text path is the universal default and the AST path degrades gracefully:

- `edit_text`, `create_file`, `delete_file`, `rename_file` are pure text — they work identically in any language.
- `replace_node` / `rename_symbol` use the bundled tree-sitter wasm set (ts, tsx, js, python, go, rust, java, c, csharp, php, ruby, dart, json). For a language with no wasm they don't throw — they return the `blocked` guard so the step escalates or the model re-expresses the edit as `edit_text`.
- `detectLanguage` currently advertises languages with no bundled wasm (`kotlin`, `cpp`, `swift`, `yaml`, `css`, `sql`, …). The guard (above) must treat "language detected but no wasm" the same as "unsupported" — never crash.
- nodeType normalization and formatter resolution are both keyed by language, so adding a language is data, not control-flow.
- The prompt must not assume TypeScript: examples stay language-neutral or are clearly marked as TS-specific, and the `replace_node` vocabulary note states it lists TS/JS node types as an example, with "use your language's tree-sitter node names" for others.

### 7. Prompt rework (`prompts/sub/executor/miniReader.ts`)

- Rewrite the output-rules section around the 6 ops. Delete the `insertMode`, `remove_text`, and most of the `nodeType`/tree-sitter instruction blocks.
- Keep and adapt: line-number-prefix warning, "anchor is a verbatim unique substring", smallest-edit guidance, list/union-add guidance (include an existing neighbor, never retype the whole declaration), "only import what you use".
- Add `replace_node` guidance: when to prefer it (large structural rewrite of a named function/class/type/enum), with the small set of valid tree-sitter `nodeType` names listed.
- Add the `status` decision rule: emit `noop` (with reason) when the step's intent is already present on disk; emit `blocked` (with reason) when the step cannot be completed from available context.

## Affected files

- `packages/shared/src/schemas/executor/types.ts` — op enum, field renames, `MiniReaderOutputSchema` 3-state + superRefine.
- `packages/agent/src/subagents/executor/graph.ts` — add `validate`, `format`, `repair` nodes + routing.
- `packages/agent/src/nodes/sub/executor/` — new `validate.ts`, `format.ts`, `repair.ts`; update `miniReader.ts` (status handling, drop zero-hints error), `apply.ts`, `stepReview.ts` (noop→done), `dispatch.ts` (6 ops, nodeType normalization, strict matcher, diagnostic fuzzy), `index.ts` exports.
- `packages/shared/src/utils/editor/astOps.ts` — remove `applyAstInsert`/`applyAstRemove`.
- `packages/shared/src/utils/editor/textOps.ts` — `edit_text` strict matcher + rich errors.
- `packages/tools/src/utils/astEdit.ts` — delete.
- `packages/agent/src/prompts/sub/executor/miniReader.ts` — rewrite output rules (language-neutral).
- `packages/shared/src/ast/parser.ts` / `detectLanguage.ts` — expose "is this language backed by a bundled wasm?" so the guard and `checkSyntax` agree, and the AST ops can decline cleanly instead of throwing on `Language.load`.

## Risks

- Folding insert/remove into `edit_text` shifts more responsibility to a single op; the prompt must teach the insertion/deletion idioms clearly or the model regresses.
- Formatter detection across diverse projects — must fail open (skip) and never block.
- `replace_node` retained means the tree-sitter `nodeType` failure class isn't fully gone; mitigated by normalization + a narrow documented vocabulary, and the model is steered to prefer `edit_text`.

## Verification

- `pnpm build` (strict order) and `npx tsc --noEmit` per touched package.
- Run executor against representative plans: a list/union add, a multi-line function-body rewrite, a new-file create mirroring a sibling, a cross-file type-error self-correction, and a step that's already satisfied (expect `noop`→done, not 4 retries).
- Confirm formatter pass normalizes a deliberately mis-indented `newText`.
- Run a non-TypeScript edit (e.g. a Python or Go file) end-to-end: `edit_text` applies, the language's formatter runs (or skips cleanly), and a `replace_node` on a no-wasm language degrades to `blocked` instead of crashing.
