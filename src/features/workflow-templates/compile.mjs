import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {publicTemplateRows, publicMediaSlots, compilePublicTemplate, validateCatalog, officialCategories} from './core.mjs';

const [command, inputPath, mappingPath, outputPath] = process.argv.slice(2);
if (command === 'media-slots' && inputPath && mappingPath) {
  const response = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  const slots = publicMediaSlots(response);
  await writeFile(resolve(mappingPath), JSON.stringify({version: 1, slots}, null, 2) + '\n');
  console.log(`${slots.length} exact media slots; ${new Set(slots.map(slot => slot.source)).size} unique sources`);
} else if (command === 'compile' && inputPath && mappingPath && outputPath) {
  const response = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  const mapping = JSON.parse(await readFile(resolve(mappingPath), 'utf8'));
  const catalog = {version: 1, categories: officialCategories, templates: publicTemplateRows(response).map(row => compilePublicTemplate(row, {resources: mapping.resources || mapping}))};
  validateCatalog(catalog);
  await writeFile(resolve(outputPath), JSON.stringify(catalog, null, 2) + '\n');
  console.log(`${catalog.templates.length} public templates; ${catalog.templates.reduce((count, item) => count + item.graph.nodes.length, 0)} nodes; ${catalog.templates.reduce((count, item) => count + item.graph.edges.length, 0)} edges`);
} else throw Error('Usage: node src/features/workflow-templates/compile.mjs media-slots RAW_JSON SLOT_JSON | compile RAW_JSON MEDIA_MAP_JSON CATALOG_JSON');
