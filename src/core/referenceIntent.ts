export type ReferenceIntentOrigin = 'ai' | 'preset' | 'user';

export interface ReferenceIntentV1 {
  instruction: string;
  label: string;
  origin: ReferenceIntentOrigin;
  schemaVersion: 1;
}

export type ImageReferenceBindingKind = 'reference' | 'source';

export type ComposerImageReferenceMode = 'auto' | ImageReferenceBindingKind;

export interface ComposerImageReferenceSetting {
  instruction: string;
  mode: ComposerImageReferenceMode;
}

export function createReferenceIntent(
  instruction: string,
  origin: ReferenceIntentOrigin,
  label?: string,
): ReferenceIntentV1 | undefined {
  const normalizedInstruction = instruction.trim();
  if (!normalizedInstruction) return undefined;
  return {
    instruction: normalizedInstruction,
    label: normalizedReferenceIntentLabel(label, normalizedInstruction),
    origin,
    schemaVersion: 1,
  };
}

export function normalizeReferenceIntent(value: unknown): ReferenceIntentV1 | undefined {
  if (!isRecord(value)) return undefined;
  const instruction = typeof value.instruction === 'string'
    ? value.instruction.trim()
    : '';
  const label = typeof value.label === 'string'
    ? value.label.trim()
    : '';
  const origin = (
    value.origin === 'ai'
    || value.origin === 'preset'
    || value.origin === 'user'
  )
    ? value.origin
    : undefined;
  if (!instruction || !origin) return undefined;
  return {
    instruction,
    label: normalizedReferenceIntentLabel(label, instruction),
    origin,
    schemaVersion: 1,
  };
}

export function referenceIntentSummary(
  intent: ReferenceIntentV1 | undefined,
): string | undefined {
  return intent?.label.trim() || intent?.instruction.trim() || undefined;
}

function normalizedReferenceIntentLabel(
  label: string | undefined,
  instruction: string,
): string {
  const normalizedLabel = label?.trim();
  if (normalizedLabel) return normalizedLabel.slice(0, 48);
  const firstLine = instruction.split(/\r?\n/, 1)[0]?.trim() ?? instruction;
  return firstLine.length > 24
    ? `${firstLine.slice(0, 23).trimEnd()}…`
    : firstLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
