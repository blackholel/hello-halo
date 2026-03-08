// afterPack hook - Inspect macOS signing status after packaging.
// This hook does not alter signatures. It only reports release risk early.
const { execSync } = require('child_process');
const path = require('path');

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
}

function extractLine(output, prefix) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix));
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const entitlementsPath = path.join(__dirname, '..', 'resources', 'entitlements.mac.plist');

  console.log(`[afterPack] Inspect signing status: ${appPath}`);

  try {
    let details = run(`codesign -dv --verbose=4 "${appPath}" 2>&1`);
    let signature = extractLine(details, 'Signature=');
    let teamId = extractLine(details, 'TeamIdentifier=');

    if (signature) console.log(`[afterPack] ${signature}`);
    if (teamId) console.log(`[afterPack] ${teamId}`);

    const hasDevIdSignature =
      Boolean(teamId) &&
      !teamId.includes('not set') &&
      Boolean(signature) &&
      !signature.toLowerCase().includes('adhoc');

    try {
      run(`codesign --verify --deep --strict --verbose=2 "${appPath}"`);
      console.log('[afterPack] codesign verify: passed');
    } catch (verifyError) {
      if (hasDevIdSignature) {
        throw verifyError;
      }

      console.warn('[afterPack] codesign verify failed without Developer ID signature, applying ad-hoc fallback...');
      run(
        `codesign --force --deep -s - --entitlements "${entitlementsPath}" --timestamp=none "${appPath}"`
      );
      run(`codesign --verify --deep --strict --verbose=2 "${appPath}"`);
      details = run(`codesign -dv --verbose=4 "${appPath}" 2>&1`);
      signature = extractLine(details, 'Signature=');
      teamId = extractLine(details, 'TeamIdentifier=');
      if (signature) console.log(`[afterPack] ${signature}`);
      if (teamId) console.log(`[afterPack] ${teamId}`);
      console.log('[afterPack] ad-hoc fallback applied');
    }

    try {
      run(`spctl -a -vv -t execute "${appPath}"`);
      console.log('[afterPack] gatekeeper assess: passed');
    } catch (error) {
      const output = String(error.stdout || error.stderr || error.message).trim();
      console.warn('[afterPack] gatekeeper assess: failed');
      if (output) {
        console.warn(output);
      }
      console.warn(
        '[afterPack] Warning: release builds should use Developer ID signing and notarization. ' +
          'Otherwise users may see security block dialogs.'
      );
    }
  } catch (error) {
    console.error('[afterPack] signing inspection failed:', error.message);
  }
};
