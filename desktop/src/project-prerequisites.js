const fs = require('node:fs/promises');
const path = require('node:path');

function projectPackageName(projectPath) {
  const candidate = path.basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return candidate || 'ccti-project';
}

async function resolveProjectFolder(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new Error('Choose a project folder before continuing.');
  }
  const resolvedProjectPath = path.resolve(projectPath);
  const info = await fs.stat(resolvedProjectPath);
  if (!info.isDirectory()) throw new Error('The selected project path is not a folder.');
  return resolvedProjectPath;
}

async function inspectProjectPackage(projectPath) {
  const resolvedProjectPath = await resolveProjectFolder(projectPath);
  const packageJsonPath = path.join(resolvedProjectPath, 'package.json');
  try {
    const source = await fs.readFile(packageJsonPath, 'utf8');
    let json;
    try {
      json = JSON.parse(source);
    } catch {
      throw new Error('The existing package.json could not be read. CCTI left it unchanged. Fix that file, then try again.');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('The existing package.json is not a project file CCTI can use. CCTI left it unchanged. Fix that file, then try again.');
    }
    return { projectPath: resolvedProjectPath, packageJsonPath, packageState: 'existing', manifest: json };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { projectPath: resolvedProjectPath, packageJsonPath, packageState: 'missing', manifest: null };
  }
}

async function prepareProjectPackage(projectPath, { dryRun = false } = {}) {
  const inspection = await inspectProjectPackage(projectPath);
  if (inspection.packageState === 'existing') return { ...inspection, created: false, wouldCreate: false };
  const manifest = {
    name: projectPackageName(inspection.projectPath),
    version: '0.1.0',
    private: true,
  };
  if (dryRun) return { ...inspection, manifest, created: false, wouldCreate: true };
  try {
    await fs.writeFile(inspection.packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return prepareProjectPackage(inspection.projectPath, { dryRun: false });
  }
  return { ...inspection, manifest, packageState: 'created', created: true, wouldCreate: false };
}

module.exports = {
  inspectProjectPackage,
  prepareProjectPackage,
  resolveProjectFolder,
};
