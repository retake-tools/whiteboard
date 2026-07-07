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

## Documentation

Internal planning and research documents live under `docs/` and are ignored by
Git. Keep them in Chinese unless there is a concrete external-facing reason to
write English.

Public-facing repository docs can be added later when the product surface is
stable. Do not move internal research, competitor notes, or strategy documents
into tracked public docs without an explicit decision.

## Verification

After code changes, run the narrowest meaningful checks:

```bash
npm run typecheck
npm run build
npm run mcp:test
```

`npm run mcp:test` must run sequentially because tests reset the same local
`.retake/` workspace.

For UI changes, also start the dev server and inspect the canvas manually or
with browser automation when the behavior is visual or interactive.
