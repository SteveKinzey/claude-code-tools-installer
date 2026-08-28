#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const componentCatalogPath = path.join(root, 'desktop', 'convex-components.json');
const packagePath = path.join(root, 'desktop', 'package.json');
const catalog = JSON.parse(fs.readFileSync(componentCatalogPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (catalog.count !== 145 || !Array.isArray(catalog.components) || catalog.components.length !== 145) {
  throw new Error(`Expected exactly 145 verified Convex Components, found count=${catalog.count}, entries=${catalog.components?.length ?? 0}.`);
}

const ids = new Set();
const packages = new Set();
for (const component of catalog.components) {
  for (const field of ['id', 'name', 'category', 'packageName', 'sourceUrl', 'installCommand']) {
    if (!component[field] || typeof component[field] !== 'string') {
      throw new Error(`Component ${component.id || component.name || 'unknown'} is missing a valid ${field}.`);
    }
  }
  if (!component.requiresProject) throw new Error(`${component.name} must remain marked as project-level.`);
  if (!component.installCommand.startsWith(`npm install ${component.packageName}`)) {
    throw new Error(`${component.name} has an unexpected install command.`);
  }
  if (ids.has(component.id)) throw new Error(`Duplicate component ID: ${component.id}.`);
  if (packages.has(component.packageName)) throw new Error(`Duplicate component package identity: ${component.packageName}.`);
  ids.add(component.id);
  packages.add(component.packageName);
}

const hasPackagedComponentCatalog = packageJson.build?.extraResources?.some(
  (resource) => resource.from === 'convex-components.json' && resource.to === 'convex-components.json',
);
if (!hasPackagedComponentCatalog) {
  throw new Error('desktop/convex-components.json is not included in packaged app resources.');
}

console.log(`Convex component catalog passed: ${catalog.components.length} project-level packages with unique IDs and package identities.`);
