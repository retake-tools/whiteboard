import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

export type Locale = 'en' | 'zh';

type TranslationKey =
  | 'autosave.error'
  | 'autosave.idle'
  | 'autosave.saved'
  | 'autosave.saving'
  | 'block.image.body'
  | 'block.image.title'
  | 'block.operation.body'
  | 'block.operation.executorCodexMcp'
  | 'block.operation.kind'
  | 'block.operation.prompt'
  | 'block.operation.title'
  | 'block.group.body'
  | 'block.group.title'
  | 'block.text.body'
  | 'block.text.title'
  | 'block.video.body'
  | 'block.videoPlaceholder'
  | 'block.video.title'
  | 'configuration.capability'
  | 'configuration.initial'
  | 'configuration.input'
  | 'configuration.noChanges'
  | 'configuration.parameter'
  | 'configuration.pendingExecution'
  | 'configuration.profile'
  | 'configuration.prompt'
  | 'configuration.role'
  | 'canvas.tools'
  | 'codex.binding.connected'
  | 'codex.binding.connect'
  | 'common.dismiss'
  | 'context.adjust'
  | 'context.addArrow'
  | 'context.arrowTool'
  | 'context.annotateForCodex'
  | 'context.annotateEdit'
  | 'context.annotationNotePlaceholder'
  | 'context.annotationSourceMissing'
  | 'context.annotationTools'
  | 'context.addReferenceImage'
  | 'context.aspectRatio'
  | 'context.brightness'
  | 'context.annotationNoteMode'
  | 'context.clearMarks'
  | 'context.clearMarksConfirm'
  | 'context.colorPalette'
  | 'context.close'
  | 'context.contrast'
  | 'context.createSimilar'
  | 'context.crop'
  | 'context.deleteMark'
  | 'context.describeChange'
  | 'context.downloadImage'
  | 'context.ellipseTool'
  | 'context.eraserTool'
  | 'context.expand'
  | 'context.executionRoute'
  | 'context.executionRouteCodexMcp'
  | 'context.free'
  | 'context.generatePromptPlaceholder'
  | 'context.globalInstruction'
  | 'context.globalInstructionPlaceholder'
  | 'context.customSize'
  | 'context.height'
  | 'context.markColor'
  | 'context.markIntents'
  | 'context.markIntentPlaceholder'
  | 'context.markerTool'
  | 'context.missingMarkIntent'
  | 'context.more'
  | 'context.moreTools'
  | 'context.multiAngle'
  | 'context.noMarks'
  | 'context.penTool'
  | 'context.quickEdit'
  | 'context.replaceImage'
  | 'context.referenceImage'
  | 'context.referenceImages'
  | 'context.referenceImagesEmpty'
  | 'context.redoAnnotation'
  | 'context.recentColors'
  | 'context.rectangleTool'
  | 'context.removeReferenceImage'
  | 'context.resolution'
  | 'context.relight'
  | 'context.removeBackground'
  | 'context.regionBrushTool'
  | 'context.renderTextMode'
  | 'context.runWithCodex'
  | 'context.run'
  | 'context.saturation'
  | 'context.selectMarkTool'
  | 'context.selectedTools'
  | 'context.strokeSize'
  | 'context.textMarkTool'
  | 'context.textContent'
  | 'context.undoAnnotation'
  | 'context.unavailable'
  | 'context.executionInstructionPreview'
  | 'context.width'
  | 'context.pixels'
  | 'feedback.closePrompt'
  | 'feedback.copied'
  | 'feedback.configurationRestored'
  | 'feedback.configurationRestoreMissingAssets'
  | 'feedback.configurationRestoreUnavailable'
  | 'feedback.copyPrompt'
  | 'feedback.promptTitle'
  | 'feedback.taskCreated'
  | 'feedback.taskCreatedCopyFailed'
  | 'feedback.taskCreatedCopied'
  | 'feedback.handoffUnavailable'
  | 'feedback.inputRequired'
  | 'feedback.executionCanceled'
  | 'feedback.queuedExecutionCanceled'
  | 'feedback.runningExecutionCanceled'
  | 'feedback.runningExecutionCancelConfirm'
  | 'feedback.promptRequired'
  | 'feedback.promptRequiredBody'
  | 'feedback.localApiUnavailable'
  | 'feedback.localEditCompleted'
  | 'feedback.localEditFailed'
  | 'history.close'
  | 'history.collapse'
  | 'history.empty'
  | 'history.assetImported'
  | 'history.assetReplaced'
  | 'history.configurationRestored'
  | 'history.execution'
  | 'history.executionFailed'
  | 'history.executionCanceled'
  | 'history.executionStarted'
  | 'history.executionSucceeded'
  | 'history.locateBlock'
  | 'history.open'
  | 'history.expand'
  | 'history.promptCopied'
  | 'history.promptCopiedSubtitle'
  | 'history.resultUpdated'
  | 'history.title'
  | 'group.background'
  | 'group.assetId'
  | 'group.blockId'
  | 'group.browse'
  | 'group.browserTitle'
  | 'group.closeBrowser'
  | 'group.collapse'
  | 'group.color.blue'
  | 'group.color.green'
  | 'group.color.neutral'
  | 'group.color.rose'
  | 'group.color.transparent'
  | 'group.color.yellow'
  | 'group.defaultTitle'
  | 'group.descendants'
  | 'group.deleteConfirm'
  | 'group.deleteContents'
  | 'group.dimensions'
  | 'group.directItems'
  | 'group.downloadAssets'
  | 'group.downloadStarted'
  | 'group.drawHint'
  | 'group.executionResults'
  | 'group.expand'
  | 'group.fit'
  | 'group.items'
  | 'group.inheritedLocked'
  | 'group.kind'
  | 'group.kind.execution_results'
  | 'group.kind.manual'
  | 'group.kind.workflow'
  | 'group.layout'
  | 'group.layoutFree'
  | 'group.layoutGrid'
  | 'group.layoutRow'
  | 'group.lock'
  | 'group.lockContainer'
  | 'group.lockContainerDescription'
  | 'group.lockContents'
  | 'group.lockContentsDescription'
  | 'group.media'
  | 'group.mediaInfo'
  | 'group.mimeType'
  | 'group.noMedia'
  | 'group.summary'
  | 'group.title'
  | 'group.tools'
  | 'group.ungroup'
  | 'language.label'
  | 'language.english'
  | 'language.chinese'
  | 'inspector.adapter'
  | 'inspector.annotatedComposite'
  | 'inspector.annotationText'
  | 'inspector.capability'
  | 'inspector.close'
  | 'inspector.closePreview'
  | 'inspector.currentDraftChanges'
  | 'inspector.executionId'
  | 'inspector.failureRecovery'
  | 'inspector.activity.started'
  | 'inspector.activity.failed'
  | 'inspector.activity.resumed'
  | 'inspector.activity.result_updated'
  | 'inspector.activity.succeeded'
  | 'inspector.generator'
  | 'inspector.imageComparison'
  | 'inspector.inputAssets'
  | 'inspector.nextPreview'
  | 'inspector.none'
  | 'inspector.openDetails'
  | 'inspector.pendingConfiguration'
  | 'inspector.outputAssets'
  | 'inspector.previousPreview'
  | 'inspector.prompt'
  | 'inspector.restoreConfiguration'
  | 'inspector.skill'
  | 'inspector.source'
  | 'inspector.status'
  | 'inspector.title'
  | 'inspector.versionChanges'
  | 'operation.createSimilar.prompt'
  | 'operation.createSimilar.title'
  | 'operation.generateImage.prompt'
  | 'operation.generateImage.title'
  | 'operation.annotationEdit.prompt'
  | 'operation.annotationEdit.title'
  | 'operation.quickEdit.prompt'
  | 'operation.quickEdit.title'
  | 'operationToolbar.capability'
  | 'operationToolbar.codexMcpHint'
  | 'operationToolbar.count'
  | 'operationToolbar.duration'
  | 'operationToolbar.executor'
  | 'operationToolbar.generatePrompt'
  | 'operationToolbar.generateAgain'
  | 'operationToolbar.generator'
  | 'operationToolbar.localProcessing'
  | 'operationToolbar.imageInputMissing'
  | 'operationToolbar.imageAssetMissing'
  | 'operationToolbar.model'
  | 'operationToolbar.motion'
  | 'operationToolbar.params'
  | 'operationToolbar.parameterBestEffort'
  | 'operationToolbar.parameterSupported'
  | 'operationToolbar.prompt'
  | 'operationToolbar.promptPlaceholder'
  | 'operationToolbar.singleResultHint'
  | 'operationToolbar.strength'
  | 'operationToolbar.sourceAspectRatio'
  | 'operationToolbar.sourceImageMissing'
  | 'operationToolbar.running'
  | 'operationToolbar.textInputMissing'
  | 'operationToolbar.title'
  | 'operationInputQuickAdd.add'
  | 'operationInputQuickAdd.addImage'
  | 'operationInputQuickAdd.addText'
  | 'operationInputQuickAdd.addVideo'
  | 'operationInputQuickAdd.image'
  | 'operationInputQuickAdd.text'
  | 'operationInputQuickAdd.title'
  | 'operationInputRole.annotated_composite'
  | 'operationInputRole.change'
  | 'operationInputRole.character_reference'
  | 'operationInputRole.choose'
  | 'operationInputRole.imagePickerDescription'
  | 'operationInputRole.imagePickerTitle'
  | 'operationInputRole.noImages'
  | 'operationInputRole.pickerDescription'
  | 'operationInputRole.pickerTitle'
  | 'operationInputRole.remove'
  | 'operationInputRole.required'
  | 'operationInputRole.roleLimitReached'
  | 'operationStatus.canceled'
  | 'operationStatus.failed'
  | 'operationStatus.succeeded'
  | 'operationStatus.modified'
  | 'operationStatus.changes'
  | 'operationStatus.executionContentUpdated'
  | 'operationToolbar.updatePrompt'
  | 'operationInputRole.first_frame'
  | 'operationInputRole.last_frame'
  | 'operationInputRole.source'
  | 'operationInputRole.style_reference'
  | 'operationInputRole.annotated_composite.title'
  | 'operationInputRole.annotated_composite.description'
  | 'operationInputRole.character_reference.title'
  | 'operationInputRole.character_reference.description'
  | 'operationInputRole.composition_reference.title'
  | 'operationInputRole.composition_reference.description'
  | 'operationInputRole.control_image.title'
  | 'operationInputRole.control_image.description'
  | 'operationInputRole.depth_map.title'
  | 'operationInputRole.depth_map.description'
  | 'operationInputRole.edge_map.title'
  | 'operationInputRole.edge_map.description'
  | 'operationInputRole.environment_reference.title'
  | 'operationInputRole.environment_reference.description'
  | 'operationInputRole.first_frame.title'
  | 'operationInputRole.first_frame.description'
  | 'operationInputRole.general_reference.title'
  | 'operationInputRole.general_reference.description'
  | 'operationInputRole.inpaint_mask.title'
  | 'operationInputRole.inpaint_mask.description'
  | 'operationInputRole.last_frame.title'
  | 'operationInputRole.last_frame.description'
  | 'operationInputRole.object_reference.title'
  | 'operationInputRole.object_reference.description'
  | 'operationInputRole.pose_reference.title'
  | 'operationInputRole.pose_reference.description'
  | 'operationInputRole.source.title'
  | 'operationInputRole.source.description'
  | 'operationInputRole.style_reference.title'
  | 'operationInputRole.style_reference.description'
  | 'operation.waitingBody'
  | 'projectBoard.addBoard'
  | 'projectBoard.addProject'
  | 'projectBoard.boardActions'
  | 'projectBoard.boardsTitle'
  | 'projectBoard.cancel'
  | 'projectBoard.confirm'
  | 'projectBoard.confirmDeleteBoard'
  | 'projectBoard.confirmDeleteProject'
  | 'projectBoard.create'
  | 'projectBoard.copyBoard'
  | 'projectBoard.delete'
  | 'projectBoard.menuTitle'
  | 'projectBoard.newBoardName'
  | 'projectBoard.newProjectName'
  | 'projectBoard.projectActions'
  | 'projectBoard.projectsTitle'
  | 'projectBoard.pin'
  | 'projectBoard.rename'
  | 'projectBoard.renameBoard'
  | 'projectBoard.renameProject'
  | 'projectBoard.switchBoard'
  | 'projectBoard.unpin'
  | 'settings.keyboardShortcuts'
  | 'settings.generationProfiles'
  | 'settings.generationProfileBuiltin'
  | 'settings.generationProfileDefault'
  | 'settings.language'
  | 'settings.preferences'
  | 'settings.shortcutClose'
  | 'settings.shortcutRedo'
  | 'settings.shortcutUndo'
  | 'settings.showGrid'
  | 'settings.showGridDescription'
  | 'settings.switchLanguageTo'
  | 'settings.theme'
  | 'settings.themePlanned'
  | 'settings.title'
  | 'result.retryCodex'
  | 'result.retryPromptTitle'
  | 'status.failed'
  | 'status.canceled'
  | 'status.queued'
  | 'status.running'
  | 'status.succeeded'
  | 'toolbar.addImage'
  | 'toolbar.addGroup'
  | 'toolbar.addOperation'
  | 'toolbar.addText'
  | 'toolbar.addVideo'
  | 'toolbar.basicElements'
  | 'toolbar.boardMenu'
  | 'toolbar.deleteSelection'
  | 'toolbar.duplicateSelection'
  | 'toolbar.fitView'
  | 'toolbar.firstLastFrameVideo'
  | 'toolbar.hideMiniMap'
  | 'toolbar.imageCreation'
  | 'toolbar.imageToImage'
  | 'toolbar.imageToVideo'
  | 'toolbar.menu'
  | 'toolbar.moreSettings'
  | 'toolbar.multiImageToImage'
  | 'toolbar.panTool'
  | 'toolbar.redo'
  | 'toolbar.refreshBoard'
  | 'toolbar.selectTool'
  | 'toolbar.showMiniMap'
  | 'toolbar.styleTransfer'
  | 'toolbar.textToImage'
  | 'toolbar.textToVideo'
  | 'toolbar.undo'
  | 'toolbar.videoCreation'
  | 'toolbar.viewportControls'
  | 'toolbar.zoomIn'
  | 'toolbar.zoomLevel'
  | 'toolbar.zoomOut';

