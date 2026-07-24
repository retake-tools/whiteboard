import { createPortal } from 'react-dom';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

interface TooltipIconButtonProps {
  buttonRef?: MutableRefObject<HTMLButtonElement | null>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  isPressed?: boolean;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
}

interface TooltipWrapperProps {
  children: ReactNode;
  className?: string;
  label: string;
}

export function TooltipIconButton({
  buttonRef,
  children,
  className = 'icon-button',
  disabled,
  isPressed,
  label,
  onClick,
  onPointerDown,
}: TooltipIconButtonProps): ReactElement {
  const tooltipButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  return (
    <button
      ref={(node) => {
        tooltipButtonRef.current = node;
        if (buttonRef) buttonRef.current = node;
      }}
      type="button"
      className={`${className} tooltipped-button${isPressed ? ' is-active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onBlur={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      aria-pressed={isPressed}
      aria-label={label}
    >
      {children}
      {isVisible && !disabled ? <TooltipBubble anchor={tooltipButtonRef.current} label={label} /> : null}
    </button>
  );
}

export function TooltipWrapper({ children, className, label }: TooltipWrapperProps): ReactElement {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span
      ref={wrapperRef}
      className={`${className ?? ''} tooltipped-button`}
      aria-label={label}
      onBlur={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible ? <TooltipBubble anchor={wrapperRef.current} label={label} /> : null}
    </span>
  );
}

function TooltipBubble({ anchor, label }: { anchor: HTMLElement | null; label: string }): ReactElement | null {
  const [geometry, setGeometry] = useState<TooltipGeometry | undefined>();

  useLayoutEffect(() => {
    if (!anchor) return undefined;
    const anchorElement = anchor;

    function updateGeometry(): void {
      const rect = anchorElement.getBoundingClientRect();
      const placement = preferredPlacement(anchorElement, rect);
      const gap = 8;
      const rawX = placement === 'right'
        ? rect.right + gap
        : placement === 'left'
          ? rect.left - gap
          : rect.left + rect.width / 2;
      const rawY = placement === 'bottom'
        ? rect.bottom + gap
        : placement === 'right' || placement === 'left'
          ? rect.top + rect.height / 2
          : rect.top - gap;
      const tooltipMaxWidth = Math.min(320, window.innerWidth - 24);
      const x = placement === 'top' || placement === 'bottom'
        ? clamp(rawX, 12 + tooltipMaxWidth / 2, window.innerWidth - 12 - tooltipMaxWidth / 2)
        : rawX;
      const y = placement === 'left' || placement === 'right'
        ? clamp(rawY, 16, window.innerHeight - 16)
        : rawY;

      setGeometry({ placement, x, y });
    }

    updateGeometry();
    window.addEventListener('resize', updateGeometry);
    window.addEventListener('scroll', updateGeometry, true);
    return () => {
      window.removeEventListener('resize', updateGeometry);
      window.removeEventListener('scroll', updateGeometry, true);
    };
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return undefined;
    const anchorElement = anchor;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') anchorElement.blur();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anchor]);

  if (!geometry) return null;

  return createPortal(
    <span
      className={`icon-tooltip is-${geometry.placement}`}
      role="tooltip"
      style={{ '--tooltip-left': `${geometry.x}px`, '--tooltip-top': `${geometry.y}px` } as TooltipStyle}
    >
      {label}
    </span>,
    document.body,
  );
}

type TooltipPlacement = 'top' | 'bottom' | 'right' | 'left';
type TooltipGeometry = { placement: TooltipPlacement; x: number; y: number };
type TooltipStyle = CSSProperties & { '--tooltip-left': string; '--tooltip-top': string };

function preferredPlacement(anchor: HTMLElement, rect: DOMRect): TooltipPlacement {
  if (anchor.closest('.annotation-tool-strip')) return 'right';
  if (anchor.closest('.image-info-button')) return 'left';
  return rect.top < 44 ? 'bottom' : 'top';
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return value;
  return Math.min(max, Math.max(min, value));
}
