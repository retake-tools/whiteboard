# Retake Whiteboard

[简体中文](./README.zh-CN.md)

Retake Whiteboard is a local-first infinite canvas for visual production. It
combines a free-form Board with a Package and Plugin host, workflow runtime,
Agent workspace, and a shared Asset / Execution / Artifact history.

## Current Release

Retake Whiteboard `0.1.3` includes:

- Project and Board management on a free-form infinite canvas;
- a unified `image.generate` Operation for text-led and source-image-led
  creation, multiple references, one to four results, and reruns;
- the official Image Studio Package with annotation, adjust, crop, resize,
  outpaint, Guided Image Skill, Workflow, and Agent preset;
- Package installation and updates from GitHub source, exact-version caching,
  rollback, isolation, scoped permissions, and Project / Board enablement;
- persistent Workflow Runs, gates, output selection, Artifacts, History, and an
  Agent workspace with Codex App Server and configured Direct API runtimes;
- Codex Plugin and MCP writeback through the same Project, Board, Asset,
  Execution, and Artifact model used by other execution routes.

The official offline bootstrap contains **Image Studio only**. Video Studio is
not bundled or enabled by default in this release; existing installations and
optional GitHub-source installation remain supported. Provider credentials and
paid calls are always user-configured and are not shipped with Whiteboard.

## Requirements

- Node.js 24.18.0 for canonical development, CI, and release builds;
- Node.js 22.12 or later remains a supported compatibility runtime. Node.js 26
  is experimental until it reaches LTS and the Package archive codec is
  runtime-independent;
- npm;
- Codex CLI with Codex Plugin support when using the Codex/MCP route;
- a real image generation or editing capability available to Codex.

The Retake plugin reads Operations, assembles execution context, and writes
results back. It does not provide an image generation model by itself.

## Installation

### Ask Codex to install it (recommended)

Send the following prompt to Codex:

```text
Install the Retake Whiteboard Codex plugin from
https://github.com/retake-tools/whiteboard.git.

Clone the repository into ~/src/retake-whiteboard, run npm install,
then run npm run mcp:test and npm run codex:install.

The codex:install command must build the web app and start its background
production server. After installation, validate the plugin, Skill, MCP tools,
and production server; tell me to open http://127.0.0.1:18771 and whether I
need to start a new Codex task. Do not copy or modify any user data under the
repository's .retake/ directory.
```

This prompt follows the moving `main` release channel. For a reproducible
checkout of this release, clone `v0.1.3` instead:

```bash
git clone --branch v0.1.3 --depth 1 \
  https://github.com/retake-tools/whiteboard.git ~/src/retake-whiteboard
```

This installs the complete plugin, including the Retake Skill and MCP tools.
Copying only the Skill is not enough because Execution, Asset, and result Block
writeback depends on MCP.

`npm run codex:install` builds the app, installs the Codex plugin, and starts a
background production server. When it finishes, open
<http://127.0.0.1:18771>. Keep the checkout and `node_modules` in place so both
the web app and MCP bridge remain available.

Manage the background server from the checkout with:

```bash
npm run production:status
npm run production:restart
npm run production:stop
```

The background server continues after the installing Codex task exits. After a
computer restart, run `npm run production:start` from the checkout if the
server is not available.

### Manual source setup

```bash
mkdir -p ~/src
git clone https://github.com/retake-tools/whiteboard.git ~/src/retake-whiteboard
cd ~/src/retake-whiteboard
npm install
npm run dev
```

Open <http://127.0.0.1:18770>. This is the foreground development server with
live reload; stop it with `Ctrl+C`.

To add the Codex Plugin after a manual source setup, stop the development
server in that terminal, optionally run `npm run mcp:test`, and then run
`npm run codex:install`. The install command switches to the background
production workflow at <http://127.0.0.1:18771>.

The installer registers this checkout in the default personal Codex
marketplace and stages a minimal plugin package. The package contains only the
manifest, MCP configuration, Skill, startup bridge, READMEs and their
screenshots, and license. It does not copy `.retake/` board data, dependencies,
build output, internal research, or test artifacts into the Codex plugin cache.

Keep the repository checkout outside `~/plugins/retake-whiteboard`. That path
is reserved for the installer-managed minimal plugin source package.

The MCP bridge continues to execute from this checkout. Start a new Codex task
after plugin installation to load the new Skill and MCP tools.

