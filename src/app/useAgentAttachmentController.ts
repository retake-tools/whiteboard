import { readFileAsDataUrl, readImageDimensions } from '../core/imageFile';
import type { PackageComposerMention } from '../core/packageComposer';
import type { CanvasHostScopeV1 } from '../host-kit';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

const maxAttachmentBytes = 30 * 1024 * 1024;

interface AgentAttachmentControllerOptions {
  getViewportCenter: () => { x: number; y: number };
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  scope: CanvasHostScopeV1;
}

export function useAgentAttachmentController(
  options: AgentAttachmentControllerOptions,
) {
  async function attachFiles(files: File[]): Promise<PackageComposerMention[]> {
    if (files.length === 0) return [];
    for (const file of files) {
      if (file.size > maxAttachmentBytes) {
        throw new Error(`${file.name} exceeds the 30 MB attachment limit.`);
      }
    }

    if (!options.runProductCommand) {
      throw new Error('Whiteboard Agent attachment command facade is unavailable.');
    }
    const uploads = await Promise.all(files.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file);
      const imageSize = file.type.startsWith('image/')
        ? await readImageDimensions(dataUrl)
        : undefined;
      return {
        dataUrl,
        fileName: file.name,
        height: imageSize?.height,
        width: imageSize?.width,
      };
    }));
    const result = await options.runProductCommand(
      (commands) => commands.agentAttachment.attach({
        placementCenter: options.getViewportCenter(),
        scope: options.scope,
        uploads,
      }),
      { history: true },
    );
    return result.mentions;
  }

  return { attachFiles };
}
