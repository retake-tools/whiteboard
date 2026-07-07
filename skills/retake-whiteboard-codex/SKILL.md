---
name: retake-whiteboard-codex
description: Execute Retake Whiteboard Codex/MCP operation prompts for the image stage of a Retake video workflow board and write generated results back to the board. Use when the user provides a Retake operation prompt with projectId, boardId, executionId, source/result block ids, asset paths, or asks Codex to run a Retake Whiteboard image generation/edit operation through MCP.
---

# Retake Whiteboard Codex

Use this skill to run an existing Retake Whiteboard image-stage operation from Codex and write the result back through Retake MCP tools.

Retake Whiteboard is organized around video creation workflows. Image generation
and annotation-driven image editing are the current MVP stage, not the complete
product scope.

## Core Rule

Retake MCP tools do not generate images. They validate project binding, read execution context, import a final local file, update result blocks, and record success or failure.

Generate or edit the image with the real image capability available in the current Codex environment. If no real image generation/editing capability is available, call `retake_fail_execution`. Do not create mock, placeholder, empty, or annotation-only results.

## Operation Workflow

When the prompt contains an existing `executionId`:

1. Parse these fields from the Retake prompt:
   - `projectId`
   - `boardId`
   - existing `executionId`
   - source image or placeholder `blockId`
   - `result image blockId`
   - source asset local path, when present
   - annotated composite local path, when present
   - target display width and height
   - suggested output file path
   - user instruction
2. Call `retake_validate_project_binding` with `projectId`, `boardId`, and the current workspace path if available.
3. If validation is missing or stale, call `retake_set_project_binding` for the current workspace path.
4. Call `retake_get_execution` with the existing `executionId`.
5. Generate or edit the final image:
   - For `image.generate`, create a new image from the instruction and target aspect ratio.
   - For `image.annotation_edit`, use the clean source asset as the visual base and the annotated composite as the authoritative edit brief.
   - Read visible arrows, freehand marks, rectangles, circles, and text notes from the annotated composite.
   - Do not include annotation text, arrows, selection outlines, UI chrome, or editor controls in the final image.
   - Preserve source composition, subject, aspect ratio, and style unless the instruction asks otherwise.
6. Save the final result to the suggested local output path when possible.
7. Call `retake_import_asset` with:
   - `projectId`
   - `sourcePath` set to the generated local file
   - `sourceExecutionId` set to the existing `executionId`
   - `kind: "image"`
8. Call `retake_update_image_result_block` with:
   - `projectId`
   - `boardId`
   - existing `executionId`
   - imported `assetId`
   - `resultBlockId` set to the result image block id from the prompt
9. If generation or import fails, call `retake_fail_execution` with the existing `executionId` and a concise `errorMessage`.

## Do Not

- Do not call `retake_create_execution` for prompts that already include an existing `executionId`.
- Do not call `retake_create_mock_generated_asset` for user operations.
- Do not edit `.retake/` snapshot JSON directly.
- Do not overwrite, delete, move, or replace the source image block.
- Do not create another result block when the prompt provides a result image block id. The result image block already represents the operation.

## Success Criteria

The operation is complete only when:

- A real generated local image file exists.
- The file is imported into Retake AssetStore.
- The existing Image Result Block is updated with the imported asset.
- The ExecutionRecord status is `succeeded`.
- The result block keeps its lineage edge from the source block.