## How to Use It

Retake keeps prompts, source images, Operations, generated results, Workflow
Runs, and Agent activity visible around the same Board. Use the Composer or
canvas templates to create an Operation, then run it through Codex App Server,
a configured Direct API runtime, or the manual Codex/MCP route.

### Text to image

Connect a Text Block to a text-to-image Operation, choose the aspect ratio and
result count, then run it through Codex.

Text-to-image and image-to-image are creation templates for the same
`image.generate` capability; the presence of a `source_image` input determines
the execution shape.

![Text-to-image workflow generating a photorealistic oceanfront living room](./assets/readme/text-to-image.jpg)

### Image to image

Connect a source Image Block and an edit prompt to preserve the original
composition while changing the requested visual attributes.

![Image-to-image workflow changing an oceanfront room from golden hour to blue hour](./assets/readme/image-to-image.jpg)

### Annotation edit

Draw numbered markers, arrows, freehand strokes, region brushes, rectangles, or
ellipses directly over the source image. Give each mark its own instruction and
optionally add one global instruction before running the edit.

![Annotation editor with a rectangle, arrow, region brush, and per-mark instructions](./assets/readme/annotation-edit.jpg)

After Codex completes the Operation, the clean source, Annotation Edit
Operation, and generated result remain connected on the canvas. In this
example, the sofa becomes forest-green velvet, the floor lamp moves beside the
sofa, and coral clouds are added without changing the room composition.

![Completed annotation-edit workflow showing the clean source and generated result](./assets/readme/annotation-edit-result.jpg)

## Local Development

Install dependencies and start the web app:

```bash
npm install
npm run dev
```

The development server starts at `http://127.0.0.1:18770` by default.

Board content is stored locally under `.retake/`, which is ignored by Git. Do
not edit snapshot JSON files directly; use the whiteboard UI, local service, or
MCP tools so Asset and Execution lineage stays consistent.

For a stable release-style preview port separate from daily development, use:

```bash
npm run production
```

This builds the app and starts the production preview at
`http://127.0.0.1:18771`. `npm run preview` remains the Vite-compatible alias
for previewing an existing `dist/` directory.

## Codex Workflow

1. Start Retake Whiteboard and create or open a Project and Board.
2. Create an image Operation, choose a Skill or Workflow, or open an Agent
   session.
3. Select a configured runtime. When using manual Codex/MCP, bind the current
   Codex workspace to the exact Project and Board.
4. Launch the Operation or Agent task and review its live status, outputs, and
   any required human gate.
5. Retake records the resulting Assets, Executions, Blocks, Workflow Runs, and
   Artifacts in the same lineage regardless of execution route.

`Codex Managed` is the built-in manual Codex/MCP profile and does not require a
separate provider key inside Retake. Codex App Server and compatible Direct API
connections can also be configured locally. Secrets and paid-provider defaults
are never distributed with a Project or the official Package.

Codex is one execution route, not the Retake backend. The plugin is an
execution route, while the standalone web app remains the main product surface.
Codex App Server, Direct API, and manual MCP execution all converge on the same
Project, Board, Asset, Execution, Workflow Run, and Artifact facts.

## Verification

```bash
npm run typecheck
npm run build
npm run mcp:test
npm run plugin:package:test
npm run production:test
npm run skill:validate
```

`npm run mcp:test` must run sequentially because contract tests share and reset
the ignored `.retake-test/` workspace; it does not reset the real `.retake/`.
Visual or interactive changes should also be tested in a clearly named
disposable Project and Board rather than an existing user Board.

## Architecture Boundaries

- `Block` owns user-visible canvas state and placement.
- `AssetRecord` owns asset metadata and storage references.
- `ExecutionRecord` owns one capability run, including route, status, inputs,
  outputs, provider/model metadata, and errors.
- `Plugin` defines capabilities; an `Adapter` executes them; a `Skill` defines
  compatible creative or process behavior.
- The canvas coordinates workflows but does not own provider-specific logic.

MCP writeback, Codex App Server, and Direct API execution converge on the same
Asset and Execution records.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for repository boundaries,
verification, and safe UI testing guidance.

## License

Retake Whiteboard is available under the
[Apache License 2.0](./LICENSE). Required attribution notices are provided in
[NOTICE](./NOTICE).
