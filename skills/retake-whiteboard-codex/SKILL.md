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
   - `operation blockId`
   - one or more `result image blockId` assignments
   - source asset local path, when present
   - annotated composite local path, when present
   - target display width and height
   - suggested output file path
   - user instruction
   - image input assignments, including each image's `blockId`, `assetId`, local path, and explicit `inputRole`
2. Call `retake_validate_project_binding` with `projectId`, `boardId`, and the current workspace path if available.
3. If validation is missing or stale, call `retake_set_project_binding` for the current workspace path.
4. Call `retake_get_execution` with the existing `executionId`.
5. Immediately before image generation or subagent spawning, call `retake_mark_execution_running` with the existing `executionId` so the board reflects active work for the entire generation period.
   - A failed Execution with one or more incomplete assigned Result Blocks is resumable. Calling `retake_mark_execution_running` resumes the same Execution and keeps already successful Result Blocks unchanged.
   - When resuming, generate and update only the incomplete assigned Result Blocks unless the user explicitly asks to replace successful outputs.
6. Generate or edit the final image or image variants:
   - For `image.text_to_image`, create a new image from the connected Text Block prompt and target aspect ratio.
   - For `image.image_to_image`, edit or reinterpret the connected Image Block using the connected Text Block prompt.
   - For `image.annotation_edit`, use the clean source asset as the visual base and the annotated composite as the authoritative edit brief.
   - Read visible marker pins, arrows, freehand brush strokes, rectangles, and circles from the annotated composite.
   - Do not include annotation text, arrows, selection outlines, UI chrome, or editor controls in the final image.
   - Preserve source composition, subject, aspect ratio, and style unless the instruction asks otherwise.
   - When multiple result block assignments are present, spawn one subagent per variant when subagent image generation is available.
   - Give each subagent exactly one output path and one `resultBlockId`.
   - As soon as any subagent returns a usable result, immediately import that file and update its assigned Result Block. Do not wait for the remaining variants before writing back a completed one.
   - Wait for all subagents before ending the task, but let the multi-result Execution remain `running` while only some Result Blocks have been updated.
   - When spawning with a full-history fork, omit explicit agent type, model, and reasoning overrides. Otherwise omit the full-history fork before selecting those overrides.
   - If subagent image generation is unavailable, generate the variants sequentially in the current task.
   - Variants must be meaningfully distinct while following the same instruction. Do not reuse one generated asset for multiple result blocks.
   - Treat the structured image input Role assignments as authoritative. The user instruction may refine how an image is used within its selected Role, but must not silently reassign it.
   - Pass every assigned image and its Role-specific directive to the image generation/editing capability. Do not collapse multiple Role assignments into an unstructured reference list.
7. Save each final result to its assigned local output path when possible. Process results in completion order rather than assignment order.
8. As soon as each result is ready, call `retake_import_asset` with:
   - `projectId`
   - `sourcePath` set to the generated local file
   - `sourceExecutionId` set to the existing `executionId`
   - `kind: "image"`
9. Immediately after each import, call `retake_update_image_result_block` with:
   - `projectId`
   - `boardId`
   - existing `executionId`
   - imported `assetId`
   - `resultBlockId` set to that result's assigned image block id from the prompt
   - Continue until every assigned result block is updated. A multi-result execution remains `running` after partial writeback and becomes `succeeded` only when every output is present.
10. If generation or import fails, call `retake_fail_execution` with the existing `executionId` and a concise `errorMessage`.

## Do Not

- Do not call `retake_create_execution` for prompts that already include an existing `executionId`.
- Do not call `retake_create_mock_generated_asset` for user operations.
- Do not edit `.retake/` snapshot JSON directly.
- Do not overwrite, delete, move, or replace the source image block.
- Do not create another result block when the prompt provides result image block ids. Those result blocks already represent the operation outputs.

## Success Criteria

The operation is complete only when:

- A real generated local image file exists for every assigned output.
- Every file is imported into Retake AssetStore.
- Every existing Image Result Block is updated with its assigned imported asset.
- The ExecutionRecord status is `succeeded`.
- The result block keeps its `execution_output` edge from the Operation Block.
- The source/input block keeps its `execution_input` edge into the Operation Block.
