import {
  PackageLifecycleInputError,
  PackageLifecycleService,
} from './package-lifecycle-service';

export type PackageLifecycleApiResult =
  | { handled: false }
  | { handled: true; statusCode?: number; value: unknown };

export async function handlePackageLifecycleRequest(input: {
  method: string;
  pathname: string;
  readBody(): Promise<unknown>;
  service: PackageLifecycleService;
}): Promise<PackageLifecycleApiResult> {
  if (input.pathname !== '/package-lifecycle') return { handled: false };
  if (input.method === 'GET') {
    return {
      handled: true,
      value: await input.service.read(),
    };
  }
  if (input.method !== 'POST') {
    return {
      handled: true,
      statusCode: 405,
      value: { error: 'Package lifecycle method is not supported.' },
    };
  }
  try {
    const body = await input.readBody();
    if (!isRecord(body) || typeof body.action !== 'string') {
      throw new PackageLifecycleInputError(
        'Package lifecycle action is required.',
      );
    }
    if (body.action === 'install') {
      return {
        handled: true,
        value: await input.service.mutate({
          action: 'install',
          source: body.source as string,
        }),
      };
    }
    if (
      body.action === 'update'
      || body.action === 'remove'
      || body.action === 'rollback'
    ) {
      return {
        handled: true,
        value: await input.service.mutate({
          action: body.action,
          packageId: body.packageId as string,
          ...(body.action === 'rollback' && body.target !== undefined
            ? { target: body.target as string }
            : {}),
        }),
      };
    }
    throw new PackageLifecycleInputError(
      'Package lifecycle action is unsupported.',
    );
  } catch (error) {
    if (!(error instanceof PackageLifecycleInputError)) throw error;
    return {
      handled: true,
      statusCode: 400,
      value: { error: error.message },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
