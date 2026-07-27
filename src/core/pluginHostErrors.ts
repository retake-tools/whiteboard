import { PluginHostErrorV2 } from '@retake-tools/plugin-runtime';

type PluginHostMessageKey =
  | 'activeProject'
  | 'boardUnavailable'
  | 'draftPermission'
  | 'hostVersion'
  | 'imageDataUrl'
  | 'internal';

const messages: Record<
  'en' | 'zh',
  Record<PluginHostMessageKey, string>
> = {
  en: {
    activeProject: 'Plugin asset import requires an active project.',
    boardUnavailable: 'Plugin access is unavailable before the active Board is ready.',
    draftPermission: 'Plugin draft write permission was not granted.',
    hostVersion: 'This Plugin Host API version is not supported.',
    imageDataUrl: 'Plugin asset import requires an image Data URL.',
    internal: 'The Plugin Host could not complete this request.',
  },
  zh: {
    activeProject: '插件导入素材前需要打开一个项目。',
    boardUnavailable: '当前画板尚未就绪，插件暂时无法访问。',
    draftPermission: '插件尚未获得草稿写入权限。',
    hostVersion: '当前插件 Host API 版本不受支持。',
    imageDataUrl: '插件导入图片时必须提供图片 Data URL。',
    internal: '插件 Host 无法完成这次请求。',
  },
};

export function pluginHostMessage(
  locale: string,
  key: PluginHostMessageKey,
): string {
  return messages[locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'][key];
}

export function normalizePluginHostError(
  error: unknown,
  locale: string,
): PluginHostErrorV2 {
  if (error instanceof PluginHostErrorV2) return error;
  if (
    error instanceof DOMException
    && error.name === 'AbortError'
  ) {
    return new PluginHostErrorV2('aborted', error.message, { cause: error });
  }
  return new PluginHostErrorV2(
    'internal',
    pluginHostMessage(locale, 'internal'),
    { cause: error },
  );
}
