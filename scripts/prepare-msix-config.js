#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..', 'desktop');
const templatePath = path.join(desktopDir, 'build', 'appx-store.template.json');
const packagePath = path.join(desktopDir, 'package.json');
const assetDir = path.join(desktopDir, 'build', 'appx');
const requiredEnvironment = {
  CCTI_APPX_IDENTITY_NAME: 'Partner Center Identity name',
  CCTI_APPX_APPLICATION_ID: 'Partner Center Application ID',
  CCTI_APPX_PUBLISHER: 'Partner Center Publisher value',
};

function readOutPath() {
  const index = process.argv.indexOf('--out');
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error('Use --out <path>, for example: --out build/appx-store.resolved.json');
  }
  const output = path.resolve(desktopDir, process.argv[index + 1]);
  if (!output.startsWith(`${desktopDir}${path.sep}`)) throw new Error('Write the resolved configuration inside the desktop folder.');
  return output;
}

function readPartnerCenterValues() {
  const missing = Object.entries(requiredEnvironment).filter(([key]) => !String(process.env[key] || '').trim());
  if (missing.length) {
    const labels = missing.map(([key, label]) => `${key} (${label})`).join(', ');
    throw new Error(`Partner Center values are required before an MSIX build: ${labels}. Do not guess these values.`);
  }
  const values = {
    identityName: String(process.env.CCTI_APPX_IDENTITY_NAME).trim(),
    applicationId: String(process.env.CCTI_APPX_APPLICATION_ID).trim(),
    publisher: String(process.env.CCTI_APPX_PUBLISHER).trim(),
  };
  if (Object.values(values).some((value) => value.includes('[') || value.includes(']'))) throw new Error('Partner Center values cannot be placeholders. Copy the exact reserved values.');
  return values;
}

function assertAssets() {
  const requiredAssets = ['StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Wide310x150Logo.png'];
  const missing = requiredAssets.filter((asset) => !fs.existsSync(path.join(assetDir, asset)));
  if (missing.length) throw new Error(`Required AppX tile assets are missing: ${missing.join(', ')}`);
}

try {
  const output = readOutPath();
  const values = readPartnerCenterValues();
  assertAssets();
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const config = {
    ...packageJson.build,
    win: { ...(packageJson.build.win || {}), target: ['appx'] },
    appx: { ...template.appx, ...values },
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Prepared a local Store-only AppX configuration: ${path.relative(desktopDir, output)}`);
  console.log('Next step on Windows: npm run dist:win:store');
} catch (error) {
  console.error(`[MSIX preparation] ${error.message}`);
  process.exitCode = 2;
}
