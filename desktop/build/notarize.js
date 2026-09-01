const path = require('node:path');
const { notarize } = require('@electron/notarize');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required notarization environment variable: ${name}`);
  }
  return value;
}

exports.default = async function notarizeMacApp(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  if (process.env.NOTARIZE !== '1') {
    console.log('Skipping notarization. Set NOTARIZE=1 with managed Apple credential environment variables for a release build.');
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log(`Submitting ${appPath} to Apple’s notary service.`);

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: required('APPLE_ID'),
    appleIdPassword: required('APPLE_APP_SPECIFIC_PASSWORD'),
    teamId: required('APPLE_TEAM_ID'),
  });
};
