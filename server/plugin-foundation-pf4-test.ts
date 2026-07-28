import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PluginFoundationConfigStore,
  pluginExperienceStateFile,
  pluginSettingsStateFile,
} from './plugin-foundation-config-store';

const packagesRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-plugin-foundation-pf4-'),
);
assert.notEqual(path.resolve(packagesRoot), path.resolve('.retake'));
const store = new PluginFoundationConfigStore(packagesRoot);
const settings = {
  apiVersion: 1 as const,
  fields: {
    annotationColor: {
      default: 'teal',
      enum: ['teal', 'violet'],
      label: 'Annotation color',
      scope: 'board' as const,
      type: 'string' as const,
    },
    experimentalTools: {
      default: false,
      label: 'Experimental tools',
      scope: 'workspace' as const,
      type: 'boolean' as const,
    },
    outputQuality: {
      default: 90,
      label: 'Output quality',
      maximum: 100,
      minimum: 1,
      scope: 'project' as const,
      type: 'number' as const,
    },
  },
  kind: 'settings' as const,
  schemaVersion: 1,
  settingsId: 'design.retake.fixture.settings.image',
};

assert.deepEqual(await store.readSettings(), {
  entries: [],
  revision: 0,
  schemaVersion: 1,
});
await store.updateSettings({
  definition: settings,
  pluginModuleId: 'design.retake.fixture.web',
  scope: 'workspace',
  scopeId: 'workspace',
  values: { experimentalTools: true },
});
await store.updateSettings({
  definition: settings,
  pluginModuleId: 'design.retake.fixture.web',
  scope: 'project',
  scopeId: 'project.fixture',
  values: { outputQuality: 80 },
});
const settingsState = await store.updateSettings({
  definition: settings,
  pluginModuleId: 'design.retake.fixture.web',
  scope: 'board',
  scopeId: 'project.fixture:board.fixture',
  values: { annotationColor: 'violet' },
});
assert.equal(settingsState.revision, 3);
assert.deepEqual(
  settingsState.entries.map((entry) => entry.scope),
  ['board', 'project', 'workspace'],
);
await assert.rejects(
  store.updateSettings({
    definition: settings,
    pluginModuleId: 'design.retake.fixture.web',
    scope: 'board',
    scopeId: 'project.fixture:board.fixture',
    values: { outputQuality: 70 },
  }),
  /value is invalid/,
);

assert.deepEqual(await store.readExperience(), {
  commandOverrides: [],
  profileId: 'retake.experience.whiteboard',
  schemaVersion: 1,
});
const experience = await store.replaceExperience({
  commandOverrides: [{
    commandId: 'design.retake.fixture.command.adjust',
    order: 30,
    surfaceId: 'image.context-toolbar',
  }],
  profileId: 'retake.experience.whiteboard',
  schemaVersion: 1,
});
assert.equal(experience.commandOverrides[0]?.order, 30);
assert.deepEqual(
  await new PluginFoundationConfigStore(packagesRoot).readExperience(),
  experience,
);
assert.equal(
  JSON.parse(await readFile(
    path.join(packagesRoot, pluginSettingsStateFile),
    'utf8',
  )).schemaVersion,
  1,
);
assert.equal(
  JSON.parse(await readFile(
    path.join(packagesRoot, pluginExperienceStateFile),
    'utf8',
  )).schemaVersion,
  1,
);
assert.equal(
  (await stat(path.join(packagesRoot, pluginSettingsStateFile))).mode & 0o777,
  0o600,
);

process.stdout.write(`${JSON.stringify({
  experienceProfilePersistedSeparately: true,
  settingsAtomicPersistence: true,
  settingsScopeValidation: true,
  settingsScopes: ['board', 'project', 'workspace'],
  workspaceWrites: 'disposable-only',
})}\n`);
