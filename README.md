# Retake Whiteboard

Retake Whiteboard is an infinite-canvas workspace for Retake video creation
workflows. The current MVP focuses on the image stage of that workflow: image
blocks, annotation-driven image edits, and Codex/MCP writeback.

## Local Development

Install dependencies and start the web app:

```bash
npm install
npm run dev
```

The development server starts at `http://127.0.0.1:18770` by default.

## Local Preview Port

For a stable release-style preview port that is separate from daily
development, use:

```bash
npm run production
```

This runs a production build and starts the local production preview at
`http://127.0.0.1:18771`.

`npm run preview` is kept as the Vite-compatible alias for previewing an
already-built `dist/` directory.

## Codex Plugin

This repository includes a Codex plugin manifest in `.codex-plugin/plugin.json`.
The plugin exposes:

- Retake MCP tools from `.mcp.json`
- the `retake-whiteboard-codex` skill from `skills/`

The MCP server uses stdio and does not require a web port. The web app can run
separately when users want to operate the whiteboard UI.

The plugin is an execution and packaging layer, not the primary product shell.
Retake keeps the standalone web app as the main surface so future direct API,
hosted web, and commercial versions can share the same Project, Board, Asset,
and Execution model. Deeper Codex widget integration should be added only when
it removes concrete user steps such as copying prompts, switching windows, or
manual refreshes.

Before trying the plugin, install dependencies:

```bash
npm install
npm run mcp:test
```

Register this checkout in the default personal Codex marketplace and install
the bundled plugin:

```bash
npm run codex:install
```

Start a new Codex task after installation so the bundled Skill and MCP tools are
loaded. `Codex Managed` is the built-in generation profile and requires no model
provider or API-key configuration. Direct API, ACP, and third-party model
profiles are optional user-local settings and are not distributed with project
defaults.

`npm run mcp:test` uses `.retake-test/` and does not reset the real `.retake/`
workspace.

## Verification

```bash
npm run typecheck
npm run build
npm run mcp:test
npm run skill:validate
```
