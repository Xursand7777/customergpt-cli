import {readFileSync} from 'node:fs';

export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** Identifies the client to the server, e.g. `cli/0.5.0` or `mcp/0.5.0`. Never contains credentials. */
export const clientHeaders = (mode = 'cli') => ({'X-CustomerGPT-Client': mode + '/' + version});
