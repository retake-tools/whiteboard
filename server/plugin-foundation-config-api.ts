import type {
  PluginHostExperienceProfileV1,
  PluginJsonValueV2,
  PluginSettingScopeV1,
  PluginSettingsV1,
} from '@retake-tools/package-sdk';
import {
  PluginFoundationConfigStore,
} from './plugin-foundation-config-store';
import {
  PluginProfileStore,
} from './plugin-profile-store';

export type PluginFoundationConfigApiResult =
  | { handled: false }
  | { handled: true; statusCode?: number; value: unknown };

export async function handlePluginFoundationConfigRequest(input: {
  method: string;
  pathname: string;
  readBody(): Promise<unknown>;
  profileStore: PluginProfileStore;
  store: PluginFoundationConfigStore;
}): Promise<PluginFoundationConfigApiResult> {
  if (
    input.method === 'GET'
    && input.pathname === '/plugin-foundation/profile'
  ) {
    return { handled: true, value: await input.profileStore.read() };
  }
  if (
    input.method === 'POST'
    && input.pathname === '/plugin-foundation/profile'
  ) {
    const body = await input.readBody() as {
      boardId?: string | null;
      pluginModuleId?: string;
      projectId?: string;
      scope?: 'board' | 'project';
      state?: 'disabled' | 'enabled' | 'inherit';
    };
    return {
      handled: true,
      value: await input.profileStore.update({
        boardId: body.boardId ?? null,
        pluginModuleId: body.pluginModuleId ?? '',
        projectId: body.projectId ?? '',
        scope: body.scope as 'board' | 'project',
        state: body.state as 'disabled' | 'enabled' | 'inherit',
      }),
    };
  }
  if (
    input.method === 'GET'
    && input.pathname === '/plugin-foundation/settings'
  ) {
    return { handled: true, value: await input.store.readSettings() };
  }
  if (
    input.method === 'POST'
    && input.pathname === '/plugin-foundation/settings'
  ) {
    const body = await input.readBody() as {
      definition?: PluginSettingsV1;
      pluginModuleId?: string;
      scope?: PluginSettingScopeV1;
      scopeId?: string;
      values?: Readonly<Record<string, PluginJsonValueV2>>;
    };
    return {
      handled: true,
      value: await input.store.updateSettings({
        definition: body.definition as PluginSettingsV1,
        pluginModuleId: body.pluginModuleId ?? '',
        scope: body.scope as PluginSettingScopeV1,
        scopeId: body.scopeId ?? '',
        values: body.values ?? {},
      }),
    };
  }
  if (
    input.method === 'GET'
    && input.pathname === '/plugin-foundation/experience'
  ) {
    return { handled: true, value: await input.store.readExperience() };
  }
  if (
    input.method === 'PUT'
    && input.pathname === '/plugin-foundation/experience'
  ) {
    return {
      handled: true,
      value: await input.store.replaceExperience(
        await input.readBody() as PluginHostExperienceProfileV1,
      ),
    };
  }
  return { handled: false };
}
