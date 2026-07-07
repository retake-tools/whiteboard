import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

interface ProjectBoardDialogProps {
  confirmMessage?: string;
  defaultValue?: string;
  destructive?: boolean;
  isNameRequired?: boolean;
  cancelLabel: string;
  closeLabel: string;
  submitLabel: string;
  title: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

export function ProjectBoardDialog({
  confirmMessage,
  defaultValue = '',
  destructive,
  isNameRequired = true,
  cancelLabel,
  closeLabel,
  submitLabel,
  title,
  onCancel,
  onSubmit,
}: ProjectBoardDialogProps): ReactElement {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit(value.trim());
  }

  return (
    <div className="project-board-dialog-backdrop" role="presentation">
      <form className="project-board-dialog" onSubmit={submit}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label={closeLabel} onClick={onCancel}>
            ×
          </button>
        </header>
        {confirmMessage ? <p>{confirmMessage}</p> : null}
        {isNameRequired ? (
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : null}
        <footer>
          <button type="button" className="project-board-dialog-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={destructive ? 'project-board-dialog-primary is-danger' : 'project-board-dialog-primary'}
            disabled={isNameRequired && value.trim().length === 0}
          >
            {submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
