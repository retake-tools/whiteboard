import type {
  PluginHostApiV2,
  PluginHostEnvironmentSnapshotV2,
} from '@retake-tools/package-sdk';

export function createPluginHostEnvironment(): {
  api: PluginHostApiV2['environment'];
  update(snapshot: PluginHostEnvironmentSnapshotV2): void;
} {
  let current: PluginHostEnvironmentSnapshotV2 = Object.freeze({
    colorScheme: 'light',
    direction: 'ltr',
    locale: 'en',
    reducedMotion: false,
    revision: 'initial',
  });
  const listeners = new Set<() => void>();
  return {
    api: Object.freeze({
      getSnapshot: () => current,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    update(snapshot) {
      const next = {
        ...snapshot,
        locale: normalizeLocale(snapshot.locale),
      };
      if (next.revision === current.revision) return;
      current = Object.freeze(next);
      for (const listener of listeners) listener();
    },
  };
}

function normalizeLocale(locale: string): string {
  try {
    return new Intl.Locale(locale).toString();
  } catch {
    return 'en';
  }
}
