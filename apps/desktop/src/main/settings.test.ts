import { describe, expect, it } from 'vitest';
import { boothSettingsSchema, PROFILE_DEFAULTS_VERSION, TRACKING_TUNING_VERSION } from '@booth/contracts';
import { migrateProfile, migrateTracking } from './settings';

describe('tracking settings migration', () => {
  it('moves settings saved with the old strict thresholds to the tuned defaults once', () => {
    const old = boothSettingsSchema.parse({
      schemaVersion: 1,
      tracking: { delegate: 'CPU', model: 'full', targetHz: 30, maxInFlight: 1, inputWidth: 640, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 },
    });
    expect(old.tracking.tuning).toBe(0);
    const m = migrateTracking(old);
    expect(m.tracking.tuning).toBe(TRACKING_TUNING_VERSION);
    expect(m.tracking.minTrackingConfidence).toBe(0.35);
    expect(m.tracking.minPosePresenceConfidence).toBe(0.35);
    expect(m.tracking.model).toBe('full');
    // Operator changes made after the migration are kept.
    const tuned = { ...m, tracking: { ...m.tracking, minTrackingConfidence: 0.6 } };
    expect(migrateTracking(tuned).tracking.minTrackingConfidence).toBe(0.6);
  });
});

describe('default profile migration', () => {
  it('moves settings left on the old dev default to the Maltina profile once, and keeps later choices', () => {
    const old = boothSettingsSchema.parse({ schemaVersion: 1, activeProfileId: 'dev-showcase' });
    const m = migrateProfile(old);
    expect(m.activeProfileId).toBe('maltina');
    expect(m.profileDefaults).toBe(PROFILE_DEFAULTS_VERSION);
    expect(migrateProfile({ ...m, activeProfileId: 'dev-showcase' }).activeProfileId).toBe('dev-showcase');
    expect(migrateProfile(boothSettingsSchema.parse({ schemaVersion: 1, activeProfileId: 'other-event' })).activeProfileId).toBe('other-event');
  });
});
