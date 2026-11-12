import path from 'node:path';
import { app } from 'electron';

/**
 * Packaging-aware locations. Nothing here depends on the current working
 * directory or on development node_modules.
 */
export function assetsRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'assets');
  // Dev: app path is apps/desktop; content lives at the repository root.
  return path.resolve(app.getAppPath(), '..', '..', 'assets');
}

/** Built renderer output (production protocol serving). */
export function rendererRoot(): string {
  return path.join(__dirname, '..', 'renderer');
}

export function preloadPath(role: 'participant' | 'operator' | 'leaderboard'): string {
  return path.join(__dirname, `${role}.cjs`);
}

export function dataDir(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts);
}
