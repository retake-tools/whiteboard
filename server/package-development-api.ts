import {
  PackageDevelopmentInputError,
  PackageDevelopmentService,
} from './package-development-service';

export type PackageDevelopmentApiResult =
  | { handled: false }
  | { handled: true; statusCode?: number; value: unknown };

export async function handlePackageDevelopmentRequest(input: {
  method: string;
  pathname: string;
  readBody(): Promise<unknown>;
  service: PackageDevelopmentService;
}): Promise<PackageDevelopmentApiResult> {
  if (input.pathname !== '/package-development') {
    return { handled: false };
  }
  if (input.method === 'GET') {
    return { handled: true, value: await input.service.read() };
  }
  if (input.method !== 'POST') {
    return {
      handled: true,
      statusCode: 405,
      value: { error: 'Package development method is not supported.' },
    };
  }
  try {
    const body = await input.readBody();
    if (!isRecord(body) || typeof body.action !== 'string') {
      throw new PackageDevelopmentInputError(
        'Package development action is required.',
      );
    }
    if (body.action === 'link') {
      return {
        handled: true,
        value: await input.service.link(
          body.sourceRoot as string,
          body.confirmTrust === true,
        ),
      };
    }
    if (body.action === 'rebuild' || body.action === 'confirm_identity') {
      return {
        handled: true,
        value: await input.service.rebuild(
          body.linkId as string,
          body.action === 'confirm_identity',
        ),
      };
    }
    if (body.action === 'watch' || body.action === 'unwatch') {
      return {
        handled: true,
        value: await input.service.setWatching(
          body.linkId as string,
          body.action === 'watch',
        ),
      };
    }
    if (body.action === 'accept_candidate' || body.action === 'reject_candidate') {
      return {
        handled: true,
        value: await input.service.resolveCandidate(
          body.linkId as string,
          body.digest as string,
          body.action === 'accept_candidate' ? 'accept' : 'reject',
          body.error as string | undefined,
        ),
      };
    }
    if (body.action === 'unlink') {
      if (
        body.disposition !== 'remove'
        && body.disposition !== 'retain'
      ) {
        throw new PackageDevelopmentInputError(
          'Package development unlink disposition is invalid.',
        );
      }
      return {
        handled: true,
        value: await input.service.unlink(
          body.linkId as string,
          body.disposition,
        ),
      };
    }
    throw new PackageDevelopmentInputError(
      'Package development action is unsupported.',
    );
  } catch (error) {
    if (!(error instanceof PackageDevelopmentInputError)) throw error;
    return {
      handled: true,
      statusCode: 400,
      value: { error: error.message },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
