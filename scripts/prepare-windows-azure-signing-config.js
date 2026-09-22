#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..', 'desktop');
const packagePath = path.join(desktopDir, 'package.json');
const required = {
  AZURE_CODESIGN_ENDPOINT: 'Azure Artifact Signing endpoint',
  AZURE_CODESIGN_ACCOUNT_NAME: 'Azure Artifact Signing account name',
  AZURE_CODESIGN_PROFILE_NAME: 'Azure certificate profile name',
  CCTI_WINDOWS_PUBLISHER_NAME: 'exact certificate publisher name',
};

function outputPath() {
  const index = process.argv.indexOf('--out');
  if (index === -1 || !process.argv[index + 1]) throw new Error('Use --out <desktop-relative-path>.');
  const output = path.resolve(desktopDir, process.argv[index + 1]);
  if (!output.startsWith(`${desktopDir}${path.sep}`)) throw new Error('Write resolved config inside desktop/.');
  return output;
}

function signingValues() {
  const missing = Object.entries(required).filter(([key]) => !String(process.env[key] || '').trim());
  if (missing.length) throw new Error(`Signing settings are required: ${missing.map(([key, label]) => `${key} (${label})`).join(', ')}`);
  const values = Object.fromEntries(Object.keys(required).map((key) => [key, String(process.env[key]).trim()]));
  if (Object.values(values).some((value) => /[<>\[\]]/.test(value))) throw new Error('Signing settings cannot contain placeholders.');
  return values;
}

try {
  const output = outputPath();
  const values = signingValues();
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const config = {
    ...packageJson.build,
    forceCodeSigning: true,
    win: {
      ...(packageJson.build.win || {}),
      target: [{ target: 'nsis', arch: ['x64'] }],
      azureSignOptions: {
        publisherName: values.CCTI_WINDOWS_PUBLISHER_NAME,
        endpoint: values.AZURE_CODESIGN_ENDPOINT,
        codeSigningAccountName: values.AZURE_CODESIGN_ACCOUNT_NAME,
        certificateProfileName: values.AZURE_CODESIGN_PROFILE_NAME,
        fileDigest: 'SHA256',
        timestampRfc3161: 'http://timestamp.acs.microsoft.com',
        timestampDigest: 'SHA256',
      },
    },
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Prepared signed Windows config: ${path.relative(desktopDir, output)}`);
} catch (error) {
  console.error(`[Windows signing preparation] ${error.message}`);
  process.exitCode = 2;
}
