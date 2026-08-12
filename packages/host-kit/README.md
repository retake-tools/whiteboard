# @retake-tools/host-kit

Portable Retake Canvas Host V1.

- `@retake-tools/host-kit` exports the headless contracts and Application Service.
- `@retake-tools/host-kit/react` exports the optional React Canvas Surface.
- `@retake-tools/host-kit/plugin` exports the Host-scoped Web PluginModule runtime,
  contribution catalog, and injected Asset / Settings / Execution ports.
- `@retake-tools/host-kit/plugin-react` exports optional React Plugin surfaces.
- `@retake-tools/host-kit/styles.css` exports scoped Canvas Surface styles.

Consumers own Storage, Connection, and Package Runtime adapters. UI code receives
an immutable Board read model and typed commands; it cannot replace snapshots.

Every Host must create its own Plugin Web Module runtime with
`createPluginWebModuleRuntime()`. Module sessions are intentionally not shared
between Hosts, even when they load the same plugin ID and package digest.
