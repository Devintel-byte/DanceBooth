import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import './components.css';
import { PlayerIcon } from './icons';

export { DuoDancersIcon, PlayerIcon, SoloDancerIcon } from './icons';

/**
 * Product name with the sponsor part (profile.productNameAccent, e.g.
 * "Maltina" in "Maltina Dance All") in the brand orange.
 */
export function Wordmark({ name, accent, className }: { name: string; accent?: string; className?: string }) {
  const i = accent ? name.indexOf(accent) : -1;
  if (!accent || i < 0) return <span className={`wordmark ${className ?? ''}`}>{name}</span>;
  return (
    <span className={`wordmark has-accent ${className ?? ''}`}>
      {name.slice(0, i)}
      <span className="wordmark-accent">{accent}</span>
      {name.slice(i + accent.length)}
    </span>
  );
}

/**
 * Shared controls for participant and operator screens. Real <button>s,
 * visible focus, no hover dependence, and every state (default, focus,
 * pressed, selected, disabled, loading) styled in components.css.
 */

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  loading?: boolean;
  icon?: ReactNode;
  size?: 'large' | 'compact';
  ref?: Ref<HTMLButtonElement>;
};

function BaseButton({ variant, loading, icon, size = 'large', children, disabled, className, ...rest }: ButtonProps & { variant: string }) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant} btn-${size} ${loading ? 'is-loading' : ''} ${className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon ? <span className="btn-icon" aria-hidden="true">{icon}</span> : null}
      <span className="btn-label">{children}</span>
    </button>
  );
}

export const PrimaryButton = (p: ButtonProps) => <BaseButton variant="primary" {...p} />;
export const SecondaryButton = (p: ButtonProps) => <BaseButton variant="secondary" {...p} />;

export function IconButton({ label, children, ...rest }: Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }) {
  return (
    <button type="button" {...rest} className={`icon-btn ${rest.className ?? ''}`} aria-label={label} title={label}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export const PlayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
export const ArrowIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export function SelectionTile({
  title,
  description,
  media,
  selected,
  onSelect,
  disabled,
}: {
  title: string;
  description: string;
  media?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`tile ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onSelect} disabled={disabled}>
      {media && <span className="tile-media">{media}</span>}
      <span className="tile-title">{title}</span>
      <span className="tile-desc">{description}</span>
      <span className="tile-check" aria-hidden={!selected}>
        {selected && (
          <>
            <CheckIcon /> Selected
          </>
        )}
      </span>
    </button>
  );
}

/**
 * Character card: a rendered portrait of the actual 3D character (or, if a
 * character has no portrait, its initial on the palette colours) with its name.
 */
export function CharacterOption({
  name,
  portrait,
  swatch,
  selected,
  onSelect,
}: {
  name: string;
  portrait?: string;
  swatch: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`char-option ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="char-portrait" style={portrait ? undefined : { background: swatch }} aria-hidden="true">
        {portrait ? <img src={portrait} alt="" draggable={false} /> : <span className="char-initial">{name.slice(0, 1)}</span>}
      </span>
      <span className="char-name">{name}</span>
      {selected && (
        <span className="char-check" aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';
const TONE_ICON: Record<StatusTone, string> = { neutral: '•', success: '✓', warning: '!', error: '✕', info: 'i' };

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-icon" aria-hidden="true">
        {TONE_ICON[tone]}
      </span>
      {children}
    </span>
  );
}

export function ProgressIndicator({ value, label, tone = 'brand' }: { value: number; label: string; tone?: 'brand' | 'dark' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`progress progress-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title">{title}</h2>
        <p id="dlg-msg">{message}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary btn-compact" onClick={onCancel}>
            <span className="btn-label">Cancel</span>
          </button>
          <button type="button" className={`btn ${destructive ? 'btn-danger' : 'btn-primary'} btn-compact`} onClick={onConfirm}>
            <span className="btn-label">{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlayerBadge({ slot }: { slot: 1 | 2 }) {
  // Icon + text, not colour alone.
  return (
    <span className={`player-badge p${slot}`}>
      <PlayerIcon size={18} />
      Player {slot}
    </span>
  );
}
