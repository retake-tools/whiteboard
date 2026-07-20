# Contributing to Retake Whiteboard

Thanks for helping improve Retake Whiteboard. The project is currently focused
on stabilizing the image-stage workflow while keeping the canvas and execution
routes cleanly separated.

## Setup

```bash
npm install
npm run dev
```

The local development server runs at `http://127.0.0.1:18770`.

## Before Changing Code

Identify which object owns the behavior:

- visible board content and placement belong to `Block`;
- stored media metadata and references belong to `AssetRecord`;
- one capability run belongs to `ExecutionRecord`;
- provider-specific behavior belongs to an execution `Adapter`, not the canvas;
- creative process behavior belongs to a `Skill` that binds to capabilities.

Codex/MCP is one execution route. Changes should continue to work when the same
capability is later executed through a direct API or another agent bridge.

## Verification

Run the narrowest relevant checks while developing. Before submitting a change,
run the full gate:

```bash
npm run typecheck
npm run build
npm run mcp:test
git diff --check
```

For changes to the bundled Codex Skill or plugin, also run:

```bash
npm run skill:validate
```

`npm run mcp:test` must remain sequential because its tests share the ignored
`.retake-test/` workspace.

## Safe UI Testing

- Never automate against an existing user Project or Board.
- Create a clearly named disposable Project and Board, record their IDs, verify
  them before the first mutation, and delete only those recorded IDs afterward.
- Do not directly edit `.retake/` snapshot files. Use the UI, local service, or
  MCP tools so snapshot migration and Asset/Execution lineage remain intact.
- Visual or interactive changes should be checked in a real browser in addition
  to contract tests.

## Repository Notes

- Internal planning and research live under ignored `docs/` and `research/`.
- Generated assets, local workspaces, build output, and test workspaces are
  ignored by Git.
- Keep source files focused. Treat 800 lines as a warning and avoid exceeding
  1000 lines without a clear reason and follow-up split plan.
