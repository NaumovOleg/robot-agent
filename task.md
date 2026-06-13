You are operating inside my TypeScript monorepo.

Your task is to fully redesign and repair my autonomous coding agent graph architecture to production-grade quality.

The current architecture is unstable and produces parser failures, schema drift, invalid edit plans, hallucinated fields, and unreliable repair loops.

Current graph:

User
↓
Planner
↓
Task Graph
↓
Reader agents
↓
Compressed context
↓
Writer agent
↓
Patch generator
↓
Verifier
↓
Repair loop
↓
Git diff

Your mission:
Refactor the entire orchestration system, schemas, prompts, contracts, validators, and node responsibilities so the pipeline becomes deterministic, schema-safe, and production-ready.

CRITICAL REQUIREMENTS

1. STRICT NODE RESPONSIBILITIES

Planner:

- ONLY decomposes tasks
- NEVER writes code
- NEVER invents architecture
- NEVER edits files
- MUST output deterministic task graph

Reader agents:

- ONLY inspect repository
- ONLY extract evidence
- NEVER propose code
- NEVER invent missing files
- NEVER generate edits
- MUST output schema-safe evidence

Compressed context node:

- MUST compress evidence into deterministic machine-readable summaries
- MUST preserve references to original files
- MUST preserve anchors and evidence traces

Writer agent:

- ONLY writes implementation from provided evidence + plan
- MUST NOT infer architecture
- MUST NOT inspect unrelated files
- MUST NOT invent routes/components/files not present in evidence unless explicitly requested

Patch generator:

- Converts edit intent into deterministic unified diff patches
- MUST NOT invent locations
- MUST NOT rewrite unrelated code

Verifier:

- ONLY validates
- NEVER mutates
- MUST run:
  - TypeScript
  - ESLint
  - tests
  - schema validation
  - AST validation

Repair loop:

- MUST consume verifier errors ONLY
- MUST generate minimal fixes
- MUST terminate after bounded retries
- MUST avoid re-planning entire task

2. REDESIGN ALL SCHEMAS

My current schemas are unsafe and allow:

- arrays instead of strings
- nullable drift
- hallucinated fields
- invalid operation hints
- invalid line ranges
- inconsistent status handling
- missing required properties

You must redesign ALL schemas to be:

- deterministic
- minimal
- LLM-safe
- zod-safe
- production-grade

IMPORTANT:
Descriptions MUST remain INSIDE Zod schemas.
Do NOT move contracts into prompts only.

3. FIX CURRENT MAJOR FAILURES

Current issues include:

- lines returned as arrays instead of strings
- operation_hints missing nodeType
- files referenced but not in files_analyzed
- potential_edit_strategy returned during insufficient status
- missing unresolved_questions for insufficient status
- location parsing inconsistencies
- AST/text operation confusion
- excessive nullable/default complexity
- weak cross-field validation
- hallucinated edit operations
- parser failures from schema ambiguity

You must eliminate these failure classes entirely.

4. REQUIRED ARCHITECTURE IMPROVEMENTS

Implement:

- immutable graph state
- strict node contracts
- discriminated unions
- schema versioning
- deterministic enums
- bounded repair loops
- explicit node failure states
- operation-specific schemas
- AST-safe operation contracts
- text-safe operation contracts
- repository evidence tracing
- compact context format
- validation checkpoints after every node

5. REQUIRED OUTPUTS

You must:

- inspect current implementation
- refactor architecture
- rewrite schemas
- rewrite prompts
- rewrite contracts
- improve graph flow
- improve repair loop
- improve parser reliability
- improve determinism
- improve token efficiency

Then generate:

- updated architecture
- updated TypeScript schemas
- updated prompts
- updated validators
- updated graph state types
- updated orchestration flow
- updated retry logic
- updated repair logic
- updated node interfaces

6. IMPLEMENTATION REQUIREMENTS

Use:

- TypeScript
- Zod
- LangGraph patterns
- discriminated unions
- strict parsing
- explicit validation

Prefer:

- small deterministic nodes
- explicit contracts
- schema-first design
- operation-specific types
- minimal nullable fields
- explicit enums
- additive state updates

Avoid:

- giant prompts
- implicit assumptions
- mixed responsibilities
- overloaded schemas
- optional ambiguity
- free-form outputs

7. IMPORTANT CONSTRAINTS

Do NOT:

- create fake abstractions
- over-engineer
- introduce unnecessary frameworks
- generate pseudo-code only

Do:

- produce real implementation-grade code
- directly modify project files
- keep architecture practical
- keep schemas compact and strict
- improve maintainability

8. SPECIFIC SCHEMA REQUIREMENTS

Line ranges:

- MUST always be strings
- format:
  - ""
  - "7"
  - "7-12"

Location format:

- path:line
- path:line:column
- path:line-line
- path:line-line:column

Operation hints:

- MUST use discriminated unions
- AST operations require:
  - nodeType
  - symbol when relevant
- text operations require:
  - anchor
- create_file must NOT require analyzed file existence

Status handling:

- sufficient => potential_edit_strategy REQUIRED
- insufficient/blocked => potential_edit_strategy MUST be null
- insufficient/blocked => unresolved_questions REQUIRED

9. FINAL GOAL

After refactor:

- every node should have deterministic IO
- parser failures should become extremely rare
- repair loop should converge
- schemas should be compact and LLM-safe
- writer should stop hallucinating
- verifier should become authoritative
- edit generation should become traceable to evidence

Now inspect the repository and begin the full refactor.
Start with architecture analysis, then schemas, then contracts, then orchestration, then repair loop improvements.
Do not stop at analysis — directly implement the improvements in the codebase.
