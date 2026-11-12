import { rmSync } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Maltina Dance All',
    executableName: 'maltina-dance-all',
    asar: true,
    // Content, models and WASM are shipped next to app.asar (resources/assets)
    // and served through the booth-asset:// protocol.
    extraResource: [path.resolve(__dirname, '../../assets')],
    appCopyright: 'Moving Surface Interactive Media Limited',
  },
  rebuildConfig: {},
  hooks: {
    // Never ship: song sources (only inputs to `pnpm assets:music`) and the
    // development routine with its audio and test fixture (used by the tests only).
    postPackage: async (_config, result) => {
      const devOnly = [
        ['audio', 'source'],
        ['audio', 'dev-groove-120bpm.wav'],
        ['routines', 'dev-groove.json'],
        ['fixtures', 'dev-groove-synthetic.json'],
      ];
      for (const out of result.outputPaths) {
        for (const rel of devOnly) rmSync(path.join(out, 'resources', 'assets', ...rel), { recursive: true, force: true });
      }
    },
  },
  makers: [
    new MakerSquirrel({
      name: 'MaltinaDanceAll',
      setupExe: 'MaltinaDanceAllSetup.exe',
      // Code signing: set WINDOWS_CERTIFICATE_FILE / WINDOWS_CERTIFICATE_PASSWORD
      // (see docs/release-checklist.md). Unsigned builds are for testing only.
      ...(process.env.WINDOWS_CERTIFICATE_FILE
        ? {
            certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
            certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
          }
        : {}),
    }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/participant.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/preload/operator.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/preload/leaderboard.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [
        { name: 'participant', config: 'vite.participant.config.ts' },
        { name: 'operator', config: 'vite.operator.config.ts' },
        { name: 'leaderboard', config: 'vite.leaderboard.config.ts' },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
