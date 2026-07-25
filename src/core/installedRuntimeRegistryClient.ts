import {
  configureInstalledRuntimeRegistry,
  type InstalledRuntimeRegistrySnapshotV1,
} from './installedRuntimeRegistry';

export async function bootstrapInstalledRuntimeRegistry(): Promise<
  InstalledRuntimeRegistrySnapshotV1
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
  const body = await response.json() as { snapshot?: unknown };
  if (!body.snapshot) throw new Error('Package bootstrap returned no Runtime Registry snapshot.');
  return configureInstalledRuntimeRegistry(body.snapshot);
}
