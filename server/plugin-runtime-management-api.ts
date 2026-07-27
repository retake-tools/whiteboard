import {
  type PluginRuntimeManagementActionV1,
  PluginRuntimeService,
} from './plugin-runtime-service';

export type PluginRuntimeManagementApiResult =
  | { handled: false }
  | { handled: true; statusCode?: number; value: unknown };

export async function handlePluginRuntimeManagementRequest(input: {
  method: string;
  pathname: string;
  readBody(): Promise<unknown>;
  service: PluginRuntimeService;
}): Promise<PluginRuntimeManagementApiResult> {
  if (input.method === 'GET' && input.pathname === '/plugin-runtime') {
    return {
      handled: true,
      value: await input.service.reconcile(),
    };
  }

  if (
    input.method === 'POST'
    && input.pathname === '/plugin-runtime/safe-mode'
  ) {
    const body = (await input.readBody()) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return {
        handled: true,
        statusCode: 400,
        value: { error: 'Plugin safe mode enabled must be a boolean.' },
      };
    }
    return {
      handled: true,
      value: await input.service.setSafeMode(body.enabled),
    };
  }

  const moduleActionMatch = input.pathname.match(
    /^\/plugin-runtime\/modules\/([^/]+)\/(grant|trust|enable|disable)$/,
  );
  if (input.method !== 'POST' || !moduleActionMatch) {
    return { handled: false };
  }
  return {
    handled: true,
    value: await input.service.manageModule(
      decodeURIComponent(moduleActionMatch[1]!),
      moduleActionMatch[2]! as PluginRuntimeManagementActionV1,
    ),
  };
}