type Translations = Record<TranslationKey, string>;

const STORAGE_KEY = 'retake.locale';

const translations: Record<Locale, Translations> = {
  en: {
    'autosave.error': 'Autosave failed',
    'autosave.idle': 'Autosave is ready',
    'autosave.saved': 'All changes saved locally',
    'autosave.saving': 'Saving locally',
    'block.image.body': 'Import or generate an asset to attach assetId.',
    'block.image.title': 'Image block',
    'block.operation.body': 'Choose capability, inputs, and execution adapter.',
    'block.operation.executorCodexMcp': 'Codex MCP',
    'block.operation.kind': 'Operation',
    'block.operation.prompt': 'Prompt',
    'block.operation.title': 'New operation',
    'block.group.body': 'Group related inputs, operations, and results.',
    'block.group.title': 'Group',
    'block.text.body': 'Prompt, script note, reference, or story fragment.',
    'block.text.title': 'Text block',
    'block.video.body': 'Video preview should load lazily in later spikes.',
    'block.videoPlaceholder': 'Video asset placeholder',
    'block.video.title': 'Video block',
    'configuration.capability': 'Capability',
    'configuration.initial': 'Initial',
    'configuration.input': 'Images',
    'configuration.noChanges': 'No configuration changes',
    'configuration.parameter': 'Params',
    'configuration.pendingExecution': 'Pending',
    'configuration.profile': 'Generator',
    'configuration.prompt': 'Prompt',
    'configuration.role': 'Roles',
    'canvas.tools': 'Canvas tools',
    'codex.binding.connected': 'Copy Codex binding prompt for this board',
    'codex.binding.connect': 'Copy Codex binding prompt and connect this board',
    'common.dismiss': 'Dismiss',
    'context.adjust': 'Adjust',
    'context.addArrow': 'Add arrow',
    'context.arrowTool': 'Arrow',
    'context.annotateForCodex': 'Annotation Edit',
    'context.annotateEdit': 'Annotate edit',
    'context.annotationNotePlaceholder': 'Describe the marked change for this image...',
    'context.annotationSourceMissing': 'Attach or generate an image asset before annotating.',
    'context.annotationTools': 'Annotation tools',
    'context.addReferenceImage': 'Add reference',
    'context.aspectRatio': 'Aspect ratio',
    'context.brightness': 'Brightness',
    'context.annotationNoteMode': 'Annotation note',
    'context.clearMarks': 'Clear all marks',
    'context.clearMarksConfirm': 'Clear all annotations? This cannot be undone except by annotation undo.',
    'context.colorPalette': 'Annotation color palette',
    'context.close': 'Close',
    'context.contrast': 'Contrast',
    'context.createSimilar': 'Create similar',
    'context.crop': 'Crop',
    'context.deleteMark': 'Delete',
    'context.describeChange': 'Describe the change...',
    'context.downloadImage': 'Download image',
    'context.ellipseTool': 'Ellipse',
    'context.eraserTool': 'Eraser',
    'context.expand': 'Expand',
    'context.executionRoute': 'Executor',
    'context.executionRouteCodexMcp': 'Codex MCP',
    'context.free': 'Free',
    'context.generatePromptPlaceholder': 'Describe the image to generate...',
    'context.globalInstruction': 'Global instruction',
    'context.globalInstructionPlaceholder': 'Optional requirements shared by all marks...',
    'context.customSize': 'Output size',
    'context.height': 'H',
    'context.markColor': 'Color',
    'context.markIntents': 'Mark instructions',
    'context.markIntentPlaceholder': 'Describe what should change here...',
    'context.markerTool': 'Numbered marker',
    'context.missingMarkIntent': 'Add instructions for',
    'context.more': 'More',
    'context.moreTools': 'More image tools',
    'context.multiAngle': 'Multi-angle',
    'context.noMarks': 'Add a mark on the image, then describe the change here.',
    'context.penTool': 'Pen',
    'context.quickEdit': 'Quick edit',
    'context.replaceImage': 'Replace image',
    'context.referenceImage': 'Reference image',
    'context.referenceImages': 'Reference images',
    'context.referenceImagesEmpty': 'No reference images',
    'context.redoAnnotation': 'Redo annotation',
    'context.recentColors': 'Recent colors',
    'context.rectangleTool': 'Rectangle',
    'context.removeReferenceImage': 'Remove',
    'context.resolution': 'Quality',
    'context.relight': 'Relight',
    'context.removeBackground': 'Remove background',
    'context.regionBrushTool': 'Region brush',
    'context.renderTextMode': 'Render in final image',
    'context.runWithCodex': 'Run with Codex',
    'context.run': 'Run',
    'context.saturation': 'Saturation',
    'context.selectMarkTool': 'Select mark',
    'context.selectedTools': 'Selected block tools',
    'context.strokeSize': 'Stroke',
    'context.textMarkTool': 'Text note',
    'context.textContent': 'Text content',
    'context.undoAnnotation': 'Undo annotation',
    'context.unavailable': 'Not available yet',
    'context.executionInstructionPreview': 'Execution instruction preview',
    'context.width': 'W',
    'context.pixels': 'PX',
    'feedback.closePrompt': 'Close prompt preview',
    'feedback.copied': 'Copied',
    'feedback.configurationRestored': 'Version configuration restored',
    'feedback.configurationRestoreMissingAssets': 'Missing assets:',
    'feedback.configurationRestoreUnavailable': 'This version cannot be restored',
    'feedback.copyPrompt': 'Copy prompt',
    'feedback.promptTitle': 'Codex prompt',
    'feedback.taskCreated': 'Codex operation created',
    'feedback.taskCreatedCopyFailed': 'Prompt preview is ready, but clipboard copy failed.',
    'feedback.taskCreatedCopied': 'Prompt copied. Continue in Codex to generate the result.',
    'feedback.handoffUnavailable': 'Codex handoff unavailable',
    'feedback.inputRequired': 'Complete the operation inputs',
    'feedback.executionCanceled': 'Execution canceled',
    'feedback.queuedExecutionCanceled': 'The queued execution and all result placeholders were removed.',
    'feedback.runningExecutionCanceled': 'Writeback was canceled. Codex generation may continue outside Retake.',
    'feedback.runningExecutionCancelConfirm': 'Codex has already started this execution. Cancel it and remove all result placeholders? Generation may continue in Codex, but Retake will reject writeback.',
    'feedback.promptRequired': 'Prompt required',
    'feedback.promptRequiredBody': 'Enter a prompt before running this operation.',
    'feedback.localApiUnavailable': 'The shared Retake workspace is unavailable. Open this board from the Retake dev or preview server, then try again.',
    'feedback.localEditCompleted': 'Adjusted image created',
    'feedback.localEditFailed': 'Local image adjustment failed',
    'history.close': 'Close history',
    'history.collapse': 'Collapse details',
    'history.empty': 'No history yet',
    'history.assetImported': 'Asset imported',
    'history.assetReplaced': 'Image replaced',
    'history.configurationRestored': 'Version configuration restored',
    'history.execution': 'Execution',
    'history.executionFailed': 'Execution failed',
    'history.executionCanceled': 'Execution canceled',
    'history.executionStarted': 'Execution started',
    'history.executionSucceeded': 'Execution succeeded',
    'history.locateBlock': 'Locate block',
    'history.open': 'Board history',
    'history.expand': 'Expand details',
    'history.promptCopied': 'Prompt copied',
    'history.promptCopiedSubtitle': 'Prompt copied for reuse',
    'history.resultUpdated': 'Result updated',
    'history.title': 'History',
    'group.background': 'Group background',
    'group.assetId': 'Asset ID',
    'group.blockId': 'Block ID',
    'group.browse': 'Browse group media',
    'group.browserTitle': 'Group browser',
    'group.closeBrowser': 'Close group browser',
    'group.collapse': 'Collapse group',
    'group.color.blue': 'Blue background',
    'group.color.green': 'Green background',
    'group.color.neutral': 'Neutral background',
    'group.color.rose': 'Rose background',
    'group.color.transparent': 'Transparent background',
    'group.color.yellow': 'Yellow background',
    'group.defaultTitle': 'Group',
    'group.descendants': 'All items',
    'group.deleteConfirm': 'Delete this group and all of its contents?',
    'group.deleteContents': 'Delete group and contents',
    'group.dimensions': 'Dimensions',
    'group.directItems': 'Direct items',
    'group.downloadAssets': 'Download all original assets',
    'group.downloadStarted': 'original asset downloads started',
    'group.drawHint': 'Drag on the canvas to draw a group. Press Esc to cancel.',
    'group.executionResults': 'Execution results',
    'group.expand': 'Expand group',
    'group.fit': 'Fit group to contents',
    'group.items': 'items',
    'group.inheritedLocked': 'Locked by parent group',
    'group.kind': 'Group type',
    'group.kind.execution_results': 'Execution results',
    'group.kind.manual': 'Manual group',
    'group.kind.workflow': 'Workflow',
    'group.layout': 'Arrange group',
    'group.layoutFree': 'Free layout',
    'group.layoutGrid': 'Grid layout',
    'group.layoutRow': 'Row layout',
    'group.lock': 'Group locks',
    'group.lockContainer': 'Lock container',
    'group.lockContainerDescription': 'Prevent direct moving, resizing, ungrouping, and deletion. Parent groups still carry it.',
    'group.lockContents': 'Lock contents',
    'group.lockContentsDescription': 'Prevent descendants from moving, editing, deleting, or reconnecting.',
    'group.media': 'Media',
    'group.mediaInfo': 'Current media',
    'group.mimeType': 'File type',
    'group.noMedia': 'This group has no image or video assets.',
    'group.summary': 'Group information',
    'group.title': 'Group title',
    'group.tools': 'Group tools',
    'group.ungroup': 'Ungroup',
    'language.label': 'Language',
    'language.english': 'English',
    'language.chinese': '中文',
    'inspector.adapter': 'Adapter',
    'inspector.annotatedComposite': 'Annotated brief',
    'inspector.annotationText': 'Annotation notes',
    'inspector.capability': 'Capability',
    'inspector.close': 'Close inspector',
    'inspector.closePreview': 'Close preview',
    'inspector.currentDraftChanges': 'Current draft changes',
    'inspector.executionId': 'Execution ID',
    'inspector.failureRecovery': 'Failure and retry',
    'inspector.activity.started': 'Execution started',
    'inspector.activity.failed': 'Result failed',
    'inspector.activity.resumed': 'Failed result retried',
    'inspector.activity.result_updated': 'Result written back',
    'inspector.activity.succeeded': 'Execution completed',
    'inspector.generator': 'Generator',
    'inspector.imageComparison': 'Image brief',
    'inspector.inputAssets': 'Input assets',
    'inspector.nextPreview': 'Next image',
    'inspector.none': 'None',
    'inspector.openDetails': 'Show execution details',
    'inspector.pendingConfiguration': 'Pending configuration',
    'inspector.outputAssets': 'Output assets',
    'inspector.previousPreview': 'Previous image',
    'inspector.prompt': 'Prompt',
    'inspector.restoreConfiguration': 'Restore this version',
    'inspector.skill': 'Skill',
    'inspector.source': 'Source',
    'inspector.status': 'Status',
    'inspector.title': 'Execution',
    'inspector.versionChanges': 'Changes in this version',
    'operation.createSimilar.prompt': 'Create similar image',
    'operation.createSimilar.title': 'Create similar image',
    'operation.generateImage.prompt': 'Generate image from prompt',
    'operation.generateImage.title': 'Text to image',
    'operation.annotationEdit.prompt': 'Edit image from annotation note',
    'operation.annotationEdit.title': 'Annotation Edit',
    'operation.quickEdit.prompt': 'Describe how to transform the source image...',
    'operation.quickEdit.title': 'Image to image',
    'operationToolbar.capability': 'Capability',
    'operationToolbar.codexMcpHint': 'Codex MCP',
    'operationToolbar.count': 'Count',
    'operationToolbar.duration': 'Duration',
    'operationToolbar.executor': 'Executor',
    'operationToolbar.generatePrompt': 'Generate prompt',
    'operationToolbar.generateAgain': 'Generate again',
    'operationToolbar.generator': 'Generator',
    'operationToolbar.localProcessing': 'Local processing',
    'operationToolbar.imageInputMissing': 'Connect an Image Block to provide the source image.',
    'operationToolbar.imageAssetMissing': 'Import an image into the connected Image Block.',
    'operationToolbar.model': 'Model',
    'operationToolbar.motion': 'Motion',
    'operationToolbar.params': 'Params',
    'operationToolbar.parameterBestEffort': 'Best effort',
    'operationToolbar.parameterSupported': 'Supported',
    'operationToolbar.prompt': 'Prompt',
    'operationToolbar.promptPlaceholder': 'Describe what this operation should generate or change...',
    'operationToolbar.singleResultHint': 'Current execution writes back one result block.',
    'operationToolbar.strength': 'Strength',
    'operationToolbar.sourceAspectRatio': 'Source ratio',
    'operationToolbar.sourceImageMissing': 'Choose one connected image as the source.',
    'operationToolbar.running': 'Running',
    'operationToolbar.textInputMissing': 'Connect a Text Block to provide the prompt.',
    'operationToolbar.title': 'Operation tools',
    'operationInputQuickAdd.add': 'Add',
    'operationInputQuickAdd.addImage': 'Add image input',
    'operationInputQuickAdd.addText': 'Add text input',
    'operationInputQuickAdd.addVideo': 'Add video input',
    'operationInputQuickAdd.image': 'Image',
    'operationInputQuickAdd.text': 'Text',
    'operationInputQuickAdd.title': 'Add operation input',
    'operationInputRole.annotated_composite': 'Annotated',
    'operationInputRole.change': 'Change input role',
    'operationInputRole.character_reference': 'Character',
    'operationInputRole.choose': 'Choose role',
    'operationInputRole.imagePickerDescription': 'Select an image from this board to use as an operation input.',
    'operationInputRole.imagePickerTitle': 'Mention an image',
    'operationInputRole.noImages': 'No image assets are available on this board.',
    'operationInputRole.pickerDescription': 'Choose how this image should be used by the operation.',
    'operationInputRole.pickerTitle': 'Image input role',
    'operationInputRole.remove': 'Remove reference',
    'operationInputRole.required': 'Choose a role for every connected image before running this operation.',
    'operationInputRole.roleLimitReached': 'This role has already reached its input limit.',
    'operationStatus.canceled': 'Canceled',
    'operationStatus.failed': 'Failed',
    'operationStatus.succeeded': 'Completed',
    'operationStatus.modified': 'Modified',
    'operationStatus.changes': 'changes',
    'operationStatus.executionContentUpdated': 'Execution content updated',
    'operationToolbar.updatePrompt': 'Update prompt',
    'operationInputRole.first_frame': 'First frame',
    'operationInputRole.last_frame': 'Last frame',
    'operationInputRole.source': 'Source',
    'operationInputRole.style_reference': 'Reference',
    'operationInputRole.annotated_composite.title': 'Annotated composite',
    'operationInputRole.annotated_composite.description': 'System-generated image containing the visible edit annotations.',
    'operationInputRole.character_reference.title': 'Character reference',
    'operationInputRole.character_reference.description': 'Preserve character identity, facial features, proportions, and costume design.',
    'operationInputRole.composition_reference.title': 'Composition reference',
    'operationInputRole.composition_reference.description': 'Reference camera angle, framing, spatial layout, and subject placement.',
    'operationInputRole.control_image.title': 'Control image',
    'operationInputRole.control_image.description': 'System control input for provider-specific structural guidance.',
    'operationInputRole.depth_map.title': 'Depth map',
    'operationInputRole.depth_map.description': 'Preserve scene depth and spatial structure.',
    'operationInputRole.edge_map.title': 'Edge map',
    'operationInputRole.edge_map.description': 'Preserve contours and structural boundaries.',
    'operationInputRole.environment_reference.title': 'Environment reference',
    'operationInputRole.environment_reference.description': 'Reference background, architecture, spatial relationships, and atmosphere.',
    'operationInputRole.first_frame.title': 'First frame',
    'operationInputRole.first_frame.description': 'Use this image as the exact first-frame visual state.',
    'operationInputRole.general_reference.title': 'General reference',
    'operationInputRole.general_reference.description': 'Use as a general visual reference; specify the desired aspects in the prompt.',
    'operationInputRole.inpaint_mask.title': 'Inpaint mask',
    'operationInputRole.inpaint_mask.description': 'System mask identifying the editable image region.',
    'operationInputRole.last_frame.title': 'Last frame',
    'operationInputRole.last_frame.description': 'Use this image as the exact last-frame visual state.',
    'operationInputRole.object_reference.title': 'Object reference',
    'operationInputRole.object_reference.description': 'Preserve the appearance and design of a product, prop, building, or object.',
    'operationInputRole.pose_reference.title': 'Pose reference',
    'operationInputRole.pose_reference.description': 'Reference pose, action, gesture, and body relationships.',
    'operationInputRole.source.title': 'Source image',
    'operationInputRole.source.description': 'Use as the editable base and preserve its primary subject, composition, and content.',
    'operationInputRole.style_reference.title': 'Style reference',
    'operationInputRole.style_reference.description': 'Reference visual style, palette, lighting, texture, and material treatment.',
    'operation.waitingBody': 'Waiting for Codex to generate an image result.',
    'projectBoard.addBoard': 'New board',
    'projectBoard.addProject': 'New project',
    'projectBoard.boardActions': 'Board actions',
    'projectBoard.boardsTitle': 'Boards',
    'projectBoard.cancel': 'Cancel',
    'projectBoard.confirm': 'Confirm',
    'projectBoard.confirmDeleteBoard': 'Delete this board? This cannot be undone.',
    'projectBoard.confirmDeleteProject': 'Delete this project and all boards? This cannot be undone.',
    'projectBoard.create': 'Create',
    'projectBoard.copyBoard': 'Duplicate board',
    'projectBoard.delete': 'Delete',
    'projectBoard.menuTitle': 'Projects and boards',
    'projectBoard.newBoardName': 'Untitled board',
    'projectBoard.newProjectName': 'Untitled project',
    'projectBoard.projectActions': 'Project actions',
    'projectBoard.projectsTitle': 'Projects',
    'projectBoard.pin': 'Keep open',
    'projectBoard.rename': 'Rename',
    'projectBoard.renameBoard': 'Rename board',
    'projectBoard.renameProject': 'Rename project',
    'projectBoard.switchBoard': 'Open board',
    'projectBoard.unpin': 'Close on outside click',
    'settings.keyboardShortcuts': 'Keyboard shortcuts',
    'settings.generationProfiles': 'Generation profiles',
    'settings.generationProfileBuiltin': 'Built-in · Read only',
    'settings.generationProfileDefault': 'Default',
    'settings.language': 'Language',
    'settings.preferences': 'Preferences',
    'settings.shortcutClose': 'Close dialogs and panels',
    'settings.shortcutRedo': 'Redo',
    'settings.shortcutUndo': 'Undo',
    'settings.showGrid': 'Show grid',
    'settings.showGridDescription': 'Display the canvas grid background',
    'settings.switchLanguageTo': 'Switch to',
    'settings.theme': 'Theme',
    'settings.themePlanned': 'Theme settings will be added later',
    'settings.title': 'Settings',
    'result.retryCodex': 'Retry this result',
    'result.retryPromptTitle': 'Retry failed result',
    'status.failed': 'failed',
    'status.canceled': 'canceled',
    'status.queued': 'queued',
    'status.running': 'running',
    'status.succeeded': 'succeeded',
    'toolbar.addImage': 'Add image block',
    'toolbar.addGroup': 'Add group',
    'toolbar.addOperation': 'Add operation block',
    'toolbar.addText': 'Add text block',
    'toolbar.addVideo': 'Add video block',
    'toolbar.basicElements': 'Basic elements',
    'toolbar.boardMenu': 'Project and board menu',
    'toolbar.deleteSelection': 'Delete selected blocks',
    'toolbar.duplicateSelection': 'Duplicate selected blocks',
    'toolbar.fitView': 'Fit view',
    'toolbar.firstLastFrameVideo': 'First/last frame video',
    'toolbar.hideMiniMap': 'Hide minimap',
    'toolbar.imageCreation': 'Image creation',
    'toolbar.imageToImage': 'Image to image',
    'toolbar.imageToVideo': 'Image to video',
    'toolbar.menu': 'Open menu',
    'toolbar.moreSettings': 'More settings',
    'toolbar.multiImageToImage': 'Multi-image to image',
    'toolbar.panTool': 'Pan canvas',
    'toolbar.redo': 'Redo (Cmd/Ctrl+Shift+Z)',
    'toolbar.refreshBoard': 'Refresh board',
    'toolbar.selectTool': 'Select and move',
    'toolbar.showMiniMap': 'Show minimap',
    'toolbar.styleTransfer': 'Style transfer',
    'toolbar.textToImage': 'Text to image',
    'toolbar.textToVideo': 'Text to video',
    'toolbar.undo': 'Undo (Cmd/Ctrl+Z)',
    'toolbar.videoCreation': 'Video creation',
    'toolbar.viewportControls': 'Viewport controls',
    'toolbar.zoomIn': 'Zoom in',
    'toolbar.zoomLevel': 'Zoom level',
    'toolbar.zoomOut': 'Zoom out',
  },
  zh: {
    'autosave.error': '自动保存失败',
    'autosave.idle': '自动保存已就绪',
    'autosave.saved': '更改已保存到本地',
    'autosave.saving': '正在保存到本地',
    'block.image.body': '导入或生成素材后会绑定 assetId。',
    'block.image.title': '图片块',
    'block.operation.body': '选择能力、输入和执行适配器。',
    'block.operation.executorCodexMcp': 'Codex MCP',
    'block.operation.kind': '操作',
    'block.operation.prompt': '提示词',
    'block.operation.title': '新操作',
    'block.group.body': '聚合相关输入、操作和结果。',
    'block.group.title': '分组',
    'block.text.body': '提示词、脚本备注、参考内容或故事片段。',
    'block.text.title': '文本块',
    'block.video.body': '视频预览会在后续版本中按需加载。',
    'block.videoPlaceholder': '视频素材占位',
    'block.video.title': '视频块',
    'configuration.capability': '能力',
    'configuration.initial': '首次生成',
    'configuration.input': '图片',
    'configuration.noChanges': '无配置变更',
    'configuration.parameter': '参数',
    'configuration.pendingExecution': '待执行',
    'configuration.profile': '生成方式',
    'configuration.prompt': '提示词',
    'configuration.role': '用途',
    'canvas.tools': '画布工具',
    'codex.binding.connected': '复制当前画板的 Codex 绑定提示',
    'codex.binding.connect': '复制 Codex 绑定提示并连接当前画板',
    'common.dismiss': '关闭提示',
    'context.adjust': '调整',
    'context.addArrow': '添加箭头',
    'context.arrowTool': '箭头',
    'context.annotateForCodex': '标注编辑',
    'context.annotateEdit': '标注编辑',
    'context.annotationNotePlaceholder': '描述这张图需要标注修改的内容...',
    'context.annotationSourceMissing': '请先给当前图片块绑定或生成图片素材。',
    'context.annotationTools': '标注工具',
    'context.addReferenceImage': '添加参考图',
    'context.aspectRatio': '比例',
    'context.brightness': '亮度',
    'context.annotationNoteMode': '仅作批注',
    'context.clearMarks': '清空所有标注',
    'context.clearMarksConfirm': '确定要清空所有标注吗？清空后只能通过标注撤销恢复。',
    'context.colorPalette': '标注调色板',
    'context.close': '关闭',
    'context.contrast': '对比度',
    'context.createSimilar': '生成同款',
    'context.crop': '裁剪',
    'context.deleteMark': '删除',
    'context.describeChange': '描述要修改的内容...',
    'context.downloadImage': '下载图片',
    'context.ellipseTool': '圆形',
    'context.eraserTool': '橡皮',
    'context.expand': '扩图',
    'context.executionRoute': '执行方式',
    'context.executionRouteCodexMcp': 'Codex MCP',
    'context.free': '自由',
    'context.generatePromptPlaceholder': '描述要生成的图片...',
    'context.globalInstruction': '全局补充说明',
    'context.globalInstructionPlaceholder': '可选：所有标记共享的要求...',
    'context.customSize': '输出尺寸',
    'context.height': 'H',
    'context.markColor': '颜色',
    'context.markIntents': '标记说明',
    'context.markIntentPlaceholder': '说明这里要怎么改...',
    'context.markerTool': '编号标记',
    'context.missingMarkIntent': '请补充这些标记的说明',
    'context.more': '更多',
    'context.moreTools': '更多图片工具',
    'context.multiAngle': '多角度',
    'context.noMarks': '先在图片上添加标记，再在这里说明修改内容。',
    'context.penTool': '画笔',
    'context.quickEdit': '快捷编辑',
    'context.replaceImage': '替换图片',
    'context.referenceImage': '参考图',
    'context.referenceImages': '参考图 / 风格图',
    'context.referenceImagesEmpty': '未添加参考图',
    'context.redoAnnotation': '重做标注',
    'context.recentColors': '最近颜色',
    'context.rectangleTool': '矩形',
    'context.removeReferenceImage': '移除',
    'context.resolution': '画质',
    'context.relight': '重新打光',
    'context.removeBackground': '去背景',
    'context.regionBrushTool': '区域笔刷',
    'context.renderTextMode': '渲染到最终图片',
    'context.runWithCodex': '用 Codex 执行',
    'context.run': '执行',
    'context.saturation': '饱和度',
    'context.selectMarkTool': '选择标注',
    'context.selectedTools': '选中块工具',
    'context.strokeSize': '线宽',
    'context.textMarkTool': '文字标注',
    'context.textContent': '文字内容',
    'context.undoAnnotation': '撤销标注',
    'context.unavailable': '暂不可用',
    'context.executionInstructionPreview': '执行说明预览',
    'context.width': 'W',
    'context.pixels': 'PX',
    'feedback.closePrompt': '关闭提示预览',
    'feedback.copied': '已复制',
    'feedback.configurationRestored': '已恢复此版本配置',
    'feedback.configurationRestoreMissingAssets': '缺少素材：',
    'feedback.configurationRestoreUnavailable': '无法恢复此版本',
    'feedback.copyPrompt': '复制提示',
    'feedback.promptTitle': 'Codex 提示',
    'feedback.taskCreated': '已创建 Codex 操作',
    'feedback.taskCreatedCopyFailed': '提示预览已生成，但复制到剪贴板失败。',
    'feedback.taskCreatedCopied': '提示已复制。继续在 Codex 中生成结果。',
    'feedback.handoffUnavailable': '暂时无法交给 Codex',
    'feedback.inputRequired': '请完善操作输入',
    'feedback.executionCanceled': '已取消执行',
    'feedback.queuedExecutionCanceled': '已取消等待中的执行，并移除全部结果占位块。',
    'feedback.runningExecutionCanceled': '已取消 Retake 写回；Codex 中的生成可能仍会继续。',
    'feedback.runningExecutionCancelConfirm': 'Codex 已开始执行。是否取消整次执行并移除全部结果占位块？Codex 中的生成可能仍会继续，但 Retake 将拒绝后续写回。',
    'feedback.promptRequired': '请填写提示词',
    'feedback.promptRequiredBody': '请先填写这个操作要生成或修改的内容。',
    'feedback.localApiUnavailable': 'Retake 共享工作区当前不可用。请通过 Retake dev 或 preview 服务打开画板后重试。',
    'feedback.localEditCompleted': '已生成调整后的图片',
    'feedback.localEditFailed': '本地图片调整失败',
    'history.close': '关闭历史记录',
    'history.collapse': '收起详情',
    'history.empty': '暂无历史记录',
    'history.assetImported': '素材已导入',
    'history.assetReplaced': '图片已替换',
    'history.configurationRestored': '已恢复版本配置',
    'history.execution': '执行',
    'history.executionFailed': '执行失败',
    'history.executionCanceled': '执行已取消',
    'history.executionStarted': '执行已开始',
    'history.executionSucceeded': '执行成功',
    'history.locateBlock': '定位到块',
    'history.open': '画板历史',
    'history.expand': '展开详情',
    'history.promptCopied': '已复制提示',
    'history.promptCopiedSubtitle': '提示已复制，可用于再次执行',
    'history.resultUpdated': '结果已更新',
    'history.title': '历史记录',
    'group.background': '分组背景',
    'group.assetId': '素材 ID',
    'group.blockId': '块 ID',
    'group.browse': '浏览分组媒体',
    'group.browserTitle': '分组浏览器',
    'group.closeBrowser': '关闭分组浏览器',
    'group.collapse': '折叠分组',
    'group.color.blue': '蓝色背景',
    'group.color.green': '绿色背景',
    'group.color.neutral': '中性背景',
    'group.color.rose': '玫红背景',
    'group.color.transparent': '透明背景',
    'group.color.yellow': '黄色背景',
    'group.defaultTitle': '分组',
    'group.descendants': '全部项目',
    'group.deleteConfirm': '删除这个分组及其中的全部内容吗？',
    'group.deleteContents': '删除分组及内容',
    'group.dimensions': '尺寸',
    'group.directItems': '直接项目',
    'group.downloadAssets': '下载全部原始素材',
    'group.downloadStarted': '个原始素材已开始下载',
    'group.drawHint': '在画布上拖出分组范围，按 Esc 取消。',
    'group.executionResults': '执行结果',
    'group.expand': '展开分组',
    'group.fit': '适配分组内容',
    'group.items': '个项目',
    'group.inheritedLocked': '已被上级分组锁定',
    'group.kind': '分组类型',
    'group.kind.execution_results': '执行结果',
    'group.kind.manual': '手动分组',
    'group.kind.workflow': '工作流',
    'group.layout': '分组排列',
    'group.layoutFree': '自由排列',
    'group.layoutGrid': '网格排列',
    'group.layoutRow': '横向排列',
    'group.lock': '分组锁定',
    'group.lockContainer': '锁定容器',
    'group.lockContainerDescription': '禁止直接移动、缩放、解散和删除；移动上级分组时仍会整体跟随。',
    'group.lockContents': '锁定内容',
    'group.lockContentsDescription': '禁止后代移动、编辑、删除和重新连接。',
    'group.media': '媒体',
    'group.mediaInfo': '当前媒体',
    'group.mimeType': '文件类型',
    'group.noMedia': '这个分组中没有图片或视频素材。',
    'group.summary': '分组信息',
    'group.title': '分组标题',
    'group.tools': '分组工具',
    'group.ungroup': '解散分组',
    'language.label': '语言',
    'language.english': 'English',
    'language.chinese': '中文',
    'inspector.adapter': '适配器',
    'inspector.annotatedComposite': '标注输入',
    'inspector.annotationText': '标注文字',
    'inspector.capability': '能力',
    'inspector.close': '关闭执行记录',
    'inspector.closePreview': '关闭大图',
    'inspector.currentDraftChanges': '当前草稿变更',
    'inspector.executionId': '执行 ID',
    'inspector.failureRecovery': '失败与重试',
    'inspector.activity.started': '开始执行',
    'inspector.activity.failed': '结果生成失败',
    'inspector.activity.resumed': '重新生成失败结果',
    'inspector.activity.result_updated': '结果已写回',
    'inspector.activity.succeeded': '执行已完成',
    'inspector.generator': '生成方式',
    'inspector.imageComparison': '图片对比',
    'inspector.inputAssets': '输入素材',
    'inspector.nextPreview': '切换图片',
    'inspector.none': '无',
    'inspector.openDetails': '查看执行记录',
    'inspector.pendingConfiguration': '待执行配置',
    'inspector.outputAssets': '输出素材',
    'inspector.previousPreview': '上一张图片',
    'inspector.prompt': '提示',
    'inspector.restoreConfiguration': '恢复此版本配置',
    'inspector.skill': '技能',
    'inspector.source': '来源',
    'inspector.status': '状态',
    'inspector.title': '执行记录',
    'inspector.versionChanges': '此版本的变更',
    'operation.createSimilar.prompt': '生成同款图片',
    'operation.createSimilar.title': '生成同款图片',
    'operation.generateImage.prompt': '根据 prompt 生成图片',
    'operation.generateImage.title': '文生图',
    'operation.annotationEdit.prompt': '根据标注备注编辑图片',
    'operation.annotationEdit.title': '标注编辑',
    'operation.quickEdit.prompt': '描述要如何基于源图生成新图片...',
    'operation.quickEdit.title': '图生图',
    'operationToolbar.capability': '能力',
    'operationToolbar.codexMcpHint': 'Codex MCP',
    'operationToolbar.count': '数量',
    'operationToolbar.duration': '时长',
    'operationToolbar.executor': '执行方式',
    'operationToolbar.generatePrompt': '生成 Prompt',
    'operationToolbar.generateAgain': '再次生成',
    'operationToolbar.generator': '生成方式',
    'operationToolbar.localProcessing': '本地处理',
    'operationToolbar.imageInputMissing': '请连接一个图片块作为源图。',
    'operationToolbar.imageAssetMissing': '请先向已连接的图片块导入图片。',
    'operationToolbar.model': '模型',
    'operationToolbar.motion': '运动',
    'operationToolbar.params': '参数',
    'operationToolbar.parameterBestEffort': '尽力遵循',
    'operationToolbar.parameterSupported': '支持',
    'operationToolbar.prompt': '提示词',
    'operationToolbar.promptPlaceholder': '描述这个操作要生成或修改的内容...',
    'operationToolbar.singleResultHint': '当前每次执行写回一个结果块。',
    'operationToolbar.strength': '强度',
    'operationToolbar.sourceAspectRatio': '原图比例',
    'operationToolbar.sourceImageMissing': '请将一张已连接图片设为源图。',
    'operationToolbar.running': '执行中',
    'operationToolbar.textInputMissing': '请连接一个文本块作为提示词来源。',
    'operationToolbar.title': '操作工具',
    'operationInputQuickAdd.add': '添加',
    'operationInputQuickAdd.addImage': '添加图片输入',
    'operationInputQuickAdd.addText': '添加文本输入',
    'operationInputQuickAdd.addVideo': '添加视频输入',
    'operationInputQuickAdd.image': '图片',
    'operationInputQuickAdd.text': '文本',
    'operationInputQuickAdd.title': '添加操作输入',
    'operationInputRole.annotated_composite': '标注图',
    'operationInputRole.change': '修改输入角色',
    'operationInputRole.character_reference': '角色参考',
    'operationInputRole.choose': '选择用途',
    'operationInputRole.imagePickerDescription': '从当前画板选择一张图片，作为这个操作的输入。',
    'operationInputRole.imagePickerTitle': '引用图片',
    'operationInputRole.noImages': '当前画板中没有可用的图片资源。',
    'operationInputRole.pickerDescription': '选择这张图片在当前操作中的具体用途。',
    'operationInputRole.pickerTitle': '图片输入用途',
    'operationInputRole.remove': '移除引用',
    'operationInputRole.required': '执行前请为每张已连接的图片选择用途。',
    'operationInputRole.roleLimitReached': '该用途已经达到允许的输入数量。',
    'operationStatus.canceled': '已取消',
    'operationStatus.failed': '失败',
    'operationStatus.succeeded': '已完成',
    'operationStatus.modified': '已修改',
    'operationStatus.changes': '项变更',
    'operationStatus.executionContentUpdated': '执行内容已更新',
    'operationToolbar.updatePrompt': '更新 Prompt',
    'operationInputRole.first_frame': '首帧',
    'operationInputRole.last_frame': '尾帧',
    'operationInputRole.source': '原图',
    'operationInputRole.style_reference': '参考图',
    'operationInputRole.annotated_composite.title': '标注合成图',
    'operationInputRole.annotated_composite.description': '系统生成并包含可见编辑标注的图片。',
    'operationInputRole.character_reference.title': '角色参考',
    'operationInputRole.character_reference.description': '保持角色身份、面部特征、体型和服装设计。',
    'operationInputRole.composition_reference.title': '构图参考',
    'operationInputRole.composition_reference.description': '参考镜头角度、画面裁切、空间布局和主体位置。',
    'operationInputRole.control_image.title': '控制图',
    'operationInputRole.control_image.description': '用于供应商特定结构控制的系统输入。',
    'operationInputRole.depth_map.title': '深度图',
    'operationInputRole.depth_map.description': '保持场景深度和空间结构。',
    'operationInputRole.edge_map.title': '边缘图',
    'operationInputRole.edge_map.description': '保持轮廓和结构边界。',
    'operationInputRole.environment_reference.title': '场景参考',
    'operationInputRole.environment_reference.description': '参考背景、建筑、空间关系和环境氛围。',
    'operationInputRole.first_frame.title': '首帧',
    'operationInputRole.first_frame.description': '作为视频开始时的精确视觉状态。',
    'operationInputRole.general_reference.title': '综合参考',
    'operationInputRole.general_reference.description': '作为综合视觉参考，具体参考内容由提示词进一步说明。',
    'operationInputRole.inpaint_mask.title': '局部重绘遮罩',
    'operationInputRole.inpaint_mask.description': '系统生成并用于标识可编辑区域的遮罩。',
    'operationInputRole.last_frame.title': '尾帧',
    'operationInputRole.last_frame.description': '作为视频结束时的精确视觉状态。',
    'operationInputRole.object_reference.title': '物体参考',
    'operationInputRole.object_reference.description': '保持产品、道具、建筑或特定物体的外观设计。',
    'operationInputRole.pose_reference.title': '姿态参考',
    'operationInputRole.pose_reference.description': '参考姿势、动作、手势和肢体关系。',
    'operationInputRole.source.title': '原图',
    'operationInputRole.source.description': '作为编辑基础，保持主要主体、构图和内容。',
    'operationInputRole.style_reference.title': '风格参考',
    'operationInputRole.style_reference.description': '参考画风、色彩、光影、纹理和材质表现。',
    'operation.waitingBody': '等待 Codex 生成图片结果。',
    'projectBoard.addBoard': '新增画板',
    'projectBoard.addProject': '新增项目',
    'projectBoard.boardActions': '画板设置',
    'projectBoard.boardsTitle': '画板',
    'projectBoard.cancel': '取消',
    'projectBoard.confirm': '确认',
    'projectBoard.confirmDeleteBoard': '确定删除这个画板吗？此操作不能撤销。',
    'projectBoard.confirmDeleteProject': '确定删除这个项目和全部画板吗？此操作不能撤销。',
    'projectBoard.create': '创建',
    'projectBoard.copyBoard': '复制画板',
    'projectBoard.delete': '删除',
    'projectBoard.menuTitle': '项目和画板',
    'projectBoard.newBoardName': '未命名画板',
    'projectBoard.newProjectName': '未命名项目',
    'projectBoard.projectActions': '项目设置',
    'projectBoard.projectsTitle': '项目',
    'projectBoard.pin': '保持打开',
    'projectBoard.rename': '重命名',
    'projectBoard.renameBoard': '重命名画板',
    'projectBoard.renameProject': '重命名项目',
    'projectBoard.switchBoard': '打开画板',
    'projectBoard.unpin': '点击外部关闭',
    'settings.keyboardShortcuts': '快捷键',
    'settings.generationProfiles': '生成配置',
    'settings.generationProfileBuiltin': '内置 · 只读',
    'settings.generationProfileDefault': '默认',
    'settings.language': '语言',
    'settings.preferences': '偏好设置',
    'settings.shortcutClose': '关闭弹窗和面板',
    'settings.shortcutRedo': '重做',
    'settings.shortcutUndo': '撤销',
    'settings.showGrid': '显示网格',
    'settings.showGridDescription': '显示画布网格背景',
    'settings.switchLanguageTo': '切换到',
    'settings.theme': '主题',
    'settings.themePlanned': '主题设置后续加入',
    'settings.title': '设置',
    'result.retryCodex': '重试此结果',
    'result.retryPromptTitle': '重试失败结果',
    'status.failed': '失败',
    'status.canceled': '已取消',
    'status.queued': '等待中',
    'status.running': '运行中',
    'status.succeeded': '已完成',
    'toolbar.addImage': '添加图片块',
    'toolbar.addGroup': '添加分组',
    'toolbar.addOperation': '添加操作块',
    'toolbar.addText': '添加文本块',
    'toolbar.addVideo': '添加视频块',
    'toolbar.basicElements': '基础元素',
    'toolbar.boardMenu': '项目和画板菜单',
    'toolbar.deleteSelection': '删除选中块',
    'toolbar.duplicateSelection': '复制选中块',
    'toolbar.fitView': '适应画布',
    'toolbar.firstLastFrameVideo': '首尾帧生视频',
    'toolbar.hideMiniMap': '隐藏小地图',
    'toolbar.imageCreation': '图片创作',
    'toolbar.imageToImage': '图生图',
    'toolbar.imageToVideo': '图生视频',
    'toolbar.menu': '打开菜单',
    'toolbar.moreSettings': '更多设置',
    'toolbar.multiImageToImage': '多图生图',
    'toolbar.panTool': '拖动画布',
    'toolbar.redo': '重做 (Cmd/Ctrl+Shift+Z)',
    'toolbar.refreshBoard': '刷新画板',
    'toolbar.selectTool': '选择和移动',
    'toolbar.showMiniMap': '显示小地图',
    'toolbar.styleTransfer': '风格转绘',
    'toolbar.textToImage': '文生图',
    'toolbar.textToVideo': '文生视频',
    'toolbar.undo': '撤销 (Cmd/Ctrl+Z)',
    'toolbar.videoCreation': '视频创作',
    'toolbar.viewportControls': '视图控制',
    'toolbar.zoomIn': '放大',
    'toolbar.zoomLevel': '缩放比例',
    'toolbar.zoomOut': '缩小',
  },
};

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => detectInitialLocale());
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale(nextLocale) {
        localStorage.setItem(STORAGE_KEY, nextLocale);
        setLocaleState(nextLocale);
      },
      t(key) {
        return translations[locale][key];
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider.');
  }

  return context;
}

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh') return stored;

  const browserLanguage = navigator.language.toLowerCase();
  return browserLanguage.startsWith('zh') ? 'zh' : 'en';
}
