import type { BlockRecord, BlockType } from './types';

type BlockTranslationKey =
  | 'block.document.body'
  | 'block.document.title'
  | 'block.image.body'
  | 'block.image.title'
  | 'block.operation.body'
  | 'block.operation.title'
  | 'block.group.body'
  | 'block.group.title'
  | 'block.text.body'
  | 'block.text.title'
  | 'block.video.body'
  | 'block.video.title';

export function localizedBlockData(
  type: BlockType,
  t: (key: BlockTranslationKey) => string,
): Pick<BlockRecord['data'], 'title' | 'body'> {
  if (type === 'image') return { title: t('block.image.title'), body: t('block.image.body') };
  if (type === 'document') return { title: t('block.document.title'), body: t('block.document.body') };
  if (type === 'video') return { title: t('block.video.title'), body: t('block.video.body') };
  if (type === 'operation') return { title: t('block.operation.title'), body: t('block.operation.body') };
  if (type === 'group') return { title: t('block.group.title'), body: t('block.group.body') };
  return { title: t('block.text.title'), body: t('block.text.body') };
}
