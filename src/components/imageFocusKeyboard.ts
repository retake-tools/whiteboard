export function isImageFocusEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { isContentEditable?: boolean; tagName?: unknown };
  const tagName = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  return Boolean(element.isContentEditable)
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select';
}
