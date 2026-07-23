import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

export type Locale = 'en' | 'zh';

type TranslationKey =
  | 'autosave.error'
  | 'autosave.idle'
  | 'autosave.saved'
  | 'autosave.saving'
  | 'autosave.retry'
  | 'workspace.loadingTitle'
  | 'workspace.loadingBody'
  | 'workspace.loadErrorTitle'
  | 'workspace.loadErrorBody'
  | 'workspace.retry'
  | 'block.document.body'
  | 'block.document.title'
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
  | 'document.characters'
  | 'document.empty'
  | 'document.externalImageBlocked'
  | 'document.hideOutline'
  | 'document.loadFailed'
  | 'document.noOutline'
  | 'document.openReview'
  | 'document.outline'
  | 'document.preview'
  | 'document.reviewWorkspace'
  | 'document.savedAsset'
  | 'document.source'
  | 'document.showOutline'
  | 'document.streaming'
  | 'document.viewMode'
  | 'document.waiting'
  | 'videoGeneration.count'
  | 'videoGeneration.aspectRatio'
  | 'videoGeneration.dreaminaCompleted'
  | 'videoGeneration.dreaminaCompletedNotice'
  | 'videoGeneration.dreaminaCostNotice'
  | 'videoGeneration.dreaminaStarted'
  | 'videoGeneration.duration'
  | 'videoGeneration.failed'
  | 'videoGeneration.generateMock'
  | 'videoGeneration.generateDreamina'
  | 'videoGeneration.generateSeedance'
  | 'videoGeneration.mockCompleted'
  | 'videoGeneration.mockNotice'
  | 'videoGeneration.mockResult'
  | 'videoGeneration.profileMock'
  | 'videoGeneration.profile'
  | 'videoGeneration.profileMockOption'
  | 'videoGeneration.profileDreamina'
  | 'videoGeneration.profileDreaminaOption'
  | 'videoGeneration.profileSeedance'
  | 'videoGeneration.profileSeedanceOption'
  | 'videoGeneration.prompt'
  | 'videoGeneration.promptPlaceholder'
  | 'videoGeneration.running'
  | 'videoGeneration.seedanceCompleted'
  | 'videoGeneration.seedanceCompletedNotice'
  | 'videoGeneration.seedanceCostNotice'
  | 'videoGeneration.seedanceStarted'
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
  | 'context.annotationSourceMissing'
  | 'context.annotationTools'
  | 'context.addReferenceImage'
  | 'context.aspectRatio'
  | 'context.brightness'
  | 'context.annotationColorBlue'
  | 'context.annotationColorGreen'
  | 'context.annotationColorPurple'
  | 'context.annotationColorRed'
  | 'context.annotationColorYellow'
  | 'context.clearAnnotationDraft'
  | 'context.clearAnnotationDraftConfirm'
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
  | 'context.historicalAnnotationSession'
  | 'context.historicalAnnotationSessionBody'
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
  | 'context.rectangleTool'
  | 'context.removeReferenceImage'
  | 'context.resolution'
  | 'context.relight'
  | 'context.removeBackground'
  | 'context.regionBrushTool'
  | 'context.runWithCodex'
  | 'context.run'
  | 'context.saturation'
  | 'context.selectMarkTool'
  | 'context.selectedMark'
  | 'context.selectedMarkColor'
  | 'context.selectedTools'
  | 'context.strokeSize'
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
  | 'feedback.historicalAnnotationOpened'
  | 'feedback.annotationDraftRestoreUnavailable'
  | 'feedback.copyPrompt'
  | 'feedback.promptTitle'
  | 'feedback.taskCreated'
  | 'feedback.taskCreatedCopyFailed'
  | 'feedback.taskCreatedCopied'
  | 'feedback.handoffUnavailable'
  | 'feedback.connectionUnavailable'
  | 'feedback.connectionAdapterUnavailable'
  | 'feedback.inputRequired'
  | 'feedback.executionCanceled'
  | 'feedback.codexImageStarted'
  | 'feedback.codexImageCostNotice'
  | 'feedback.codexImageCompleted'
  | 'feedback.codexImageCompletedNotice'
  | 'feedback.codexImageFailed'
  | 'feedback.seedreamStarted'
  | 'feedback.seedreamCostNotice'
  | 'feedback.seedreamCompleted'
  | 'feedback.seedreamCompletedNotice'
  | 'feedback.seedreamFailed'
  | 'feedback.textGenerationStarted'
  | 'feedback.textGenerationCompleted'
  | 'feedback.textGenerationFailed'
  | 'feedback.screenplayStarted'
  | 'feedback.screenplayCompleted'
  | 'feedback.screenplayFailed'
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
  | 'history.annotationDraftRestored'
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
  | 'artifactLibrary.addToBoard'
  | 'artifactLibrary.alreadyCurrent'
  | 'artifactLibrary.allTypes'
  | 'artifactLibrary.bindTarget'
  | 'artifactLibrary.bindToSlot'
  | 'artifactLibrary.boundBody'
  | 'artifactLibrary.boundTitle'
  | 'artifactLibrary.close'
  | 'artifactLibrary.empty'
  | 'artifactLibrary.eyebrow'
  | 'artifactLibrary.filterType'
  | 'artifactLibrary.insertedBody'
  | 'artifactLibrary.insertedTitle'
  | 'artifactLibrary.loading'
  | 'artifactLibrary.name'
  | 'artifactLibrary.namePlaceholder'
  | 'artifactLibrary.noResults'
  | 'artifactLibrary.open'
  | 'artifactLibrary.promote'
  | 'artifactLibrary.promoteEyebrow'
  | 'artifactLibrary.promotedBody'
  | 'artifactLibrary.promotedTitle'
  | 'artifactLibrary.promotionSourceMissing'
  | 'artifactLibrary.refresh'
  | 'artifactLibrary.revisions'
  | 'artifactLibrary.search'
  | 'artifactLibrary.title'
  | 'artifactLibrary.type'
  | 'artifactLibrary.typeCharacterBible'
  | 'artifactLibrary.typeCharacterReference'
  | 'artifactLibrary.typeCreativeBrief'
  | 'artifactLibrary.typePropReference'
  | 'artifactLibrary.typeSceneBible'
  | 'artifactLibrary.typeSceneReference'
  | 'artifactLibrary.typeScreenplay'
  | 'artifactLibrary.typeStoryboard'
  | 'artifactLibrary.typeStyleReference'
  | 'artifactLibrary.typeVideo'
  | 'artifactLibrary.typeVoiceReference'
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
  | 'inspector.agentPrompt'
  | 'inspector.annotatedComposite'
  | 'inspector.annotationGlobalInstruction'
  | 'inspector.annotationManifest'
  | 'inspector.annotationPreview'
  | 'inspector.annotationManifestRaw'
  | 'inspector.annotationMarks'
  | 'inspector.annotationSourceChanged'
  | 'inspector.annotationSourceMissing'
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
  | 'inspector.requestPrompt'
  | 'inspector.requestPromptBatch'
  | 'inspector.restoreConfiguration'
  | 'inspector.restoreAnnotationDraft'
  | 'inspector.skill'
  | 'inspector.source'
  | 'inspector.status'
  | 'inspector.title'
  | 'inspector.versionChanges'
  | 'operation.createSimilar.prompt'
  | 'operation.createSimilar.title'
  | 'operation.generateImage.prompt'
  | 'operation.generateImage.title'
  | 'operation.generateText.title'
  | 'operation.generateScreenplay.title'
  | 'operation.organizeScreenplay.title'
  | 'operation.defineCharacter.title'
  | 'operation.defineScene.title'
  | 'operation.generateStoryboardPlan.title'
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
  | 'operationToolbar.generateImage'
  | 'operationToolbar.generateText'
  | 'operationToolbar.generateScreenplay'
  | 'operationToolbar.organizeScreenplay'
  | 'operationToolbar.defineCharacter'
  | 'operationToolbar.defineScene'
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
  | 'operationToolbar.skill'
  | 'operationToolbar.selectSkill'
  | 'skillDock.title'
  | 'skillDock.recommended'
  | 'skillDock.more'
  | 'skillDock.library'
  | 'skillDock.search'
  | 'skillDock.screenplayCategory'
  | 'skillDock.skillCategory'
  | 'skillDock.workflowBadge'
  | 'skillDock.workflowCategory'
  | 'skillComposer.title'
  | 'skillComposer.chooseEntryPoint'
  | 'skillComposer.slashPlaceholder'
  | 'skillComposer.inputPlaceholder'
  | 'skillComposer.create'
  | 'skillComposer.addMention'
  | 'skillComposer.selectedMentions'
  | 'skillComposer.removeMention'
  | 'skillComposer.mentionLibrary'
  | 'skillComposer.searchMentions'
  | 'skillComposer.blockMention'
  | 'skillComposer.assetMention'
  | 'skillComposer.noEntryPoints'
  | 'skillComposer.noMentions'
  | 'skillComposer.invalidInput'
  | 'skill.common.referencesInput'
  | 'skill.common.referencesPlaceholder'
  | 'skill.screenplayFromBrief.name'
  | 'skill.screenplayFromBrief.description'
  | 'skill.screenplayFromBrief.input'
  | 'skill.screenplayFromBrief.placeholder'
  | 'skill.normalizeScreenplay.name'
  | 'skill.normalizeScreenplay.description'
  | 'skill.normalizeScreenplay.input'
  | 'skill.normalizeScreenplay.placeholder'
  | 'skill.normalizeScreenplay.instructionInput'
  | 'skill.normalizeScreenplay.instructionPlaceholder'
  | 'skill.characterBible.name'
  | 'skill.characterBible.description'
  | 'skill.characterBible.input'
  | 'skill.characterBible.placeholder'
  | 'skill.sceneBible.name'
  | 'skill.sceneBible.description'
  | 'skill.sceneBible.input'
  | 'skill.sceneBible.placeholder'
  | 'skill.storyboardPlan.name'
  | 'skill.storyboardPlan.description'
  | 'skill.storyboardPlan.screenplayInput'
  | 'skill.storyboardPlan.screenplayPlaceholder'
  | 'skill.storyboardPlan.characterInput'
  | 'skill.storyboardPlan.characterPlaceholder'
  | 'skill.storyboardPlan.sceneInput'
  | 'skill.storyboardPlan.scenePlaceholder'
  | 'workflow.storyToStoryboard.name'
  | 'workflow.storyToStoryboard.description'
  | 'workflowDraft.outputPending'
  | 'workflowRuntime.create'
  | 'workflowRuntime.createFailed'
  | 'workflowRuntime.created'
  | 'workflowRuntime.createdBody'
  | 'workflowRuntime.definition'
  | 'workflowRuntime.gateApprove'
  | 'workflowRuntime.gateApproved'
  | 'workflowRuntime.gateArtifactRevision'
  | 'workflowRuntime.gateAssets'
  | 'workflowRuntime.gateDecisionBody'
  | 'workflowRuntime.gateDecisionFailed'
  | 'workflowRuntime.gateReject'
  | 'workflowRuntime.gateRejected'
  | 'workflowRuntime.gates'
  | 'workflowRuntime.gateSubject'
  | 'workflowRuntime.gateStatus.failed'
  | 'workflowRuntime.gateStatus.not_ready'
  | 'workflowRuntime.gateStatus.passed'
  | 'workflowRuntime.gateStatus.waiting_approval'
  | 'workflowRuntime.changeSelectedOutput'
  | 'workflowRuntime.outdated'
  | 'workflowRuntime.outputSelected'
  | 'workflowRuntime.outputSelectedBody'
  | 'workflowRuntime.outputSelectionFailed'
  | 'workflowRuntime.run'
  | 'workflowRuntime.runId'
  | 'workflowRuntime.stages'
  | 'workflowRuntime.stageOptionalSteps'
  | 'workflowRuntime.stageOutputs'
  | 'workflowRuntime.stageOutputReadiness.current'
  | 'workflowRuntime.stageOutputReadiness.not_required'
  | 'workflowRuntime.stageOutputReadiness.pending'
  | 'workflowRuntime.stageStatus.needs_attention'
  | 'workflowRuntime.stageStatus.pending'
  | 'workflowRuntime.stageStatus.ready'
  | 'workflowRuntime.stageStatus.running'
  | 'workflowRuntime.stageStatus.succeeded'
  | 'workflowRuntime.stageStatus.waiting_approval'
  | 'workflowRuntime.stageStatus.waiting_input'
  | 'workflowRuntime.stageStatus.waiting_selection'
  | 'workflowRuntime.stageSteps'
  | 'workflowRuntime.step'
  | 'workflowRuntime.stepExecutions'
  | 'workflowRuntime.stepNotReady'
  | 'workflowRuntime.steps'
  | 'workflowRuntime.selectOutput'
  | 'workflowRuntime.selectedOutput'
  | 'workflowRuntime.view'
  | 'workflowRuntime.runStatus.canceled'
  | 'workflowRuntime.runStatus.draft'
  | 'workflowRuntime.runStatus.failed'
  | 'workflowRuntime.runStatus.needs_attention'
  | 'workflowRuntime.runStatus.paused'
  | 'workflowRuntime.runStatus.ready'
  | 'workflowRuntime.runStatus.running'
  | 'workflowRuntime.runStatus.succeeded'
  | 'workflowRuntime.runStatus.waiting_approval'
  | 'workflowRuntime.runStatus.waiting_input'
  | 'workflowRuntime.runStatus.waiting_selection'
  | 'workflowRuntime.stepStatus.blocked'
  | 'workflowRuntime.stepStatus.canceled'
  | 'workflowRuntime.stepStatus.failed'
  | 'workflowRuntime.stepStatus.pending'
  | 'workflowRuntime.stepStatus.queued'
  | 'workflowRuntime.stepStatus.ready'
  | 'workflowRuntime.stepStatus.running'
  | 'workflowRuntime.stepStatus.skipped'
  | 'workflowRuntime.stepStatus.succeeded'
  | 'workflowRuntime.stepStatus.waiting_input'
  | 'workflowRuntime.stepStatus.waiting_selection'
  | 'agentRuntime.actionFailed'
  | 'agentRuntime.cancel'
  | 'agentRuntime.canceled'
  | 'agentRuntime.cancelCurrentExecutionContinues'
  | 'agentRuntime.created'
  | 'agentRuntime.executions'
  | 'agentRuntime.executionRange'
  | 'agentRuntime.fullWorkflow'
  | 'agentRuntime.pause'
  | 'agentRuntime.paused'
  | 'agentRuntime.permissions'
  | 'agentRuntime.resume'
  | 'agentRuntime.resumed'
  | 'agentRuntime.run'
  | 'agentRuntime.runId'
  | 'agentRuntime.startWorkflow'
  | 'agentRuntime.startSelectedTarget'
  | 'agentRuntime.stopPolicy'
  | 'agentRuntime.target'
  | 'agentRuntime.untilStep'
  | 'agentRuntime.untilArtifact'
  | 'agentRuntime.untilStage'
  | 'agentRuntime.status.canceled'
  | 'agentRuntime.status.failed'
  | 'agentRuntime.status.needs_attention'
  | 'agentRuntime.status.paused'
  | 'agentRuntime.status.queued'
  | 'agentRuntime.status.running'
  | 'agentRuntime.status.succeeded'
  | 'agentRuntime.status.waiting_approval'
  | 'agentRuntime.status.waiting_input'
  | 'agentRuntime.status.waiting_selection'
  | 'agentWorkspace.addEntrypoint'
  | 'agentWorkspace.addMention'
  | 'agentWorkspace.agent'
  | 'agentWorkspace.approveProposal'
  | 'agentWorkspace.archiveSession'
  | 'agentWorkspace.changes'
  | 'agentWorkspace.changesEmpty'
  | 'agentWorkspace.chat'
  | 'agentWorkspace.chatEmpty'
  | 'agentWorkspace.createSession'
  | 'agentWorkspace.emptyBody'
  | 'agentWorkspace.emptyTitle'
  | 'agentWorkspace.eyebrow'
  | 'agentWorkspace.inputPlaceholder'
  | 'agentWorkspace.newSession'
  | 'agentWorkspace.noRun'
  | 'agentWorkspace.noSession'
  | 'agentWorkspace.open'
  | 'agentWorkspace.rejectProposal'
  | 'agentWorkspace.run'
  | 'agentWorkspace.runEmpty'
  | 'agentWorkspace.runId'
  | 'agentWorkspace.runtime'
  | 'agentWorkspace.scope'
  | 'agentWorkspace.send'
  | 'agentWorkspace.session'
  | 'agentWorkspace.status'
  | 'agentWorkspace.streaming'
  | 'agentWorkspace.targetRun'
  | 'agentWorkspace.thinking'
  | 'agentWorkspace.title'
  | 'agentWorkspace.you'
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
  | 'settings.executionProviders'
  | 'settings.executionProvidersDescription'
  | 'settings.connections'
  | 'settings.connectionsDescription'
  | 'settings.addConnection'
  | 'settings.connectionTemplate'
  | 'settings.connectionName'
  | 'settings.providerLabel'
  | 'settings.modelIds'
  | 'settings.modelIdsPlaceholder'
  | 'settings.loadingModels'
  | 'settings.modelsFromCli'
  | 'settings.modelCatalogUnavailable'
  | 'settings.createConnection'
  | 'settings.deleteConnection'
  | 'settings.duplicateConnection'
  | 'settings.confirmDeleteConnection'
  | 'settings.models'
  | 'settings.noBoundCapabilities'
  | 'settings.defaults'
  | 'settings.configure'
  | 'settings.checkConnection'
  | 'settings.checkMayCost'
  | 'settings.lastTested'
  | 'settings.testRequired'
  | 'settings.saveConnection'
  | 'settings.apiKey'
  | 'settings.apiKeyCreatePlaceholder'
  | 'settings.apiKeyPlaceholder'
  | 'settings.baseUrl'
  | 'settings.model'
  | 'settings.capabilities'
  | 'settings.useCases'
  | 'settings.useCasesDescription'
  | 'settings.agentHostUseCases'
  | 'settings.credentialsStored'
  | 'settings.credentialsMissing'
  | 'settings.workspaceDefaults'
  | 'settings.projectDefaults'
  | 'settings.inheritWorkspace'
  | 'settings.defaultText'
  | 'settings.defaultDocument'
  | 'settings.defaultImage'
  | 'settings.defaultVideo'
  | 'settings.defaultAudio'
  | 'settings.defaultAgent'
  | 'settings.statusNotInstalled'
  | 'settings.statusNeedsCredentials'
  | 'settings.statusNeedsLogin'
  | 'settings.statusUntested'
  | 'settings.statusChecking'
  | 'settings.statusReady'
  | 'settings.statusUnavailable'
  | 'settings.loadingProviders'
  | 'settings.noCompatibleConnection'
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
  | 'resultStatus.canceled'
  | 'resultStatus.codexQueued'
  | 'resultStatus.codexRunning'
  | 'resultStatus.directApiQueued'
  | 'resultStatus.directApiRunning'
  | 'resultStatus.failed'
  | 'resultStatus.queued'
  | 'resultStatus.running'
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
  | 'toolbar.generation'
  | 'toolbar.hideMiniMap'
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
  | 'toolbar.generateText'
  | 'toolbar.textToVideo'
  | 'toolbar.undo'
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
    'autosave.retry': 'Autosave failed. Retry saving',
    'workspace.loadingTitle': 'Loading workspace',
    'workspace.loadingBody': 'Waiting for the Retake local service to load the current board.',
    'workspace.loadErrorTitle': 'Workspace unavailable',
    'workspace.loadErrorBody': 'The canvas is locked because Retake could not load an authoritative board snapshot.',
    'workspace.retry': 'Retry',
    'block.document.body': 'A long-form Markdown document stored as an asset.',
    'block.document.title': 'Markdown document',
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
    'document.characters': 'characters',
    'document.empty': 'This document has no content yet.',
    'document.externalImageBlocked': 'External image blocked',
    'document.hideOutline': 'Hide outline',
    'document.loadFailed': 'Could not load the Markdown asset',
    'document.noOutline': 'No headings yet.',
    'document.openReview': 'Open review',
    'document.outline': 'Outline',
    'document.preview': 'Preview',
    'document.reviewWorkspace': 'Document review',
    'document.savedAsset': 'Saved as Markdown asset',
    'document.source': 'Source',
    'document.showOutline': 'Show outline',
    'document.streaming': 'Streaming Markdown',
    'document.viewMode': 'Document view',
    'document.waiting': 'Waiting for generated Markdown…',
    'videoGeneration.count': 'Count',
    'videoGeneration.aspectRatio': 'Ratio',
    'videoGeneration.dreaminaCompleted': 'Dreamina CLI video generation completed',
    'videoGeneration.dreaminaCompletedNotice': 'The Dreamina VIP result was imported into Retake AssetStore and attached to its result block.',
    'videoGeneration.dreaminaCostNotice': 'This uses seedance2.0_vip on the signed-in Dreamina account. Each requested result is a separate task and consumes membership credits.',
    'videoGeneration.dreaminaStarted': 'Dreamina CLI video generation started',
    'videoGeneration.duration': 'Duration',
    'videoGeneration.failed': 'Video generation failed',
    'videoGeneration.generateMock': 'Generate mock video',
    'videoGeneration.generateDreamina': 'Generate with Dreamina VIP',
    'videoGeneration.generateSeedance': 'Generate with Seedance',
    'videoGeneration.mockCompleted': 'Mock video results created',
    'videoGeneration.mockNotice': 'This verifies the Retake execution path only. No provider was called and no usage was charged.',
    'videoGeneration.mockResult': 'Mock video result',
    'videoGeneration.profileMock': 'Profile: Retake mock · no provider cost',
    'videoGeneration.profile': 'Execution profile',
    'videoGeneration.profileMockOption': 'Retake Mock (free)',
    'videoGeneration.profileDreamina': 'Profile: official Dreamina CLI · seedance2.0_vip · remote tasks cannot be canceled',
    'videoGeneration.profileDreaminaOption': 'Dreamina CLI (VIP membership)',
    'videoGeneration.profileSeedance': 'Profile: Seedance 2.0 · ModelArk direct API · provider charges apply',
    'videoGeneration.profileSeedanceOption': 'Seedance 2.0 (paid)',
    'videoGeneration.prompt': 'Video prompt',
    'videoGeneration.promptPlaceholder': 'Describe motion, camera, subject, and scene...',
    'videoGeneration.running': 'Generating…',
    'videoGeneration.seedanceCompleted': 'Seedance video generation completed',
    'videoGeneration.seedanceCompletedNotice': 'The generated video was imported into Retake AssetStore and attached to its result block.',
    'videoGeneration.seedanceCostNotice': 'This calls the configured ModelArk account. Each requested result is a separate paid provider task.',
    'videoGeneration.seedanceStarted': 'Seedance video generation started',
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
    'context.annotationSourceMissing': 'Attach or generate an image asset before annotating.',
    'context.annotationTools': 'Annotation tools',
    'context.addReferenceImage': 'Add reference',
    'context.aspectRatio': 'Aspect ratio',
    'context.brightness': 'Brightness',
    'context.annotationColorBlue': 'Blue',
    'context.annotationColorGreen': 'Green',
    'context.annotationColorPurple': 'Purple',
    'context.annotationColorRed': 'Red',
    'context.annotationColorYellow': 'Yellow',
    'context.clearAnnotationDraft': 'Clear annotation draft',
    'context.clearAnnotationDraftConfirm': 'Clear all marks and instructions? This cannot be undone.',
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
    'context.historicalAnnotationSession': 'Historical annotation · Temporary session',
    'context.historicalAnnotationSessionBody': 'Closing keeps the current draft unchanged. Running creates a new branch from this historical input.',
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
    'context.rectangleTool': 'Rectangle',
    'context.removeReferenceImage': 'Remove',
    'context.resolution': 'Quality',
    'context.relight': 'Relight',
    'context.removeBackground': 'Remove background',
    'context.regionBrushTool': 'Region brush',
    'context.runWithCodex': 'Run with Codex',
    'context.run': 'Run',
    'context.saturation': 'Saturation',
    'context.selectMarkTool': 'Select mark',
    'context.selectedMark': 'Selected',
    'context.selectedMarkColor': 'Selected mark color',
    'context.selectedTools': 'Selected block tools',
    'context.strokeSize': 'Stroke',
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
    'feedback.historicalAnnotationOpened': 'Historical annotations opened without changing the current draft',
    'feedback.annotationDraftRestoreUnavailable': 'This annotation draft cannot be restored',
    'feedback.copyPrompt': 'Copy prompt',
    'feedback.promptTitle': 'Codex prompt',
    'feedback.taskCreated': 'Codex operation created',
    'feedback.taskCreatedCopyFailed': 'Prompt preview is ready, but clipboard copy failed.',
    'feedback.taskCreatedCopied': 'Prompt copied. Continue in Codex to generate the result.',
    'feedback.handoffUnavailable': 'Codex handoff unavailable',
    'feedback.connectionUnavailable': 'The selected connection is unavailable. Test it or choose another connection in Settings or this Operation.',
    'feedback.connectionAdapterUnavailable': 'The selected connection does not have an installed image execution adapter.',
    'feedback.inputRequired': 'Complete the operation inputs',
    'feedback.executionCanceled': 'Execution canceled',
    'feedback.codexImageStarted': 'Codex image generation started',
    'feedback.codexImageCostNotice': 'Codex App Server is generating image results in the background.',
    'feedback.codexImageCompleted': 'Codex image generation completed',
    'feedback.codexImageCompletedNotice': 'Generated images were imported as Retake assets.',
    'feedback.codexImageFailed': 'Codex image generation failed',
    'feedback.seedreamStarted': 'Seedream generation started',
    'feedback.seedreamCostNotice': 'Volcengine Ark is generating paid image results in the background.',
    'feedback.seedreamCompleted': 'Seedream generation completed',
    'feedback.seedreamCompletedNotice': 'Generated images were saved as Retake assets.',
    'feedback.seedreamFailed': 'Seedream generation failed',
    'feedback.textGenerationStarted': 'Text generation started',
    'feedback.textGenerationCompleted': 'Generated Markdown was saved as a Retake asset.',
    'feedback.textGenerationFailed': 'Text generation failed',
    'feedback.screenplayStarted': 'Screenplay processing started',
    'feedback.screenplayCompleted': 'Screenplay processing completed',
    'feedback.screenplayFailed': 'Screenplay processing failed',
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
    'history.annotationDraftRestored': 'Annotation draft restored',
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
    'artifactLibrary.addToBoard': 'Add to board',
    'artifactLibrary.alreadyCurrent': 'This asset is already the current revision for that project artifact.',
    'artifactLibrary.allTypes': 'All types',
    'artifactLibrary.bindTarget': 'Bind to selected operation',
    'artifactLibrary.bindToSlot': 'Compatible inputs',
    'artifactLibrary.boundBody': 'The pinned artifact revision was added and connected to the selected input.',
    'artifactLibrary.boundTitle': 'Artifact input connected',
    'artifactLibrary.close': 'Close project library',
    'artifactLibrary.empty': 'No project artifacts yet. Select an asset-backed block to promote it.',
    'artifactLibrary.eyebrow': 'Project scope',
    'artifactLibrary.filterType': 'Filter project artifacts by type',
    'artifactLibrary.insertedBody': 'A block pinned to this artifact revision was added to the board.',
    'artifactLibrary.insertedTitle': 'Artifact added',
    'artifactLibrary.loading': 'Loading project artifacts…',
    'artifactLibrary.name': 'Name',
    'artifactLibrary.namePlaceholder': 'Stable project asset name',
    'artifactLibrary.noResults': 'No artifacts match the current filters.',
    'artifactLibrary.open': 'Project asset library',
    'artifactLibrary.promote': 'Promote to project',
    'artifactLibrary.promoteEyebrow': 'Selected board asset',
    'artifactLibrary.promotedBody': 'The selected asset is now a versioned project artifact.',
    'artifactLibrary.promotedTitle': 'Promoted to project library',
    'artifactLibrary.promotionSourceMissing': 'Select an image, video, document, or audio block with an asset first.',
    'artifactLibrary.refresh': 'Refresh project library',
    'artifactLibrary.revisions': 'Revisions',
    'artifactLibrary.search': 'Search artifacts',
    'artifactLibrary.title': 'Asset Library',
    'artifactLibrary.type': 'Artifact type',
    'artifactLibrary.typeCharacterBible': 'Character bible',
    'artifactLibrary.typeCharacterReference': 'Character reference',
    'artifactLibrary.typeCreativeBrief': 'Creative brief',
    'artifactLibrary.typePropReference': 'Prop reference',
    'artifactLibrary.typeSceneBible': 'Scene bible',
    'artifactLibrary.typeSceneReference': 'Scene reference',
    'artifactLibrary.typeScreenplay': 'Screenplay',
    'artifactLibrary.typeStoryboard': 'Storyboard plan',
    'artifactLibrary.typeStyleReference': 'Style reference',
    'artifactLibrary.typeVideo': 'Video clip',
    'artifactLibrary.typeVoiceReference': 'Voice reference',
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
    'inspector.agentPrompt': 'Agent execution prompt',
    'inspector.annotatedComposite': 'Annotated brief',
    'inspector.annotationGlobalInstruction': 'Global instruction',
    'inspector.annotationManifest': 'Annotation Manifest',
    'inspector.annotationPreview': 'Annotated input',
    'inspector.annotationManifestRaw': 'View raw Manifest',
    'inspector.annotationMarks': 'Marks',
    'inspector.annotationSourceChanged': 'The source image has changed, so these coordinates cannot be restored safely.',
    'inspector.annotationSourceMissing': 'The original source image block is no longer available.',
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
    'inspector.prompt': 'User prompt',
    'inspector.requestPrompt': 'Actual request prompt',
    'inspector.requestPromptBatch': 'candidate requests consolidated',
    'inspector.restoreConfiguration': 'Restore this version',
    'inspector.restoreAnnotationDraft': 'Open in annotation editor',
    'inspector.skill': 'Skill',
    'inspector.source': 'Source',
    'inspector.status': 'Status',
    'inspector.title': 'Execution',
    'inspector.versionChanges': 'Changes in this version',
    'operation.createSimilar.prompt': 'Create similar image',
    'operation.createSimilar.title': 'Create similar image',
    'operation.generateImage.prompt': 'Generate image from prompt',
    'operation.generateImage.title': 'Text to image',
    'operation.generateText.title': 'Generate text',
    'operation.generateScreenplay.title': 'Generate screenplay',
    'operation.organizeScreenplay.title': 'Organize screenplay',
    'operation.defineCharacter.title': 'Define characters',
    'operation.defineScene.title': 'Define scenes',
    'operation.generateStoryboardPlan.title': 'Generate storyboard plan',
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
    'operationToolbar.generateImage': 'Generate image',
    'operationToolbar.generateText': 'Generate text',
    'operationToolbar.generateScreenplay': 'Generate screenplay',
    'operationToolbar.organizeScreenplay': 'Organize screenplay',
    'operationToolbar.defineCharacter': 'Define characters',
    'operationToolbar.defineScene': 'Define scenes',
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
    'operationToolbar.skill': 'Skill',
    'operationToolbar.selectSkill': 'Select skill',
    'skillDock.title': 'Skills',
    'skillDock.recommended': 'Recommended',
    'skillDock.more': 'More',
    'skillDock.library': 'Skill & Workflow library',
    'skillDock.search': 'Search skills and workflows',
    'skillDock.screenplayCategory': 'Screenplay',
    'skillDock.skillCategory': 'Single-step skills',
    'skillDock.workflowBadge': 'Workflow',
    'skillDock.workflowCategory': 'Workflows',
    'skillComposer.title': 'Skill quick input',
    'skillComposer.chooseEntryPoint': '/ Choose',
    'skillComposer.slashPlaceholder': 'Type / to choose a skill or workflow...',
    'skillComposer.inputPlaceholder': 'Describe the input, or type @ to reference a block or asset...',
    'skillComposer.create': 'Create draft',
    'skillComposer.addMention': 'Reference block or asset',
    'skillComposer.selectedMentions': 'Referenced inputs',
    'skillComposer.removeMention': 'Remove reference',
    'skillComposer.mentionLibrary': 'Compatible blocks and assets',
    'skillComposer.searchMentions': 'Search compatible blocks and assets',
    'skillComposer.blockMention': 'Block',
    'skillComposer.assetMention': 'Asset',
    'skillComposer.noEntryPoints': 'No matching skills or workflows.',
    'skillComposer.noMentions': 'No compatible blocks or document assets.',
    'skillComposer.invalidInput': 'This input combination is not compatible with the selected entry point.',
    'skill.common.referencesInput': 'Additional direction / references',
    'skill.common.referencesPlaceholder': 'Add optional direction or reference material...',
    'skill.screenplayFromBrief.name': 'Generate screenplay',
    'skill.screenplayFromBrief.description': 'Create an executable screenplay from a creative brief.',
    'skill.screenplayFromBrief.input': 'Creative brief',
    'skill.screenplayFromBrief.placeholder': 'Describe the premise, audience, constraints, characters, and required ending...',
    'skill.normalizeScreenplay.name': 'Organize screenplay',
    'skill.normalizeScreenplay.description': 'Organize structure without changing story facts.',
    'skill.normalizeScreenplay.input': 'Source screenplay',
    'skill.normalizeScreenplay.placeholder': 'Paste the screenplay to normalize, or select a Document Block first...',
    'skill.normalizeScreenplay.instructionInput': 'Organization requirements',
    'skill.normalizeScreenplay.instructionPlaceholder': 'Describe how to organize the screenplay without changing story facts...',
    'skill.characterBible.name': 'Define characters',
    'skill.characterBible.description': 'Extract stable character design and continuity constraints from a screenplay.',
    'skill.characterBible.input': 'Source screenplay',
    'skill.characterBible.placeholder': 'Connect or paste the screenplay that should define the characters...',
    'skill.sceneBible.name': 'Define scenes',
    'skill.sceneBible.description': 'Extract scene, spatial, lighting, and continuity constraints from a screenplay.',
    'skill.sceneBible.input': 'Source screenplay',
    'skill.sceneBible.placeholder': 'Connect or paste the screenplay that should define the production scenes...',
    'skill.storyboardPlan.name': 'Generate storyboard plan',
    'skill.storyboardPlan.description': 'Turn a screenplay and production design bibles into a shot-level storyboard plan.',
    'skill.storyboardPlan.screenplayInput': 'Screenplay',
    'skill.storyboardPlan.screenplayPlaceholder': 'Connect or paste the authoritative screenplay...',
    'skill.storyboardPlan.characterInput': 'Character Bible',
    'skill.storyboardPlan.characterPlaceholder': 'Connect or paste the approved character design and continuity constraints...',
    'skill.storyboardPlan.sceneInput': 'Scene Bible',
    'skill.storyboardPlan.scenePlaceholder': 'Connect or paste the approved scene, spatial, lighting, and continuity constraints...',
    'workflow.storyToStoryboard.name': 'Story to storyboard plan',
    'workflow.storyToStoryboard.description': 'Create an editable draft graph from brief through screenplay and production design to storyboard planning.',
    'workflowDraft.outputPending': 'Run the upstream operation to create this document.',
    'workflowRuntime.create': 'Create Workflow Run',
    'workflowRuntime.createFailed': 'Workflow Run could not be created',
    'workflowRuntime.created': 'Workflow Run created',
    'workflowRuntime.createdBody': 'Ready Steps can now be started manually.',
    'workflowRuntime.definition': 'Definition',
    'workflowRuntime.gateApprove': 'Approve',
    'workflowRuntime.gateApproved': 'Gate approved',
    'workflowRuntime.gateArtifactRevision': 'Artifact Revision',
    'workflowRuntime.gateAssets': 'Subject assets',
    'workflowRuntime.gateDecisionBody': 'The Workflow state was updated from this explicit decision.',
    'workflowRuntime.gateDecisionFailed': 'Gate decision could not be recorded',
    'workflowRuntime.gateReject': 'Reject',
    'workflowRuntime.gateRejected': 'Gate rejected',
    'workflowRuntime.gates': 'Approval Gates',
    'workflowRuntime.gateSubject': 'Subject',
    'workflowRuntime.gateStatus.failed': 'Rejected',
    'workflowRuntime.gateStatus.not_ready': 'Not ready',
    'workflowRuntime.gateStatus.passed': 'Approved',
    'workflowRuntime.gateStatus.waiting_approval': 'Waiting for approval',
    'workflowRuntime.changeSelectedOutput': 'Use this result instead',
    'workflowRuntime.outdated': 'Outdated',
    'workflowRuntime.outputSelected': 'Workflow output selected',
    'workflowRuntime.outputSelectedBody': 'The Workflow can now continue from this result.',
    'workflowRuntime.outputSelectionFailed': 'Workflow output could not be selected',
    'workflowRuntime.run': 'Workflow Run',
    'workflowRuntime.runId': 'Run ID',
    'workflowRuntime.stages': 'Stages',
    'workflowRuntime.stageOptionalSteps': 'Optional steps',
    'workflowRuntime.stageOutputs': 'Outputs',
    'workflowRuntime.stageOutputReadiness.current': 'Artifact bindings current',
    'workflowRuntime.stageOutputReadiness.not_required': 'No required output',
    'workflowRuntime.stageOutputReadiness.pending': 'Waiting for Artifact bindings',
    'workflowRuntime.stageStatus.needs_attention': 'Needs attention',
    'workflowRuntime.stageStatus.pending': 'Pending',
    'workflowRuntime.stageStatus.ready': 'Ready',
    'workflowRuntime.stageStatus.running': 'Running',
    'workflowRuntime.stageStatus.succeeded': 'Steps and Gates complete',
    'workflowRuntime.stageStatus.waiting_approval': 'Waiting for approval',
    'workflowRuntime.stageStatus.waiting_input': 'Waiting for input',
    'workflowRuntime.stageStatus.waiting_selection': 'Waiting for selection',
    'workflowRuntime.stageSteps': 'Required steps',
    'workflowRuntime.step': 'Workflow Step',
    'workflowRuntime.stepExecutions': 'Executions',
    'workflowRuntime.stepNotReady': 'This Workflow Step is waiting for its upstream dependencies.',
    'workflowRuntime.steps': 'Steps',
    'workflowRuntime.selectOutput': 'Use this result',
    'workflowRuntime.selectedOutput': 'Selected for Workflow',
    'workflowRuntime.view': 'View Workflow Run',
    'workflowRuntime.runStatus.canceled': 'Canceled',
    'workflowRuntime.runStatus.draft': 'Draft',
    'workflowRuntime.runStatus.failed': 'Failed',
    'workflowRuntime.runStatus.needs_attention': 'Needs attention',
    'workflowRuntime.runStatus.paused': 'Paused',
    'workflowRuntime.runStatus.ready': 'Ready',
    'workflowRuntime.runStatus.running': 'Running',
    'workflowRuntime.runStatus.succeeded': 'Succeeded',
    'workflowRuntime.runStatus.waiting_approval': 'Waiting for approval',
    'workflowRuntime.runStatus.waiting_input': 'Waiting for input',
    'workflowRuntime.runStatus.waiting_selection': 'Waiting for selection',
    'workflowRuntime.stepStatus.blocked': 'Blocked',
    'workflowRuntime.stepStatus.canceled': 'Canceled',
    'workflowRuntime.stepStatus.failed': 'Failed',
    'workflowRuntime.stepStatus.pending': 'Pending',
    'workflowRuntime.stepStatus.queued': 'Queued',
    'workflowRuntime.stepStatus.ready': 'Ready',
    'workflowRuntime.stepStatus.running': 'Running',
    'workflowRuntime.stepStatus.skipped': 'Skipped',
    'workflowRuntime.stepStatus.succeeded': 'Succeeded',
    'workflowRuntime.stepStatus.waiting_input': 'Waiting for input',
    'workflowRuntime.stepStatus.waiting_selection': 'Waiting for selection',
    'agentRuntime.actionFailed': 'Agent action failed',
    'agentRuntime.cancel': 'Stop Agent',
    'agentRuntime.canceled': 'Agent Run stopped',
    'agentRuntime.cancelCurrentExecutionContinues': 'The Agent will not start another Step. An already running Execution is not canceled.',
    'agentRuntime.created': 'Agent Run started',
    'agentRuntime.executions': 'Executions',
    'agentRuntime.executionRange': 'Execution range',
    'agentRuntime.fullWorkflow': 'Complete Workflow',
    'agentRuntime.pause': 'Pause',
    'agentRuntime.paused': 'Agent Run paused',
    'agentRuntime.permissions': 'Permissions',
    'agentRuntime.resume': 'Resume',
    'agentRuntime.resumed': 'Agent Run resumed',
    'agentRuntime.run': 'Agent Run',
    'agentRuntime.runId': 'Agent Run ID',
    'agentRuntime.startWorkflow': 'Run existing Workflow with Agent',
    'agentRuntime.startSelectedTarget': 'Start Agent',
    'agentRuntime.stopPolicy': 'Stop policy',
    'agentRuntime.target': 'Typed target',
    'agentRuntime.untilStep': 'Run until',
    'agentRuntime.untilArtifact': 'Run until Artifact',
    'agentRuntime.untilStage': 'Run until Stage',
    'agentRuntime.status.canceled': 'Canceled',
    'agentRuntime.status.failed': 'Failed',
    'agentRuntime.status.needs_attention': 'Needs attention',
    'agentRuntime.status.paused': 'Paused',
    'agentRuntime.status.queued': 'Queued',
    'agentRuntime.status.running': 'Running',
    'agentRuntime.status.succeeded': 'Succeeded',
    'agentRuntime.status.waiting_approval': 'Waiting for approval',
    'agentRuntime.status.waiting_input': 'Waiting for input',
    'agentRuntime.status.waiting_selection': 'Waiting for selection',
    'agentWorkspace.addEntrypoint': 'Add / Skill or Workflow',
    'agentWorkspace.addMention': 'Add reference',
    'agentWorkspace.agent': 'Agent',
    'agentWorkspace.approveProposal': 'Approve and apply',
    'agentWorkspace.archiveSession': 'Archive session',
    'agentWorkspace.changes': 'Changes',
    'agentWorkspace.changesEmpty': 'Out-of-scope requests will appear here as reviewable Change Proposals.',
    'agentWorkspace.chat': 'Chat',
    'agentWorkspace.chatEmpty': 'Ask about this Board or control the currently attached Agent Run.',
    'agentWorkspace.createSession': 'Create session',
    'agentWorkspace.emptyBody': 'Sessions keep Board-scoped conversation history and can attach to one existing Agent Run.',
    'agentWorkspace.emptyTitle': 'Start a Board Agent session',
    'agentWorkspace.eyebrow': 'Board Agent',
    'agentWorkspace.inputPlaceholder': 'Ask about this Board or request an allowed Run action…',
    'agentWorkspace.newSession': 'New session',
    'agentWorkspace.noRun': 'No Agent Run attached',
    'agentWorkspace.noSession': 'No active session',
    'agentWorkspace.open': 'Open Agent Workspace',
    'agentWorkspace.rejectProposal': 'Reject proposal',
    'agentWorkspace.run': 'Run',
    'agentWorkspace.runEmpty': 'Attach an existing Agent Run. Chat does not create execution authority.',
    'agentWorkspace.runId': 'Agent Run ID',
    'agentWorkspace.runtime': 'Runtime binding',
    'agentWorkspace.scope': 'Authorized scope',
    'agentWorkspace.send': 'Send message',
    'agentWorkspace.session': 'Session',
    'agentWorkspace.status': 'Status',
    'agentWorkspace.streaming': 'Receiving structured decision…',
    'agentWorkspace.targetRun': 'Attached Agent Run',
    'agentWorkspace.thinking': 'Working within the attached scope…',
    'agentWorkspace.title': 'Agent Workspace',
    'agentWorkspace.you': 'You',
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
    'settings.executionProviders': 'Execution & providers',
    'settings.executionProvidersDescription': 'Configure API connections, local agent hosts, provider CLIs, and capability defaults.',
    'settings.connections': 'Connections',
    'settings.connectionsDescription': 'Each connection names one exact model, API account, and endpoint.',
    'settings.addConnection': 'Add connection',
    'settings.connectionTemplate': 'Service template',
    'settings.connectionName': 'Connection name',
    'settings.providerLabel': 'Provider label',
    'settings.modelIds': 'Model ID',
    'settings.modelIdsPlaceholder': 'Exact model ID used by this connection',
    'settings.loadingModels': 'Loading models from Codex CLI…',
    'settings.modelsFromCli': 'Model list reported by Codex CLI',
    'settings.modelCatalogUnavailable': 'The CLI model list is unavailable. Check or upgrade Codex CLI, then try again.',
    'settings.createConnection': 'Create connection',
    'settings.deleteConnection': 'Delete',
    'settings.duplicateConnection': 'Duplicate connection',
    'settings.confirmDeleteConnection': 'Delete connection',
    'settings.models': 'Model',
    'settings.noBoundCapabilities': 'Connector foundation only',
    'settings.defaults': 'Defaults',
    'settings.configure': 'Configure',
    'settings.checkConnection': 'Test connection',
    'settings.checkMayCost': 'OpenAI-compatible, Anthropic, and Gemini tests send a minimal paid text request. Volcengine Ark validates the authenticated image endpoint without generating an asset. ModelArk only lists tasks.',
    'settings.lastTested': 'Last tested',
    'settings.testRequired': 'Save the connection, then test it before using it for execution.',
    'settings.saveConnection': 'Save connection',
    'settings.apiKey': 'API key / secret',
    'settings.apiKeyCreatePlaceholder': 'Enter the API key or secret for this connection',
    'settings.apiKeyPlaceholder': 'Leave blank to keep the stored key',
    'settings.baseUrl': 'Base URL',
    'settings.model': 'Model ID',
    'settings.capabilities': 'Capabilities',
    'settings.useCases': 'Uses',
    'settings.useCasesDescription': 'Choose how this exact model connection may be used. Templates provide editable defaults.',
    'settings.agentHostUseCases': 'Managed separately by the Agent runtime',
    'settings.credentialsStored': 'Credential stored on the Retake server',
    'settings.credentialsMissing': 'Credential required',
    'settings.workspaceDefaults': 'Workspace defaults',
    'settings.projectDefaults': 'Current project overrides',
    'settings.inheritWorkspace': 'Inherit workspace default',
    'settings.defaultText': 'Text',
    'settings.defaultDocument': 'Document',
    'settings.defaultImage': 'Image',
    'settings.defaultVideo': 'Video',
    'settings.defaultAudio': 'Audio',
    'settings.defaultAgent': 'Agent',
    'settings.statusNotInstalled': 'Not installed',
    'settings.statusNeedsCredentials': 'Needs credentials',
    'settings.statusNeedsLogin': 'Needs login',
    'settings.statusUntested': 'Untested',
    'settings.statusChecking': 'Checking',
    'settings.statusReady': 'Ready',
    'settings.statusUnavailable': 'Unavailable',
    'settings.loadingProviders': 'Loading execution providers…',
    'settings.noCompatibleConnection': 'No compatible ready connection',
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
    'resultStatus.canceled': 'Generation was canceled.',
    'resultStatus.codexQueued': 'Prompt ready. Start this task in Codex.',
    'resultStatus.codexRunning': 'Codex is generating this image.',
    'resultStatus.directApiQueued': 'Waiting for the image API worker to start.',
    'resultStatus.directApiRunning': 'The image API is generating this image.',
    'resultStatus.failed': 'Generation failed. Open execution details for more information.',
    'resultStatus.queued': 'Waiting for generation to start.',
    'resultStatus.running': 'Generating image.',
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
    'toolbar.generation': 'Generate',
    'toolbar.hideMiniMap': 'Hide minimap',
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
    'toolbar.generateText': 'Generate text',
    'toolbar.textToVideo': 'Text to video',
    'toolbar.undo': 'Undo (Cmd/Ctrl+Z)',
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
    'autosave.retry': '自动保存失败，点击重试',
    'workspace.loadingTitle': '正在加载工作区',
    'workspace.loadingBody': '正在等待 Retake 本地服务载入当前画板。',
    'workspace.loadErrorTitle': '工作区不可用',
    'workspace.loadErrorBody': 'Retake 未能加载可信的画板快照，画布已停止进入可编辑状态。',
    'workspace.retry': '重试',
    'block.document.body': '以素材形式保存的长篇 Markdown 文档。',
    'block.document.title': 'Markdown 文档',
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
    'document.characters': '字',
    'document.empty': '这份文档还没有内容。',
    'document.externalImageBlocked': '已阻止外部图片自动加载',
    'document.hideOutline': '隐藏大纲',
    'document.loadFailed': '无法加载 Markdown 素材',
    'document.noOutline': '尚未生成标题目录。',
    'document.openReview': '打开审阅',
    'document.outline': '目录',
    'document.preview': '预览',
    'document.reviewWorkspace': '文档审阅',
    'document.savedAsset': '已保存为 Markdown 素材',
    'document.source': '源码',
    'document.showOutline': '显示大纲',
    'document.streaming': '正在流式生成 Markdown',
    'document.viewMode': '文档视图',
    'document.waiting': '正在等待 Markdown 内容…',
    'videoGeneration.count': '数量',
    'videoGeneration.aspectRatio': '画幅',
    'videoGeneration.dreaminaCompleted': '即梦 CLI 视频生成完成',
    'videoGeneration.dreaminaCompletedNotice': '即梦 VIP 生成结果已导入 Retake AssetStore，并绑定到对应结果 Block。',
    'videoGeneration.dreaminaCostNotice': '本次使用当前已登录即梦账户的 seedance2.0_vip；每个结果都会独立提交并消耗会员额度。',
    'videoGeneration.dreaminaStarted': '即梦 CLI 视频生成已开始',
    'videoGeneration.duration': '时长',
    'videoGeneration.failed': '视频生成失败',
    'videoGeneration.generateMock': '生成测试视频',
    'videoGeneration.generateDreamina': '使用即梦 VIP 生成',
    'videoGeneration.generateSeedance': '使用 Seedance 生成',
    'videoGeneration.mockCompleted': '已生成测试视频结果',
    'videoGeneration.mockNotice': '本次只验证 Retake 执行链路，没有调用供应商，也不会产生模型费用。',
    'videoGeneration.mockResult': '测试视频结果',
    'videoGeneration.profileMock': '执行配置：Retake Mock · 不调用供应商',
    'videoGeneration.profile': '执行配置',
    'videoGeneration.profileMockOption': 'Retake Mock（免费）',
    'videoGeneration.profileDreamina': '执行配置：即梦官方 CLI · seedance2.0_vip · 远端任务提交后不可取消',
    'videoGeneration.profileDreaminaOption': '即梦 CLI（VIP 会员）',
    'videoGeneration.profileSeedance': '执行配置：Seedance 2.0 · ModelArk Direct API · 会产生供应商费用',
    'videoGeneration.profileSeedanceOption': 'Seedance 2.0（付费）',
    'videoGeneration.prompt': '视频提示词',
    'videoGeneration.promptPlaceholder': '描述动作、镜头、主体和场景…',
    'videoGeneration.running': '生成中…',
    'videoGeneration.seedanceCompleted': 'Seedance 视频生成完成',
    'videoGeneration.seedanceCompletedNotice': '生成视频已导入 Retake AssetStore，并绑定到对应结果 Block。',
    'videoGeneration.seedanceCostNotice': '本次会调用已配置的 ModelArk 账户；每个结果对应一个独立的付费供应商任务。',
    'videoGeneration.seedanceStarted': 'Seedance 视频生成已开始',
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
    'context.annotationSourceMissing': '请先给当前图片块绑定或生成图片素材。',
    'context.annotationTools': '标注工具',
    'context.addReferenceImage': '添加参考图',
    'context.aspectRatio': '比例',
    'context.brightness': '亮度',
    'context.annotationColorBlue': '蓝色',
    'context.annotationColorGreen': '绿色',
    'context.annotationColorPurple': '紫色',
    'context.annotationColorRed': '红色',
    'context.annotationColorYellow': '黄色',
    'context.clearAnnotationDraft': '清空标注草稿',
    'context.clearAnnotationDraftConfirm': '确定要清空所有标记和说明吗？此操作无法撤销。',
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
    'context.historicalAnnotationSession': '历史标注 · 临时会话',
    'context.historicalAnnotationSessionBody': '关闭不会影响当前草稿；执行会从这份历史输入创建新分支。',
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
    'context.rectangleTool': '矩形',
    'context.removeReferenceImage': '移除',
    'context.resolution': '画质',
    'context.relight': '重新打光',
    'context.removeBackground': '去背景',
    'context.regionBrushTool': '区域笔刷',
    'context.runWithCodex': '用 Codex 执行',
    'context.run': '执行',
    'context.saturation': '饱和度',
    'context.selectMarkTool': '选择标注',
    'context.selectedMark': '已选中',
    'context.selectedMarkColor': '所选标记颜色',
    'context.selectedTools': '选中块工具',
    'context.strokeSize': '线宽',
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
    'feedback.historicalAnnotationOpened': '已打开历史标注，当前草稿保持不变',
    'feedback.annotationDraftRestoreUnavailable': '无法恢复这份标注草稿',
    'feedback.copyPrompt': '复制提示',
    'feedback.promptTitle': 'Codex 提示',
    'feedback.taskCreated': '已创建 Codex 操作',
    'feedback.taskCreatedCopyFailed': '提示预览已生成，但复制到剪贴板失败。',
    'feedback.taskCreatedCopied': '提示已复制。继续在 Codex 中生成结果。',
    'feedback.handoffUnavailable': '暂时无法交给 Codex',
    'feedback.connectionUnavailable': '当前选择的连接不可用，请在 Settings 测试连接，或在默认值 / 当前 Operation 中手动更换。',
    'feedback.connectionAdapterUnavailable': '当前连接尚未安装图片执行 Adapter。',
    'feedback.inputRequired': '请完善操作输入',
    'feedback.executionCanceled': '已取消执行',
    'feedback.codexImageStarted': 'Codex 图片生成已开始',
    'feedback.codexImageCostNotice': 'Codex App Server 正在后台生成图片结果。',
    'feedback.codexImageCompleted': 'Codex 图片生成完成',
    'feedback.codexImageCompletedNotice': '生成图片已导入为 Retake Asset。',
    'feedback.codexImageFailed': 'Codex 图片生成失败',
    'feedback.seedreamStarted': 'Seedream 已开始生成',
    'feedback.seedreamCostNotice': '火山方舟正在后台生成付费图片结果。',
    'feedback.seedreamCompleted': 'Seedream 生成完成',
    'feedback.seedreamCompletedNotice': '生成图片已保存为 Retake Asset。',
    'feedback.seedreamFailed': 'Seedream 生成失败',
    'feedback.textGenerationStarted': '文本生成已开始',
    'feedback.textGenerationCompleted': '生成的 Markdown 已保存为 Retake Asset。',
    'feedback.textGenerationFailed': '文本生成失败',
    'feedback.screenplayStarted': '剧本处理已开始',
    'feedback.screenplayCompleted': '剧本处理已完成',
    'feedback.screenplayFailed': '剧本处理失败',
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
    'history.annotationDraftRestored': '已恢复标注草稿',
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
    'artifactLibrary.addToBoard': '添加到画板',
    'artifactLibrary.alreadyCurrent': '这个素材已经是该项目资产的当前版本。',
    'artifactLibrary.allTypes': '全部类型',
    'artifactLibrary.bindTarget': '绑定到当前操作',
    'artifactLibrary.bindToSlot': '可绑定输入',
    'artifactLibrary.boundBody': '已添加固定版本的项目资产，并连接到所选输入。',
    'artifactLibrary.boundTitle': '项目资产输入已连接',
    'artifactLibrary.close': '关闭项目资产库',
    'artifactLibrary.empty': '项目资产库还是空的。请选择带素材的块，将它提升为项目资产。',
    'artifactLibrary.eyebrow': '项目范围',
    'artifactLibrary.filterType': '按类型筛选项目资产',
    'artifactLibrary.insertedBody': '已在画板中添加固定到当前版本的项目资产块。',
    'artifactLibrary.insertedTitle': '项目资产已添加',
    'artifactLibrary.loading': '正在加载项目资产…',
    'artifactLibrary.name': '名称',
    'artifactLibrary.namePlaceholder': '项目内稳定的资产名称',
    'artifactLibrary.noResults': '没有符合当前筛选条件的项目资产。',
    'artifactLibrary.open': '项目资产库',
    'artifactLibrary.promote': '提升为项目资产',
    'artifactLibrary.promoteEyebrow': '当前画板素材',
    'artifactLibrary.promotedBody': '所选素材已成为带版本记录的项目资产。',
    'artifactLibrary.promotedTitle': '已加入项目资产库',
    'artifactLibrary.promotionSourceMissing': '请先选择一个带素材的图片、视频、文档或音频块。',
    'artifactLibrary.refresh': '刷新项目资产库',
    'artifactLibrary.revisions': '版本数',
    'artifactLibrary.search': '搜索项目资产',
    'artifactLibrary.title': '资产库',
    'artifactLibrary.type': '资产类型',
    'artifactLibrary.typeCharacterBible': '角色设定集',
    'artifactLibrary.typeCharacterReference': '角色参考',
    'artifactLibrary.typeCreativeBrief': '创意简报',
    'artifactLibrary.typePropReference': '道具参考',
    'artifactLibrary.typeSceneBible': '场景设定集',
    'artifactLibrary.typeSceneReference': '场景参考',
    'artifactLibrary.typeScreenplay': '剧本',
    'artifactLibrary.typeStoryboard': '分镜方案',
    'artifactLibrary.typeStyleReference': '风格参考',
    'artifactLibrary.typeVideo': '视频片段',
    'artifactLibrary.typeVoiceReference': '声音参考',
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
    'inspector.agentPrompt': 'Agent 执行提示',
    'inspector.annotatedComposite': '标注输入',
    'inspector.annotationGlobalInstruction': '全局说明',
    'inspector.annotationManifest': '标注 Manifest',
    'inspector.annotationPreview': '带标注的输入图',
    'inspector.annotationManifestRaw': '查看原始 Manifest',
    'inspector.annotationMarks': '标记',
    'inspector.annotationSourceChanged': '源图片已经变化，无法安全恢复这组坐标。',
    'inspector.annotationSourceMissing': '原始源图片块已经不存在。',
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
    'inspector.prompt': '用户提示词',
    'inspector.requestPrompt': '实际请求 Prompt',
    'inspector.requestPromptBatch': '个候选请求已合并',
    'inspector.restoreConfiguration': '恢复此版本配置',
    'inspector.restoreAnnotationDraft': '在标注编辑中打开',
    'inspector.skill': '技能',
    'inspector.source': '来源',
    'inspector.status': '状态',
    'inspector.title': '执行记录',
    'inspector.versionChanges': '此版本的变更',
    'operation.createSimilar.prompt': '生成同款图片',
    'operation.createSimilar.title': '生成同款图片',
    'operation.generateImage.prompt': '根据 prompt 生成图片',
    'operation.generateImage.title': '文生图',
    'operation.generateText.title': '生成文本',
    'operation.generateScreenplay.title': '生成剧本',
    'operation.organizeScreenplay.title': '整理剧本',
    'operation.defineCharacter.title': '生成角色设定',
    'operation.defineScene.title': '生成场景设定',
    'operation.generateStoryboardPlan.title': '生成故事板计划',
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
    'operationToolbar.generateImage': '生成图片',
    'operationToolbar.generateText': '生成文本',
    'operationToolbar.generateScreenplay': '生成剧本',
    'operationToolbar.organizeScreenplay': '整理剧本',
    'operationToolbar.defineCharacter': '生成角色设定',
    'operationToolbar.defineScene': '生成场景设定',
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
    'operationToolbar.skill': 'Skill',
    'operationToolbar.selectSkill': '选择 Skill',
    'skillDock.title': 'Skill',
    'skillDock.recommended': '推荐 Skill',
    'skillDock.more': '更多',
    'skillDock.library': 'Skill 与 Workflow 库',
    'skillDock.search': '搜索 Skill 与 Workflow',
    'skillDock.screenplayCategory': '剧本',
    'skillDock.skillCategory': '单节点 Skill',
    'skillDock.workflowBadge': 'Workflow',
    'skillDock.workflowCategory': 'Workflow',
    'skillComposer.title': 'Skill 快速输入',
    'skillComposer.chooseEntryPoint': '/ 选择',
    'skillComposer.slashPlaceholder': '输入 / 选择 Skill 或 Workflow...',
    'skillComposer.inputPlaceholder': '描述输入，或输入 @ 引用 Block / Asset...',
    'skillComposer.create': '创建草稿',
    'skillComposer.addMention': '引用 Block 或 Asset',
    'skillComposer.selectedMentions': '已引用输入',
    'skillComposer.removeMention': '移除引用',
    'skillComposer.mentionLibrary': '兼容的 Block 与 Asset',
    'skillComposer.searchMentions': '搜索兼容的 Block 与 Asset',
    'skillComposer.blockMention': 'Block',
    'skillComposer.assetMention': 'Asset',
    'skillComposer.noEntryPoints': '没有匹配的 Skill 或 Workflow。',
    'skillComposer.noMentions': '当前没有兼容的 Block 或 Document Asset。',
    'skillComposer.invalidInput': '当前输入组合与所选 EntryPoint 不兼容。',
    'skill.common.referencesInput': '补充要求 / 参考资料',
    'skill.common.referencesPlaceholder': '补充可选要求或参考资料...',
    'skill.screenplayFromBrief.name': '生成剧本',
    'skill.screenplayFromBrief.description': '从创意 Brief 生成可执行的视频剧本。',
    'skill.screenplayFromBrief.input': '创意 Brief',
    'skill.screenplayFromBrief.placeholder': '描述题材、受众、约束、角色与必须保留的结局...',
    'skill.normalizeScreenplay.name': '整理剧本',
    'skill.normalizeScreenplay.description': '在不改变剧情事实的前提下整理已有剧本。',
    'skill.normalizeScreenplay.input': '源剧本',
    'skill.normalizeScreenplay.placeholder': '粘贴需要规范化的剧本，或先选择一个 Document Block...',
    'skill.normalizeScreenplay.instructionInput': '整理要求',
    'skill.normalizeScreenplay.instructionPlaceholder': '描述如何整理剧本，但不要改变剧情事实...',
    'skill.characterBible.name': '生成角色设定',
    'skill.characterBible.description': '从剧本提取稳定的角色设计与连续性约束。',
    'skill.characterBible.input': '源剧本',
    'skill.characterBible.placeholder': '连接或粘贴用于生成角色设定的剧本...',
    'skill.sceneBible.name': '生成场景设定',
    'skill.sceneBible.description': '从剧本提取场景、空间、灯光与连续性约束。',
    'skill.sceneBible.input': '源剧本',
    'skill.sceneBible.placeholder': '连接或粘贴用于生成场景设定的剧本...',
    'skill.storyboardPlan.name': '生成故事板计划',
    'skill.storyboardPlan.description': '将剧本、角色设定与场景设定整理为镜头级故事板计划。',
    'skill.storyboardPlan.screenplayInput': '剧本',
    'skill.storyboardPlan.screenplayPlaceholder': '连接或粘贴作为剧情依据的剧本...',
    'skill.storyboardPlan.characterInput': '角色设定',
    'skill.storyboardPlan.characterPlaceholder': '连接或粘贴已确认的角色设计与连续性约束...',
    'skill.storyboardPlan.sceneInput': '场景设定',
    'skill.storyboardPlan.scenePlaceholder': '连接或粘贴已确认的场景、空间、灯光与连续性约束...',
    'workflow.storyToStoryboard.name': '从 Brief 到故事板计划',
    'workflow.storyToStoryboard.description': '创建从 Brief、剧本、角色与场景设定到故事板计划的可编辑草稿图。',
    'workflowDraft.outputPending': '执行上游 Operation 后将在这里生成文档。',
    'workflowRuntime.create': '创建 Workflow Run',
    'workflowRuntime.createFailed': '无法创建 Workflow Run',
    'workflowRuntime.created': 'Workflow Run 已创建',
    'workflowRuntime.createdBody': '现在可以手动启动已就绪的 Step。',
    'workflowRuntime.definition': 'Definition',
    'workflowRuntime.gateApprove': '批准',
    'workflowRuntime.gateApproved': 'Gate 已批准',
    'workflowRuntime.gateArtifactRevision': 'Artifact Revision',
    'workflowRuntime.gateAssets': '审阅资产',
    'workflowRuntime.gateDecisionBody': 'Workflow 已根据这次显式决定更新状态。',
    'workflowRuntime.gateDecisionFailed': '无法记录 Gate 决定',
    'workflowRuntime.gateReject': '拒绝',
    'workflowRuntime.gateRejected': 'Gate 已拒绝',
    'workflowRuntime.gates': '人工审批 Gate',
    'workflowRuntime.gateSubject': '审阅对象',
    'workflowRuntime.gateStatus.failed': '已拒绝',
    'workflowRuntime.gateStatus.not_ready': '尚未就绪',
    'workflowRuntime.gateStatus.passed': '已批准',
    'workflowRuntime.gateStatus.waiting_approval': '等待批准',
    'workflowRuntime.changeSelectedOutput': '改用这个结果',
    'workflowRuntime.outdated': '上游已变化',
    'workflowRuntime.outputSelected': '已选用 Workflow 输出',
    'workflowRuntime.outputSelectedBody': 'Workflow 现在可以从这个结果继续推进。',
    'workflowRuntime.outputSelectionFailed': '无法选用 Workflow 输出',
    'workflowRuntime.run': 'Workflow Run',
    'workflowRuntime.runId': 'Run ID',
    'workflowRuntime.stages': '阶段',
    'workflowRuntime.stageOptionalSteps': '可选 Step',
    'workflowRuntime.stageOutputs': '阶段输出',
    'workflowRuntime.stageOutputReadiness.current': 'Artifact binding 当前有效',
    'workflowRuntime.stageOutputReadiness.not_required': '不要求阶段输出',
    'workflowRuntime.stageOutputReadiness.pending': '等待 Artifact binding',
    'workflowRuntime.stageStatus.needs_attention': '需要处理',
    'workflowRuntime.stageStatus.pending': '等待上游',
    'workflowRuntime.stageStatus.ready': '已就绪',
    'workflowRuntime.stageStatus.running': '运行中',
    'workflowRuntime.stageStatus.succeeded': 'Step 与 Gate 已完成',
    'workflowRuntime.stageStatus.waiting_approval': '等待批准',
    'workflowRuntime.stageStatus.waiting_input': '等待输入',
    'workflowRuntime.stageStatus.waiting_selection': '等待选择',
    'workflowRuntime.stageSteps': '必需 Step',
    'workflowRuntime.step': 'Workflow Step',
    'workflowRuntime.stepExecutions': '执行次数',
    'workflowRuntime.stepNotReady': '这个 Workflow Step 正在等待上游依赖。',
    'workflowRuntime.steps': 'Steps',
    'workflowRuntime.selectOutput': '选用这个结果',
    'workflowRuntime.selectedOutput': 'Workflow 已选用',
    'workflowRuntime.view': '查看 Workflow Run',
    'workflowRuntime.runStatus.canceled': '已取消',
    'workflowRuntime.runStatus.draft': '草稿',
    'workflowRuntime.runStatus.failed': '失败',
    'workflowRuntime.runStatus.needs_attention': '需要处理',
    'workflowRuntime.runStatus.paused': '已暂停',
    'workflowRuntime.runStatus.ready': '已就绪',
    'workflowRuntime.runStatus.running': '运行中',
    'workflowRuntime.runStatus.succeeded': '已完成',
    'workflowRuntime.runStatus.waiting_approval': '等待批准',
    'workflowRuntime.runStatus.waiting_input': '等待输入',
    'workflowRuntime.runStatus.waiting_selection': '等待选择',
    'workflowRuntime.stepStatus.blocked': '已阻塞',
    'workflowRuntime.stepStatus.canceled': '已取消',
    'workflowRuntime.stepStatus.failed': '失败',
    'workflowRuntime.stepStatus.pending': '等待上游',
    'workflowRuntime.stepStatus.queued': '排队中',
    'workflowRuntime.stepStatus.ready': '已就绪',
    'workflowRuntime.stepStatus.running': '运行中',
    'workflowRuntime.stepStatus.skipped': '已跳过',
    'workflowRuntime.stepStatus.succeeded': '已完成',
    'workflowRuntime.stepStatus.waiting_input': '等待输入',
    'workflowRuntime.stepStatus.waiting_selection': '等待选择',
    'agentRuntime.actionFailed': 'Agent 操作失败',
    'agentRuntime.cancel': '停止 Agent',
    'agentRuntime.canceled': 'Agent Run 已停止',
    'agentRuntime.cancelCurrentExecutionContinues': 'Agent 不会再启动下一个 Step；已经运行中的 Execution 不会被取消。',
    'agentRuntime.created': 'Agent Run 已启动',
    'agentRuntime.executions': 'Execution 数量',
    'agentRuntime.executionRange': '运行范围',
    'agentRuntime.fullWorkflow': '完整 Workflow',
    'agentRuntime.pause': '暂停',
    'agentRuntime.paused': 'Agent Run 已暂停',
    'agentRuntime.permissions': '权限',
    'agentRuntime.resume': '继续',
    'agentRuntime.resumed': 'Agent Run 已继续',
    'agentRuntime.run': 'Agent Run',
    'agentRuntime.runId': 'Agent Run ID',
    'agentRuntime.startWorkflow': '交给 Agent 推进现有 Workflow',
    'agentRuntime.startSelectedTarget': '启动 Agent',
    'agentRuntime.stopPolicy': '停止条件',
    'agentRuntime.target': '类型化目标',
    'agentRuntime.untilStep': '运行到',
    'agentRuntime.untilArtifact': '运行到 Artifact',
    'agentRuntime.untilStage': '运行到阶段',
    'agentRuntime.status.canceled': '已停止',
    'agentRuntime.status.failed': '失败',
    'agentRuntime.status.needs_attention': '需要处理',
    'agentRuntime.status.paused': '已暂停',
    'agentRuntime.status.queued': '等待启动',
    'agentRuntime.status.running': '运行中',
    'agentRuntime.status.succeeded': '已完成',
    'agentRuntime.status.waiting_approval': '等待批准',
    'agentRuntime.status.waiting_input': '等待输入',
    'agentRuntime.status.waiting_selection': '等待选择',
    'agentWorkspace.addEntrypoint': '添加 / Skill 或 Workflow',
    'agentWorkspace.addMention': '添加引用',
    'agentWorkspace.agent': 'Agent',
    'agentWorkspace.approveProposal': '批准并应用',
    'agentWorkspace.archiveSession': '归档会话',
    'agentWorkspace.changes': '变更',
    'agentWorkspace.changesEmpty': '超出范围的请求会在这里形成可审阅的 Change Proposal。',
    'agentWorkspace.chat': '对话',
    'agentWorkspace.chatEmpty': '可以询问当前画板，或控制已绑定 Agent Run 的允许动作。',
    'agentWorkspace.createSession': '创建会话',
    'agentWorkspace.emptyBody': '会话保存当前画板范围内的对话，并且可以绑定一个已有 Agent Run。',
    'agentWorkspace.emptyTitle': '开始画板 Agent 会话',
    'agentWorkspace.eyebrow': '画板 Agent',
    'agentWorkspace.inputPlaceholder': '询问当前画板，或请求 Agent Run 范围内的动作…',
    'agentWorkspace.newSession': '新建会话',
    'agentWorkspace.noRun': '未绑定 Agent Run',
    'agentWorkspace.noSession': '没有活动会话',
    'agentWorkspace.open': '打开 Agent Workspace',
    'agentWorkspace.rejectProposal': '拒绝提案',
    'agentWorkspace.run': '运行',
    'agentWorkspace.runEmpty': '绑定已有 Agent Run；聊天本身不会创建执行授权。',
    'agentWorkspace.runId': 'Agent Run ID',
    'agentWorkspace.runtime': 'Runtime 绑定',
    'agentWorkspace.scope': '授权范围',
    'agentWorkspace.send': '发送消息',
    'agentWorkspace.session': '会话',
    'agentWorkspace.status': '状态',
    'agentWorkspace.streaming': '正在接收结构化决策…',
    'agentWorkspace.targetRun': '已绑定 Agent Run',
    'agentWorkspace.thinking': '正在已授权范围内处理…',
    'agentWorkspace.title': 'Agent Workspace',
    'agentWorkspace.you': '你',
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
    'settings.executionProviders': '执行与服务商',
    'settings.executionProvidersDescription': '配置 Direct API、本机 Agent Host、Provider CLI，以及各类能力的默认执行方式。',
    'settings.connections': '连接',
    'settings.connectionsDescription': '每条连接绑定一个明确的模型、API 账号和服务端点。',
    'settings.addConnection': '添加连接',
    'settings.connectionTemplate': '服务模板',
    'settings.connectionName': '连接名称',
    'settings.providerLabel': '服务商标识',
    'settings.modelIds': '模型 ID',
    'settings.modelIdsPlaceholder': '填写这条连接实际调用的唯一模型 ID',
    'settings.loadingModels': '正在从 Codex CLI 获取模型…',
    'settings.modelsFromCli': '模型列表来自 Codex CLI',
    'settings.modelCatalogUnavailable': '暂时无法获取 CLI 模型列表，请检查或升级 Codex CLI 后重试。',
    'settings.createConnection': '创建连接',
    'settings.deleteConnection': '删除',
    'settings.duplicateConnection': '复制连接',
    'settings.confirmDeleteConnection': '确认删除连接',
    'settings.models': '模型',
    'settings.noBoundCapabilities': '仅连接基础，尚未绑定执行能力',
    'settings.defaults': '默认值',
    'settings.configure': '配置',
    'settings.checkConnection': '测试连接',
    'settings.checkMayCost': 'OpenAI-compatible、Anthropic 和 Gemini 测试会发送一次极小的付费文本请求；火山方舟只校验图片端点和鉴权，不生成资产；ModelArk 只读取任务列表。',
    'settings.lastTested': '上次测试',
    'settings.testRequired': '请先保存连接，再完成测试后用于执行。',
    'settings.saveConnection': '保存连接',
    'settings.apiKey': 'API Key / Secret',
    'settings.apiKeyCreatePlaceholder': '填写此连接使用的 API Key 或 Secret',
    'settings.apiKeyPlaceholder': '留空则保留服务端已存储的 Key',
    'settings.baseUrl': 'Base URL',
    'settings.model': '模型 ID',
    'settings.capabilities': '支持能力',
    'settings.useCases': '用途',
    'settings.useCasesDescription': '选择这条具体模型连接可用于哪些领域；模板只提供可修改的默认值。',
    'settings.agentHostUseCases': '由 Agent Runtime 单独管理',
    'settings.credentialsStored': '凭据已存储在 Retake 服务端',
    'settings.credentialsMissing': '需要配置凭据',
    'settings.workspaceDefaults': 'Workspace 默认值',
    'settings.projectDefaults': '当前 Project 覆盖',
    'settings.inheritWorkspace': '继承 Workspace 默认值',
    'settings.defaultText': '文本',
    'settings.defaultDocument': '文档',
    'settings.defaultImage': '图片',
    'settings.defaultVideo': '视频',
    'settings.defaultAudio': '音频',
    'settings.defaultAgent': 'Agent',
    'settings.statusNotInstalled': '未安装',
    'settings.statusNeedsCredentials': '需要凭据',
    'settings.statusNeedsLogin': '需要登录',
    'settings.statusUntested': '未测试',
    'settings.statusChecking': '检测中',
    'settings.statusReady': '可用',
    'settings.statusUnavailable': '不可用',
    'settings.loadingProviders': '正在加载执行服务商…',
    'settings.noCompatibleConnection': '没有兼容且可用的连接',
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
    'resultStatus.canceled': '生成已取消。',
    'resultStatus.codexQueued': '提示已准备好，请在 Codex 中开始执行。',
    'resultStatus.codexRunning': 'Codex 正在生成这张图片。',
    'resultStatus.directApiQueued': '正在等待图片 API 任务开始。',
    'resultStatus.directApiRunning': '图片 API 正在生成这张图片。',
    'resultStatus.failed': '生成失败，请打开执行信息查看详情。',
    'resultStatus.queued': '正在等待生成任务开始。',
    'resultStatus.running': '正在生成图片。',
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
    'toolbar.generation': '生成',
    'toolbar.hideMiniMap': '隐藏小地图',
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
    'toolbar.generateText': '生成文本',
    'toolbar.textToVideo': '文生视频',
    'toolbar.undo': '撤销 (Cmd/Ctrl+Z)',
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
