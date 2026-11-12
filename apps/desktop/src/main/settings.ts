import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROFILE_DEFAULTS_VERSION, TRACKING_TUNING_VERSION, boothSettingsSchema, type BoothSettings, type SettingsPatch } from '@booth/contracts';

export const DEFAULT_SETTINGS: BoothSettings = boothSettingsSchema.parse({ schemaVersion: 1 });

/**
 * Loads settings, falling back to known-good defaults. A corrupt file is
 * preserved (renamed) for diagnosis rather than silently overwritten.
 */
export function loadSettings(file: string, onIssue: (msg: string) => void): BoothSettings {
  if (!existsSync(file)) return structuredClone(DEFAULT_SETTINGS);
  try {
    const parsed = boothSettingsSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
    if (parsed.success) return migrateProfile(migrateTracking(parsed.data));
    onIssue(`settings invalid, using defaults: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  } catch (e) {
    onIssue(`settings unreadable, using defaults: ${(e as Error).message}`);
  }
  try {
    renameSync(file, file.replace(/\.json$/, `.corrupt-${Date.now()}.json`));
  } catch {
    // ignore
  }
  return structuredClone(DEFAULT_SETTINGS);
}

/**
 * Settings saved before a tracking re-tune keep the old (stricter) confidence
 * thresholds that made the booth drop dancers. Move them to the new defaults
 * once; values changed after this point are the operator's and are kept.
 */
export function migrateTracking(settings: BoothSettings): BoothSettings {
  if (settings.tracking.tuning >= TRACKING_TUNING_VERSION) return settings;
  const d = DEFAULT_SETTINGS.tracking;
  return {
    ...settings,
    tracking: {
      ...settings.tracking,
      minPosePresenceConfidence: d.minPosePresenceConfidence,
      minTrackingConfidence: d.minTrackingConfidence,
      inputWidth: Math.max(settings.tracking.inputWidth, d.inputWidth),
      tuning: TRACKING_TUNING_VERSION,
    },
  };
}

/**
 * The booth now ships as Maltina Dance All: settings saved while the dev
 * showcase profile was the default switch to the Maltina profile once. A
 * profile the operator picks afterwards is kept.
 */
export function migrateProfile(settings: BoothSettings): BoothSettings {
  if (settings.profileDefaults >= PROFILE_DEFAULTS_VERSION) return settings;
  return {
    ...settings,
    activeProfileId: settings.activeProfileId === 'dev-showcase' ? DEFAULT_SETTINGS.activeProfileId : settings.activeProfileId,
    profileDefaults: PROFILE_DEFAULTS_VERSION,
  };
}

/** Atomic write: temp file + rename, so a crash cannot leave half a file. */
export function saveSettings(file: string, settings: BoothSettings): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, file);
}

export function applyPatch(current: BoothSettings, patch: SettingsPatch): BoothSettings {
  const next = {
    ...current,
    ...patch,
    camera: { ...current.camera, ...patch.camera },
    tracking: { ...current.tracking, ...patch.tracking },
    scoreFeed: { ...current.scoreFeed, ...patch.scoreFeed },
  };
  return boothSettingsSchema.parse(next);
}
