import type { ProjectBoardDialogState } from './projectBoardTypes';
import type { I18nContextValue } from '../i18n';

type Translate = I18nContextValue['t'];

export function getProjectBoardDialogView(
  dialog: ProjectBoardDialogState,
  t: Translate,
): {
  confirmMessage?: string;
  defaultValue?: string;
  destructive?: boolean;
  isNameRequired?: boolean;
  submitLabel: string;
  title: string;
} {
  if (dialog.action === 'createProject') {
    return {
      defaultValue: dialog.defaultName,
      submitLabel: t('projectBoard.create'),
      title: t('projectBoard.addProject'),
    };
  }

  if (dialog.action === 'createBoard') {
    return {
      defaultValue: dialog.defaultName,
      submitLabel: t('projectBoard.create'),
      title: t('projectBoard.addBoard'),
    };
  }

  if (dialog.action === 'renameProject') {
    return {
      defaultValue: dialog.currentName,
      submitLabel: t('projectBoard.rename'),
      title: t('projectBoard.renameProject'),
    };
  }

  if (dialog.action === 'renameBoard') {
    return {
      defaultValue: dialog.currentName,
      submitLabel: t('projectBoard.rename'),
      title: t('projectBoard.renameBoard'),
    };
  }

  if (dialog.action === 'duplicateBoard') {
    return {
      defaultValue: dialog.currentName,
      submitLabel: t('projectBoard.copyBoard'),
      title: t('projectBoard.copyBoard'),
    };
  }

  if (dialog.action === 'deleteBoard') {
    return {
      confirmMessage: t('projectBoard.confirmDeleteBoard'),
      destructive: true,
      isNameRequired: false,
      submitLabel: t('projectBoard.delete'),
      title: t('projectBoard.delete'),
    };
  }

  return {
    confirmMessage: t('projectBoard.confirmDeleteProject'),
    destructive: true,
    isNameRequired: false,
    submitLabel: t('projectBoard.delete'),
    title: t('projectBoard.delete'),
  };
}
