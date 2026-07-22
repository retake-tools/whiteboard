# AGENTS.md

This file gives working guidance for AI agents and human contributors working on
Retake Whiteboard.

## Core Principles

Work from first principles. Before adding abstractions, features, or UI, clarify:

- What user problem this solves.
- Which object owns the responsibility.
- Whether the behavior belongs to the canvas, block, plugin, skill, adapter, or
  storage layer.
- Whether the change will still work when the execution route changes from
  Codex/MCP to direct API or another agent bridge.

Prefer a small coherent model over feature-shaped patches. If a change creates
unclear ownership, stop and document the boundary before implementing more code.

## Architecture Boundaries

Keep these boundaries stable:

- `Block` stores user-visible state and board placement.
- `AssetRecord` stores asset metadata and storage references.
- `ExecutionRecord` stores one capability execution, including route, status,
  inputs, outputs, provider/model, and errors.
- `Plugin` defines capabilities.
- `Adapter` defines how a capability is executed.
- `Skill` defines creative/process behavior that can bind to capabilities and
  compatible input/output block types.
- The canvas coordinates workflow but should not own provider-specific logic.

Codex is one execution route, not the product backend. MVP Codex integration
should go through MCP tools and write back into the same Retake data model that
future direct API execution will use.

## File Size And Splitting

Keep files focused. Large files become hard for agents and humans to review.

Guidelines:

- Aim to keep source files under 500 lines when the responsibility is naturally
  narrow.
- Treat 800 lines as a warning threshold. Past that point, actively check
  whether the file is mixing responsibilities or just contains cohesive UI/data
  plumbing.
- Do not let a file exceed 1000 lines without a clear reason and a follow-up
  split plan. File length is a review signal, not an automatic refactor trigger.
- Split by responsibility, not by arbitrary type buckets.
- Prefer small modules with explicit names over broad utility files.

Common split points:

- UI components by visible responsibility.
- Store logic by domain object, such as project, board, asset, execution, skill.
- MCP tools by resource group when the server grows.
- Adapter implementations by execution route or provider.
- Pure data conversion helpers separate from side-effecting filesystem/API code.

## Implementation Style

Use the existing project shape before introducing new patterns.

- Keep data schemas explicit and stable.
- Prefer typed functions over loosely shaped objects.
- Avoid provider-specific fields in generic Block or Asset schemas unless the
  field is truly portable.
- Do not make UI layout decisions inside storage or execution code.
- Do not directly edit `.retake/` snapshot files from agents; use local service
  functions or MCP tools.
- Keep generated assets in the AssetStore flow before creating result blocks.
- Keep the local Codex plugin package whitelist-based. Never point the installed
  plugin source at the repository root: local installation copies that source
  into the Codex cache and could otherwise include ignored `.retake/` user data,
  dependencies, logs, or internal research. Run `npm run plugin:package:test`
  after changing plugin packaging or installation scripts.

## Branch And Delivery Workflow

Treat `main` as the public release branch and `develop` as the stable development
integration branch.

- Do not commit feature work directly on `main` or push ordinary development
  commits to it. Only merge a verified release from `develop` after the user has
  explicitly confirmed that the complete release scope should ship.
- Start feature work from an up-to-date `develop` on a dedicated branch.
  Agent-created branches should use `codex/<feature>` by default.
- It is acceptable to commit and push incomplete work to its feature branch,
  but do not merge partially implemented or partially verified work into
  `develop`.
- Merge a feature into `develop` only after its coherent scope is complete, the
  relevant verification has passed, and product status documentation is
  current. Keep `develop` usable as the base for the next feature.
- Prepare a public release by verifying the complete integrated state on
  `develop`, obtaining explicit user approval, then merging `develop` into
  `main` and pushing `main`.
- For an urgent public hotfix, branch from `main`, verify the narrow fix, merge
  it into `main` only with explicit user approval, and merge the same fix back
  into `develop` before starting dependent work.

## Documentation

Internal planning and research documents live under `docs/` and are ignored by
Git. Keep them in Chinese unless there is a concrete external-facing reason to
write English.

Keep the project status indexes current when work changes product scope or
delivery status:

- Update `docs/product/handoff.zh.md` when priorities, blockers, repository
  handoff state, or recently completed work changes.
- When a user-visible capability becomes complete, update the matching section
  in `docs/product/completed-features.zh.md` before moving the item from the
  handoff priority list to "recently completed."
- Keep the handoff bounded: retain at most six recently completed items or
  fourteen days of work, whichever limit is reached first. Use Git history for
  older chronology, and treat the completed-features document as a capability
  index rather than a changelog.
- Link to detailed `docs/` or `research/` files instead of duplicating their
  contents. Because these files are ignored, inspect them directly instead of
  relying on Git status.

Public-facing repository docs can be added later when the product surface is
stable. Do not move internal research, competitor notes, or strategy documents
into tracked public docs without an explicit decision.

## Verification

### Test data safety

Never run automated browser interaction, destructive verification, or MCP test
setup against a user board.

- Browser/UI automation that may move the viewport, drag, edit, execute, delete,
  or autosave must first create and switch to a clearly named disposable board,
  such as `[TEST] annotation-hover 2026-07-19`.
- Do not reuse the default board or any board containing user-generated assets,
  executions, or history for automated interaction tests. Read-only inspection
  of a user board is allowed only when the test cannot trigger persistence.
- Service and MCP tests must set `RETAKE_WORKSPACE_DIR=.retake-test` (or another
  disposable directory) and must never call reset/delete operations against the
  real `.retake/` workspace.
- Before browser automation, record the disposable projectId and boardId and
  verify them again before the first mutating action. Delete test data only when
  it is known to be disposable; do not clean up user boards by inference.

After code changes, run the narrowest meaningful checks:

```bash
npm run typecheck
npm run build
npm run mcp:test
npm run plugin:package:test
```

`npm run mcp:test` must run sequentially because tests reset the same local
`.retake/` workspace.

For UI changes or browser verification, first check whether the development
server responds at `http://127.0.0.1:18770`. Reuse it when it is healthy; when
it is not running, start `npm run dev` before opening or testing the page. Do
not start a duplicate server merely because a new agent turn or task began.
Then inspect the canvas manually or with browser automation when the behavior
is visual or interactive.
