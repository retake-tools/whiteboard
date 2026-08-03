import {
  configureInstalledRuntimeRegistry,
  type InstalledRuntimeRegistrySnapshotV1,
} from './installedRuntimeRegistry';
import type { PluginRuntimeSnapshotV1 } from '@retake-tools/package-sdk';

export interface InstalledRuntimeBootstrapResult {
  packageFailures: PackageBootstrapNoticeV1[];
  pluginRuntime: PluginRuntimeSnapshotV1;
  snapshot: InstalledRuntimeRegistrySnapshotV1;
}

export interface PackageBootstrapNoticeV1 {
  error: string;
  packageId: string | null;
  source: 'active' | 'distribution';
  stage: string;
  version: string | null;
}

export async function bootstrapInstalledRuntimeRegistry(): Promise<
  InstalledRuntimeBootstrapResult
> {
  const response = await fetch('/api/local/package-registry/bootstrap');
  if (!response.ok) {
    let message = `Package bootstrap failed with HTTP ${response.status}.`;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length > 0) message = body.error;
    } catch {
      // The status is still actionable when a proxy returns a non-JSON response.
    }
    throw new Error(message);
  }
  const body = await response.json() as {
    distributionFailures?: Array<{
      error?: unknown;
      packageId?: unknown;
      stage?: unknown;
      version?: unknown;
    }>;
    packageFailures?: Array<{
      error?: unknown;
      packageId?: unknown;
      version?: unknown;
    }>;
    pluginRuntime?: PluginRuntimeSnapshotV1;
    snapshot?: unknown;
  };
  if (!body.snapshot) throw new Error('Package bootstrap returned no Runtime Registry snapshot.');
  if (!body.pluginRuntime) throw new Error('Package bootstrap returned no Plugin Runtime snapshot.');
  return {
    packageFailures: [
      ...(body.distributionFailures ?? []).map((failure) => ({
        error: failureText(failure.error),
        packageId: nullableText(failure.packageId),
        source: 'distribution' as const,
        stage: typeof failure.stage === 'string' ? failure.stage : 'candidate',
        version: nullableText(failure.version),
      })),
      ...(body.packageFailures ?? []).map((failure) => ({
        error: failureText(failure.error),
        packageId: nullableText(failure.packageId),
        source: 'active' as const,
        stage: 'load',
        version: nullableText(failure.version),
      })),
    ],
    pluginRuntime: structuredClone(body.pluginRuntime),
    snapshot: configureInstalledRuntimeRegistry(body.snapshot),
  };
}

function failureText(value: unknown): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : 'Package validation failed.';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function reportPluginFatalFailure(
  pluginModuleId: string,
  message: string,
  rollback?: {
    rejectedDigest: string;
    retainedDigest: string;
  },
): Promise<void> {
  const response = await fetch(
    `/api/local/plugin-runtime/modules/${
      encodeURIComponent(pluginModuleId)
    }/fail`,
    {
      body: JSON.stringify({ message, ...rollback }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  throw new Error(
    typeof body.error === 'string'
      ? body.error
      : `Plugin fatal failure report failed with HTTP ${response.status}.`,
  );
}

export async function confirmPluginActivation(input: {
  packageDigest: string;
  packageId: string;
  pluginModuleId: string;
}): Promise<void> {
  const response = await fetch('/api/local/plugin-runtime/activations/confirm', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  throw new Error(
    typeof body.error === 'string'
      ? body.error
      : `Plugin activation confirmation failed with HTTP ${response.status}.`,
  );
}
