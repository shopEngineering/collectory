'use strict';

// electron-builder configuration (JS so signing/notarization can be conditional).
//
// Signing: electron-builder signs with a Developer ID Application certificate
// when one is available — imported from CSC_LINK/CSC_KEY_PASSWORD in CI, or
// found in the local keychain for `npm run dist`.
//
// Notarization: enabled only when Apple credentials are present in the env
// (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID). Without them the
// build still succeeds (signed but un-notarized) instead of failing — so the
// pipeline never breaks if a release runs before the secrets are set.

const hasNotaryCreds = Boolean(
  process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID,
);

module.exports = {
  appId: 'com.collectory.app',
  productName: 'The Collectory',
  artifactName: 'Collectory-${arch}.${ext}',
  directories: { buildResources: 'build', output: 'release' },
  files: ['electron/**', 'server/**', '!server/test/**', 'client/dist/**', 'package.json'],
  asarUnpack: ['**/*.node'],
  npmRebuild: true,
  mac: {
    category: 'public.app-category.productivity',
    target: [{ target: 'dmg' }, { target: 'zip' }],
    icon: 'build/icon.png',
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: hasNotaryCreds ? { teamId: process.env.APPLE_TEAM_ID } : false,
  },
  dmg: {
    title: 'The Collectory',
    iconSize: 100,
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
  publish: [{ provider: 'github' }],
};
