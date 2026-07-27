import {
  type PluginAssetV2,
  type PluginConnectedExecutionRunInputV2,
  type PluginExecutionRunInputV2,
  type PluginHostReadSnapshotV2,
  type PluginJsonValueV2,
} from '@retake-tools/package-sdk';
import { PluginHostErrorV2 } from '@retake-tools/plugin-runtime';
import type { PluginHostDraftRecordV2 } from './pluginDrafts';
import type { AssetRecord } from './types';

type CapabilityAuthorizer = (
  pluginModuleId: string,
  capabilityId: string,
) => boolean;

export function assertExecutionRunInput(
  input: PluginExecutionRunInputV2,
  snapshot: PluginHostReadSnapshotV2,
  pluginModuleId: string,
  authorize: CapabilityAuthorizer = () => false,
  locale = 'en',
): void {
  if (
    typeof input !== 'object'
    || input === null
    || typeof input.capabilityId !== 'string'
    || input.capabilityId.trim() !== input.capabilityId
    || input.capabilityId.length === 0
    || typeof input.execute !== 'function'
    || !Array.isArray(input.inputBlockIds)
    || input.inputBlockIds.length === 0
    || new Set(input.inputBlockIds).size !== input.inputBlockIds.length
    || input.inputBlockIds.some((blockId) => (
      typeof blockId !== 'string'
      || !snapshot.boundBlockIds.includes(blockId)
    ))
    || !isJsonObject(input.parameters)
  ) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Plugin execution requires a valid Capability, bound input Blocks, JSON parameters, and an executor.',
        '插件执行需要有效的能力、已绑定输入块、JSON 参数和执行器。',
      ),
    );
  }
  if (!snapshot.projectId || !snapshot.boardId) {
    throw new PluginHostErrorV2(
      'unavailable',
      localized(
        locale,
        'Plugin execution requires an active Board.',
        '插件执行需要一个已打开的画板。',
      ),
    );
  }
  assertOwnedCapability(
    input.capabilityId,
    pluginModuleId,
    authorize,
    locale,
  );
}

export function assertConnectedExecutionRunInput(
  input: PluginConnectedExecutionRunInputV2,
  snapshot: PluginHostReadSnapshotV2,
  pluginModuleId: string,
  importedAssets: ReadonlyMap<string, AssetRecord>,
  authorize: CapabilityAuthorizer = () => false,
  locale = 'en',
): void {
  if (
    typeof input !== 'object'
    || input === null
    || typeof input.capabilityId !== 'string'
    || input.capabilityId.trim() !== input.capabilityId
    || input.capabilityId.length === 0
    || (
      input.connectionId !== undefined
      && (
        typeof input.connectionId !== 'string'
        || input.connectionId.trim() !== input.connectionId
        || input.connectionId.length === 0
      )
    )
    || !Array.isArray(input.inputs)
    || input.inputs.length === 0
    || new Set(input.inputs.map((binding) => binding.slotId)).size
      !== input.inputs.length
    || input.inputs.some((binding) => (
      typeof binding !== 'object'
      || binding === null
      || (
        (
          typeof binding.blockId !== 'string'
          || !snapshot.boundBlockIds.includes(binding.blockId)
          || binding.assetId !== undefined
        )
        && (
          typeof binding.assetId !== 'string'
          || (
            !snapshot.boundAssetIds.includes(binding.assetId)
            && !importedAssets.has(binding.assetId)
          )
          || binding.blockId !== undefined
        )
      )
      || typeof binding.slotId !== 'string'
      || binding.slotId.trim() !== binding.slotId
      || binding.slotId.length === 0
    ))
    || typeof input.prompt !== 'string'
    || input.prompt.trim().length === 0
    || input.prompt.length > 32_000
    || (
      input.outputCount !== undefined
      && ![1, 2, 3, 4].includes(input.outputCount)
    )
    || !isJsonObject(input.parameters)
  ) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Connected Plugin execution requires an owned Capability, bound typed inputs, a prompt, and JSON parameters.',
        '连接式插件执行需要插件自有能力、已绑定类型化输入、提示词和 JSON 参数。',
      ),
    );
  }
  if (!snapshot.projectId || !snapshot.boardId) {
    throw new PluginHostErrorV2(
      'unavailable',
      localized(
        locale,
        'Connected Plugin execution requires an active Board.',
        '连接式插件执行需要一个已打开的画板。',
      ),
    );
  }
  assertOwnedCapability(
    input.capabilityId,
    pluginModuleId,
    authorize,
    locale,
  );
}

export function assertDraftAccess(
  input: { blockId: string; capabilityId: string },
  snapshot: PluginHostReadSnapshotV2,
  pluginModuleId: string,
  authorize: CapabilityAuthorizer = () => false,
  locale = 'en',
): void {
  if (
    !input
    || typeof input.blockId !== 'string'
    || typeof input.capabilityId !== 'string'
    || !snapshot.boundBlockIds.includes(input.blockId)
  ) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Plugin draft access requires a bound Block and Capability.',
        '插件草稿访问需要已绑定的块和能力。',
      ),
    );
  }
  assertOwnedCapability(
    input.capabilityId,
    pluginModuleId,
    authorize,
    locale,
  );
}

