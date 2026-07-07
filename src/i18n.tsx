import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

export type Locale = 'en' | 'zh';

type TranslationKey =
  | 'autosave.error'
  | 'autosave.idle'
  | 'autosave.saved'
  | 'autosave.saving'
  | 'block.image.body'
  | 'block.image.title'
  | 'block.task.body'
  | 'block.task.title'
  | 'block.text.body'
  | 'block.text.title'
  | 'block.video.body'
  | 'block.videoPlaceholder'
  | 'block.video.title'
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
  | 'context.clearMarks'
  | 'context.clearMarksConfirm'
  | 'context.close'
  | 'context.contrast'
  | 'context.createSimilar'
  | 'context.crop'
  | 'context.deleteMark'
  | 'context.describeChange'
  | 'context.ellipseTool'
  | 'context.eraserTool'
  | 'context.expand'
  | 'context.executionRoute'
  | 'context.executionRouteCodexMcp'
  | 'context.free'
  | 'context.generateImage'
  | 'context.generatePromptPlaceholder'
  | 'context.customSize'
  | 'context.height'
  | 'context.importImage'
  | 'context.markColor'
  | 'context.more'
  | 'context.moreTools'
  | 'context.multiAngle'
  | 'context.penTool'
  | 'context.quickEdit'
  | 'context.referenceImage'
  | 'context.referenceImages'
  | 'context.referenceImagesEmpty'
  | 'context.redoAnnotation'
  | 'context.rectangleTool'
  | 'context.removeReferenceImage'
  | 'context.resolution'
  | 'context.relight'
  | 'context.removeBackground'
  | 'context.runWithCodex'
  | 'context.run'
  | 'context.saturation'
  | 'context.selectMarkTool'
  | 'context.selectedTools'
  | 'context.strokeSize'
  | 'context.textMarkTool'
  | 'context.undoAnnotation'
  | 'context.width'
  | 'context.pixels'
  | 'feedback.closePrompt'
  | 'feedback.copied'
  | 'feedback.copyPrompt'
  | 'feedback.promptTitle'
  | 'feedback.taskCreated'
  | 'feedback.taskCreatedCopyFailed'
  | 'feedback.taskCreatedCopied'
  | 'history.close'
  | 'history.collapse'
  | 'history.empty'
  | 'history.execution'
  | 'history.executionFailed'
  | 'history.executionSucceeded'
  | 'history.locateBlock'
  | 'history.open'
  | 'history.expand'
  | 'history.promptCopied'
  | 'history.promptCopiedSubtitle'
  | 'history.resultUpdated'
  | 'history.title'
  | 'language.label'
  | 'language.english'
  | 'language.chinese'
  | 'inspector.adapter'
  | 'inspector.annotatedComposite'
  | 'inspector.annotationText'
  | 'inspector.capability'
  | 'inspector.close'
  | 'inspector.closePreview'
  | 'inspector.executionId'
  | 'inspector.imageComparison'
  | 'inspector.inputAssets'
  | 'inspector.nextPreview'
  | 'inspector.none'
  | 'inspector.openDetails'
  | 'inspector.outputAssets'
  | 'inspector.prompt'
  | 'inspector.skill'
  | 'inspector.source'
  | 'inspector.status'
  | 'inspector.title'
  | 'operation.createSimilar.prompt'
  | 'operation.createSimilar.title'
  | 'operation.generateImage.prompt'
  | 'operation.generateImage.title'
  | 'operation.annotationEdit.prompt'
  | 'operation.annotationEdit.title'
  | 'operation.quickEdit.prompt'
  | 'operation.quickEdit.title'
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
  | 'status.failed'
  | 'status.queued'
  | 'status.running'
  | 'status.succeeded'
  | 'toolbar.addImage'
  | 'toolbar.addText'
  | 'toolbar.addVideo'
  | 'toolbar.boardMenu'
  | 'toolbar.deleteSelection'
  | 'toolbar.duplicateSelection'
  | 'toolbar.fitView'
  | 'toolbar.hideMiniMap'
  | 'toolbar.menu'
  | 'toolbar.moreSettings'
  | 'toolbar.panTool'
  | 'toolbar.redo'
  | 'toolbar.refreshBoard'
  | 'toolbar.selectTool'
  | 'toolbar.showMiniMap'
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
    'block.image.body': 'Import or generate an asset to attach assetId.',
    'block.image.title': 'Image block',
    'block.task.body': 'Choose capability, skill, and adapter.',
    'block.task.title': 'New task',
    'block.text.body': 'Prompt, script note, reference, or story fragment.',
    'block.text.title': 'Text block',
    'block.video.body': 'Video preview should load lazily in later spikes.',
    'block.videoPlaceholder': 'Video asset placeholder',
    'block.video.title': 'Video block',
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
    'context.clearMarks': 'Clear all marks',
    'context.clearMarksConfirm': 'Clear all annotations? This cannot be undone except by annotation undo.',
    'context.close': 'Close',
    'context.contrast': 'Contrast',
    'context.createSimilar': 'Create similar',
    'context.crop': 'Crop',
    'context.deleteMark': 'Delete',
    'context.describeChange': 'Describe the change...',
    'context.ellipseTool': 'Ellipse',
    'context.eraserTool': 'Eraser',
    'context.expand': 'Expand',
    'context.executionRoute': 'Executor',
    'context.executionRouteCodexMcp': 'Codex MCP',
    'context.free': 'Free',
    'context.generateImage': 'Generate image',
    'context.generatePromptPlaceholder': 'Describe the image to generate...',
    'context.customSize': 'Output size',
    'context.height': 'H',
    'context.importImage': 'Import image',
    'context.markColor': 'Color',
    'context.more': 'More',
    'context.moreTools': 'More image tools',
    'context.multiAngle': 'Multi-angle',
    'context.penTool': 'Pen',
    'context.quickEdit': 'Quick edit',
    'context.referenceImage': 'Reference image',
    'context.referenceImages': 'Reference images',
    'context.referenceImagesEmpty': 'No reference images',
    'context.redoAnnotation': 'Redo annotation',
    'context.rectangleTool': 'Rectangle',
    'context.removeReferenceImage': 'Remove',
    'context.resolution': 'Resolution',
    'context.relight': 'Relight',
    'context.removeBackground': 'Remove background',
    'context.runWithCodex': 'Run with Codex',
    'context.run': 'Run',
    'context.saturation': 'Saturation',
    'context.selectMarkTool': 'Select mark',
    'context.selectedTools': 'Selected block tools',
    'context.strokeSize': 'Stroke',
    'context.textMarkTool': 'Text note',
    'context.undoAnnotation': 'Undo annotation',
    'context.width': 'W',
    'context.pixels': 'PX',
    'feedback.closePrompt': 'Close prompt preview',
    'feedback.copied': 'Copied',
    'feedback.copyPrompt': 'Copy prompt',
    'feedback.promptTitle': 'Codex prompt',
    'feedback.taskCreated': 'Codex operation created',
    'feedback.taskCreatedCopyFailed': 'Prompt preview is ready, but clipboard copy failed.',
    'feedback.taskCreatedCopied': 'Prompt copied. Continue in Codex to generate the result.',
    'history.close': 'Close history',
    'history.collapse': 'Collapse details',
    'history.empty': 'No history yet',
    'history.execution': 'Execution',
    'history.executionFailed': 'Execution failed',
    'history.executionSucceeded': 'Execution succeeded',
    'history.locateBlock': 'Locate block',
    'history.open': 'Board history',
    'history.expand': 'Expand details',
    'history.promptCopied': 'Prompt copied',
    'history.promptCopiedSubtitle': 'Prompt copied for reuse',
    'history.resultUpdated': 'Result updated',
    'history.title': 'History',
    'language.label': 'Language',
    'language.english': 'English',
    'language.chinese': '中文',
    'inspector.adapter': 'Adapter',
    'inspector.annotatedComposite': 'Annotated brief',
    'inspector.annotationText': 'Annotation notes',
    'inspector.capability': 'Capability',
    'inspector.close': 'Close inspector',
    'inspector.closePreview': 'Close preview',
    'inspector.executionId': 'Execution ID',
    'inspector.imageComparison': 'Image brief',
    'inspector.inputAssets': 'Input assets',
    'inspector.nextPreview': 'Next image',
    'inspector.none': 'None',
    'inspector.openDetails': 'Show execution details',
    'inspector.outputAssets': 'Output assets',
    'inspector.prompt': 'Prompt',
    'inspector.skill': 'Skill',
    'inspector.source': 'Source',
    'inspector.status': 'Status',
    'inspector.title': 'Execution',
    'operation.createSimilar.prompt': 'Create similar image',
    'operation.createSimilar.title': 'Create similar image',
    'operation.generateImage.prompt': 'Generate image from prompt',
    'operation.generateImage.title': 'Generate image',
    'operation.annotationEdit.prompt': 'Edit image from annotation note',
    'operation.annotationEdit.title': 'Annotation Edit',
    'operation.quickEdit.prompt': 'Quick edit image',
    'operation.quickEdit.title': 'Quick edit image',
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
    'status.failed': 'failed',
    'status.queued': 'queued',
    'status.running': 'running',
    'status.succeeded': 'succeeded',
    'toolbar.addImage': 'Add image block',
    'toolbar.addText': 'Add text block',
    'toolbar.addVideo': 'Add video block',
    'toolbar.boardMenu': 'Project and board menu',
    'toolbar.deleteSelection': 'Delete selected blocks',
    'toolbar.duplicateSelection': 'Duplicate selected blocks',
    'toolbar.fitView': 'Fit view',
    'toolbar.hideMiniMap': 'Hide minimap',
    'toolbar.menu': 'Open menu',
    'toolbar.moreSettings': 'More settings',
    'toolbar.panTool': 'Pan canvas',
    'toolbar.redo': 'Redo (Cmd/Ctrl+Shift+Z)',
    'toolbar.refreshBoard': 'Refresh board',
    'toolbar.selectTool': 'Select and move',
    'toolbar.showMiniMap': 'Show minimap',
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
    'block.image.body': '导入或生成素材后会绑定 assetId。',
    'block.image.title': '图片块',
    'block.task.body': '选择能力、技能和执行适配器。',
    'block.task.title': '新任务',
    'block.text.body': '提示词、脚本备注、参考内容或故事片段。',
    'block.text.title': '文本块',
    'block.video.body': '视频预览会在后续版本中按需加载。',
    'block.videoPlaceholder': '视频素材占位',
    'block.video.title': '视频块',
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
    'context.aspectRatio': '选择比例',
    'context.brightness': '亮度',
    'context.clearMarks': '清空所有标注',
    'context.clearMarksConfirm': '确定要清空所有标注吗？清空后只能通过标注撤销恢复。',
    'context.close': '关闭',
    'context.contrast': '对比度',
    'context.createSimilar': '生成同款',
    'context.crop': '裁剪',
    'context.deleteMark': '删除',
    'context.describeChange': '描述要修改的内容...',
    'context.ellipseTool': '圆形',
    'context.eraserTool': '橡皮',
    'context.expand': '扩图',
    'context.executionRoute': '执行方式',
    'context.executionRouteCodexMcp': 'Codex MCP',
    'context.free': '自由',
    'context.generateImage': '生成图片',
    'context.generatePromptPlaceholder': '描述要生成的图片...',
    'context.customSize': '输出尺寸',
    'context.height': 'H',
    'context.importImage': '导入图片',
    'context.markColor': '颜色',
    'context.more': '更多',
    'context.moreTools': '更多图片工具',
    'context.multiAngle': '多角度',
    'context.penTool': '画笔',
    'context.quickEdit': '快捷编辑',
    'context.referenceImage': '参考图',
    'context.referenceImages': '参考图 / 风格图',
    'context.referenceImagesEmpty': '未添加参考图',
    'context.redoAnnotation': '重做标注',
    'context.rectangleTool': '矩形',
    'context.removeReferenceImage': '移除',
    'context.resolution': '选择分辨率',
    'context.relight': '重新打光',
    'context.removeBackground': '去背景',
    'context.runWithCodex': '用 Codex 执行',
    'context.run': '执行',
    'context.saturation': '饱和度',
    'context.selectMarkTool': '选择标注',
    'context.selectedTools': '选中块工具',
    'context.strokeSize': '线宽',
    'context.textMarkTool': '文字标注',
    'context.undoAnnotation': '撤销标注',
    'context.width': 'W',
    'context.pixels': 'PX',
    'feedback.closePrompt': '关闭提示预览',
    'feedback.copied': '已复制',
    'feedback.copyPrompt': '复制提示',
    'feedback.promptTitle': 'Codex 提示',
    'feedback.taskCreated': '已创建 Codex 操作',
    'feedback.taskCreatedCopyFailed': '提示预览已生成，但复制到剪贴板失败。',
    'feedback.taskCreatedCopied': '提示已复制。继续在 Codex 中生成结果。',
    'history.close': '关闭历史记录',
    'history.collapse': '收起详情',
    'history.empty': '暂无历史记录',
    'history.execution': '执行',
    'history.executionFailed': '执行失败',
    'history.executionSucceeded': '执行成功',
    'history.locateBlock': '定位到块',
    'history.open': '画板历史',
    'history.expand': '展开详情',
    'history.promptCopied': '已复制提示',
    'history.promptCopiedSubtitle': '提示已复制，可用于再次执行',
    'history.resultUpdated': '结果已更新',
    'history.title': '历史记录',
    'language.label': '语言',
    'language.english': 'English',
    'language.chinese': '中文',
    'inspector.adapter': '适配器',
    'inspector.annotatedComposite': '标注输入',
    'inspector.annotationText': '标注文字',
    'inspector.capability': '能力',
    'inspector.close': '关闭执行记录',
    'inspector.closePreview': '关闭大图',
    'inspector.executionId': '执行 ID',
    'inspector.imageComparison': '图片对比',
    'inspector.inputAssets': '输入素材',
    'inspector.nextPreview': '切换图片',
    'inspector.none': '无',
    'inspector.openDetails': '查看执行记录',
    'inspector.outputAssets': '输出素材',
    'inspector.prompt': '提示',
    'inspector.skill': '技能',
    'inspector.source': '来源',
    'inspector.status': '状态',
    'inspector.title': '执行记录',
    'operation.createSimilar.prompt': '生成同款图片',
    'operation.createSimilar.title': '生成同款图片',
    'operation.generateImage.prompt': '根据 prompt 生成图片',
    'operation.generateImage.title': '生成图片',
    'operation.annotationEdit.prompt': '根据标注备注编辑图片',
    'operation.annotationEdit.title': '标注编辑',
    'operation.quickEdit.prompt': '快捷编辑图片',
    'operation.quickEdit.title': '快捷编辑图片',
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
    'status.failed': '失败',
    'status.queued': '等待中',
    'status.running': '运行中',
    'status.succeeded': '已完成',
    'toolbar.addImage': '添加图片块',
    'toolbar.addText': '添加文本块',
    'toolbar.addVideo': '添加视频块',
    'toolbar.boardMenu': '项目和画板菜单',
    'toolbar.deleteSelection': '删除选中块',
    'toolbar.duplicateSelection': '复制选中块',
    'toolbar.fitView': '适应画布',
    'toolbar.hideMiniMap': '隐藏小地图',
    'toolbar.menu': '打开菜单',
    'toolbar.moreSettings': '更多设置',
    'toolbar.panTool': '拖动画布',
    'toolbar.redo': '重做 (Cmd/Ctrl+Shift+Z)',
    'toolbar.refreshBoard': '刷新画板',
    'toolbar.selectTool': '选择和移动',
    'toolbar.showMiniMap': '显示小地图',
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
