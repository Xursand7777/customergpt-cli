import {readFile, stat} from 'node:fs/promises';
import {basename, extname} from 'node:path';

export const FILE_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt', '.csv'];
const MAX_BYTES = 10 * 1024 * 1024;

/** Replace input.filePath with the file's base64 content, as sources_add expects. */
export async function attachFile(input) {
  if (typeof input.filePath !== 'string') return input;
  const {filePath, ...rest} = input;
  const fail = (message, hint) => Object.assign(new Error(message), {code: 'INVALID_FILE', hint});
  if (!FILE_EXTENSIONS.includes(extname(filePath).toLowerCase())) throw fail('Unsupported file type: ' + basename(filePath), 'Use a ' + FILE_EXTENSIONS.join(', ') + ' file.');
  let info;
  try { info = await stat(filePath); } catch { throw fail('Cannot read file: ' + filePath, 'Check the path and permissions.'); }
  if (!info.isFile()) throw fail('Not a file: ' + filePath);
  // Checked locally so a large file fails before it is read and uploaded.
  if (info.size > MAX_BYTES) throw fail('Files are limited to 10 MB: ' + basename(filePath));
  const name = basename(filePath);
  return {...rest, name: rest.name || name, file: {name, data: (await readFile(filePath)).toString('base64')}};
}

async function readText(path, label) {
  try { return await readFile(path, 'utf8'); }
  catch { throw Object.assign(new Error('Cannot read ' + label + ': ' + path), {code: 'INVALID_FILE', hint: 'Check the path and permissions.'}); }
}

/**
 * Resolve chatbots update file options: --sales-config-file is a JSON salesConfig patch that
 * explicit flags override, and --instructions-file supplies salesConfig.instructions.
 */
export async function readSettingFiles(input) {
  const {instructionsFile, salesConfigFile, ...rest} = input;
  if (salesConfigFile !== undefined) {
    let fromFile;
    try { fromFile = JSON.parse(await readText(salesConfigFile, 'sales config file')); }
    catch (error) { throw error.code === 'INVALID_FILE' ? error : Object.assign(new Error('Sales config file is not valid JSON: ' + salesConfigFile), {code: 'INVALID_FILE'}); }
    if (!fromFile || typeof fromFile !== 'object' || Array.isArray(fromFile)) throw Object.assign(new Error('Sales config file must contain a JSON object'), {code: 'INVALID_FILE'});
    rest.salesConfig = {...fromFile, ...rest.salesConfig};
  }
  if (instructionsFile !== undefined) rest.salesConfig = {...rest.salesConfig, instructions: (await readText(instructionsFile, 'instructions file')).trim()};
  return rest;
}
