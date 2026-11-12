import { useState } from 'react';
import {
  ArrowIcon,
  CharacterOption,
  ConfirmationDialog,
  IconButton,
  PlayIcon,
  PlayerBadge,
  PrimaryButton,
  ProgressIndicator,
  SecondaryButton,
  SelectionTile,
  StatusBadge,
} from '../components';

/**
 * Development-only gallery of shared controls in every state, for visual QA
 * of focus, pressed, selected, disabled and loading styles. Not reachable in
 * packaged builds.
 */
export function ComponentPreview({ onClose }: { onClose: () => void }) {
  const [tile, setTile] = useState(0);
  const [char, setChar] = useState('a');
  const [dialog, setDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <div className="op preview">
      <header className="op-head">
        <h1>Component preview (development only)</h1>
        <SecondaryButton size="compact" onClick={onClose}>
          Back to console
        </SecondaryButton>
      </header>
      <section className="panel" style={{ background: 'var(--surface-page)' }}>
        <h2>Buttons</h2>
        <div className="preview-row">
          <PrimaryButton icon={<PlayIcon />}>Start dancing</PrimaryButton>
          <PrimaryButton
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          >
            Continue (click: loading)
          </PrimaryButton>
          <PrimaryButton disabled>Disabled</PrimaryButton>
          <SecondaryButton>Back</SecondaryButton>
          <SecondaryButton disabled>Disabled</SecondaryButton>
          <IconButton label="Next">
            <ArrowIcon />
          </IconButton>
        </div>
        <h2>Selection tiles</h2>
        <div className="preview-row">
          <SelectionTile title="Solo" description="Your moment on the dance floor." selected={tile === 0} onSelect={() => setTile(0)} />
          <SelectionTile title="Two players" description="Dance together. See who takes the lead." selected={tile === 1} onSelect={() => setTile(1)} />
          <SelectionTile title="Unavailable" description="Disabled option." selected={false} onSelect={() => undefined} disabled />
        </div>
        <h2>Character options, badges, progress</h2>
        <div className="preview-row">
          <CharacterOption name="Sunset" swatch="var(--brand-orange)" selected={char === 'a'} onSelect={() => setChar('a')} />
          <CharacterOption name="Gold" swatch="var(--brand-gold)" selected={char === 'b'} onSelect={() => setChar('b')} />
          <PlayerBadge slot={1} />
          <PlayerBadge slot={2} />
          <StatusBadge tone="success">Camera ready</StatusBadge>
          <StatusBadge tone="warning">Low light</StatusBadge>
          <StatusBadge tone="error">Camera missing</StatusBadge>
        </div>
        <div style={{ maxWidth: 480, marginTop: 16 }}>
          <ProgressIndicator value={0.62} label="Example progress" />
        </div>
        <h2>Dialog</h2>
        <SecondaryButton onClick={() => setDialog(true)}>Open confirmation dialog</SecondaryButton>
      </section>
      <ConfirmationDialog
        open={dialog}
        title="Abort this song?"
        message="The current dancers will lose this performance."
        confirmLabel="Abort & reset"
        destructive
        onCancel={() => setDialog(false)}
        onConfirm={() => setDialog(false)}
      />
    </div>
  );
}
