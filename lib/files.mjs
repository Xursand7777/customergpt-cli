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
