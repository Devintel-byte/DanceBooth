import { Component, type ReactNode } from 'react';
import { log } from '../../shared/booth';

/**
 * Keeps the participant UI alive if the 3D stage fails (e.g. no WebGL context
 * on a broken GPU driver): menus, calibration and scoring still work over a
 * plain background, and the failure is logged for the operator.
 */
export class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    log('error', `3D stage failed, continuing without it: ${String(error)}`, 'UNKNOWN');
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <div className="stage-fallback" aria-hidden="true" />
    ) : (
      this.props.children
    );
  }
}
