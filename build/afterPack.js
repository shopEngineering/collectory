// Ad-hoc sign the packed .app before DMG creation. electron-builder skips codesign entirely
// when no identity is configured, leaving only the linker signature — downloaded arm64 builds
// then show "app is damaged" with no recovery path (see DESIGN.md §7). A real ad-hoc signature
// keeps the recoverable System Settings → "Open Anyway" flow working.
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', appPath], { stdio: 'inherit' });
};