export function assertOwnedCapability(
  capabilityId: string,
  pluginModuleId: string,
  authorize: CapabilityAuthorizer = () => false,
  locale = 'en',
): void {
  if (
    typeof capabilityId !== 'string'
    || capabilityId.length === 0
    || capabilityId.trim() !== capabilityId
  ) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Plugin Capability ID is invalid.',
        '插件能力 ID 无效。',
      ),
    );
  }
  if (!authorize(pluginModuleId, capabilityId)) {
    throw new PluginHostErrorV2(
      'not_authorized',
      localized(
        locale,
        `PluginModule does not own the requested Capability: ${capabilityId}`,
        `插件模块不拥有请求的能力：${capabilityId}`,
      ),
    );
  }
}

export function assertPluginDraftValue(
  value: PluginJsonValueV2 | null,
  locale = 'en',
): void {
  if (value === null) return;
  if (!isJsonValue(value, new WeakSet())) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Plugin draft must contain only finite, acyclic JSON.',
        '插件草稿只能包含有界、无环的 JSON。',
      ),
    );
  }
  if (containsForbiddenDraftString(value)) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Plugin draft cannot contain Data URLs or binary payloads.',
        '插件草稿不能包含 Data URL 或二进制内容。',
      ),
    );
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > 256 * 1024) {
    throw new PluginHostErrorV2(
      'invalid_argument',
      localized(
        locale,
        'Plugin draft exceeds the 256 KB limit.',
        '插件草稿超过 256 KB 上限。',
      ),
      { details: { bytes, limit: 256 * 1024 } },
    );
  }
}

export function freezePluginAsset(asset: PluginAssetV2): PluginAssetV2 {
  return Object.freeze({
    assetId: asset.assetId,
    createdAt: asset.createdAt,
    ...(asset.duration === undefined ? {} : { duration: asset.duration }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    kind: asset.kind,
    mimeType: asset.mimeType,
    previewUrl: asset.previewUrl,
    ...(asset.width === undefined ? {} : { width: asset.width }),
  });
}

export function freezePluginDraft(
  draft: PluginHostDraftRecordV2,
): PluginHostDraftRecordV2 {
  return Object.freeze({
    blockId: draft.blockId,
    capabilityId: draft.capabilityId,
    ...(draft.legacy ? { legacy: true as const } : {}),
    pluginModuleId: draft.pluginModuleId,
    revision: draft.revision,
    updatedAt: draft.updatedAt,
    value: structuredClone(draft.value),
  });
}

export function freezeReadSnapshot(
  snapshot: PluginHostReadSnapshotV2,
): PluginHostReadSnapshotV2 {
  return Object.freeze({
    boardId: snapshot.boardId,
    boundAssetIds: Object.freeze([...snapshot.boundAssetIds]),
    boundBlockIds: Object.freeze([...snapshot.boundBlockIds]),
    boundGroupIds: Object.freeze([...snapshot.boundGroupIds]),
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    selectedBlockIds: Object.freeze([...snapshot.selectedBlockIds]),
  }) as PluginHostReadSnapshotV2;
}

export function sameAssetMap(
  left: ReadonlyMap<string, PluginAssetV2>,
  right: ReadonlyMap<string, PluginAssetV2>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [assetId, asset] of left) {
    const candidate = right.get(assetId);
    if (
      !candidate
      || asset.createdAt !== candidate.createdAt
      || asset.duration !== candidate.duration
      || asset.height !== candidate.height
      || asset.kind !== candidate.kind
      || asset.mimeType !== candidate.mimeType
      || asset.previewUrl !== candidate.previewUrl
      || asset.width !== candidate.width
    ) return false;
  }
  return true;
}

export function samePluginDrafts(
  left: readonly PluginHostDraftRecordV2[],
  right: readonly PluginHostDraftRecordV2[],
): boolean {
  return left.length === right.length
    && left.every((draft, index) => {
      const candidate = right[index];
      return draft.blockId === candidate?.blockId
        && draft.capabilityId === candidate.capabilityId
        && draft.pluginModuleId === candidate.pluginModuleId
        && draft.revision === candidate.revision;
    });
}

export function sameReadSnapshot(
  left: PluginHostReadSnapshotV2,
  right: PluginHostReadSnapshotV2,
): boolean {
  return left.revision === right.revision
    && left.projectId === right.projectId
    && left.boardId === right.boardId
    && sameTextArray(left.boundAssetIds, right.boundAssetIds)
    && sameTextArray(left.boundBlockIds, right.boundBlockIds)
    && sameTextArray(left.boundGroupIds, right.boundGroupIds)
    && sameTextArray(left.selectedBlockIds, right.selectedBlockIds);
}

function containsForbiddenDraftString(value: PluginJsonValueV2): boolean {
  if (typeof value === 'string') {
    return /^data:[^,]*[,;]/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsForbiddenDraftString);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsForbiddenDraftString);
  }
  return false;
}

function isJsonObject(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
): boolean {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || ancestors.has(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(
    (entry) => isJsonValue(entry, ancestors),
  );
  ancestors.delete(value);
  return valid;
}

function isJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): boolean {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
  ) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    const valid = value.every((entry) => isJsonValue(entry, ancestors));
    ancestors.delete(value);
    return valid;
  }
  return isJsonObject(value, ancestors);
}

function sameTextArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function localized(locale: string, english: string, chinese: string): string {
  return locale.toLowerCase().startsWith('zh') ? chinese : english;
}
