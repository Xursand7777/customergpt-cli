// Human-readable rendering for interactive terminals. Pipes, CI and --json keep the JSON contract.

export function useColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

export function palette(enabled) {
  const wrap = (open, close) => enabled ? value => `\x1b[${open}m${value}\x1b[${close}m` : value => String(value);
  return {bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), cyan: wrap(36, 39)};
}

const PREFERRED = ['id', 'name', 'title', 'status', 'mode', 'visitorName', 'visitorEmail', 'websiteUrl', 'url', 'type', 'sender', 'text', 'createdAt'];
const MAX_COLUMNS = 6;
const MAX_CELL = 48;

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const line = text.replace(/\s+/g, ' ');
  return line.length > MAX_CELL ? line.slice(0, MAX_CELL - 1) + '…' : line;
}

function statusColor(c, value) {
  if (['ready', 'completed', 'claimed', 'open', 'active', 'synced', 'pass'].includes(value)) return c.green(value);
  if (['failed', 'error', 'closed', 'fail'].includes(value)) return c.red(value);
  if (['pending', 'running', 'syncing', 'human'].includes(value)) return c.yellow(value);
  return value;
}

export function table(rows, c) {
  if (!rows.length) return c.dim('No results.');
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const columns = [...PREFERRED.filter(k => keys.includes(k)), ...keys.filter(k => !PREFERRED.includes(k) && rows.every(r => typeof r[k] !== 'object' || r[k] === null))].slice(0, MAX_COLUMNS);
  const cells = rows.map(row => columns.map(k => cell(row[k])));
  const widths = columns.map((k, i) => Math.max(k.length, ...cells.map(r => r[i].length)));
  const line = (values, style) => values.map((v, i) => style(v, i) + ' '.repeat(widths[i] - v.length)).join('  ').trimEnd();
  return [
    line(columns, v => c.bold(v)),
    ...cells.map(r => line(r, (v, i) => ['status', 'mode'].includes(columns[i]) ? statusColor(c, v) : columns[i] === 'id' ? c.cyan(v) : v)),
  ].join('\n');
}

function keyValues(object, c) {
  const entries = Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const width = Math.max(0, ...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => {
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return c.dim(k.padEnd(width)) + '  ' + (k === 'status' || k === 'mode' ? statusColor(c, text) : k === 'id' ? c.cyan(text) : text);
  }).join('\n');
}

function pageFooter(data, c) {
  if (typeof data.total !== 'number') return '';
  const shown = (data.items || data.messages || []).length;
  const pages = data.limit ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return '\n\n' + c.dim(`Showing ${shown} of ${data.total}` + (pages > 1 ? ` · page ${data.page} of ${pages} (use --page)` : ''));
}

/** Render an action result `{ok, data}` for a person reading a terminal. */
export function render(action, result, c) {
  const data = result?.data ?? result;
  if (data === null || data === undefined) return c.green('✔ Done');
  if (typeof data !== 'object') return String(data);
  if (data.dryRun) return c.yellow('Dry run: no changes made.') + '\n' + keyValues(data, c);
  if (action === 'installation_snippet' && data.snippet) return c.dim('Paste before </body>:') + '\n\n' + data.snippet;
  if (action === 'messages_send' && typeof data.response === 'string') return data.response;
  if (action === 'onboarding_preview' && typeof (data.response ?? data.answer) === 'string') return data.response ?? data.answer;
  if (Array.isArray(data.items)) return table(data.items, c) + pageFooter(data, c);
  if (Array.isArray(data.messages)) {
    const head = data.conversation ? keyValues(data.conversation, c) + '\n\n' : '';
    const lines = data.messages.map(m => `${c.bold(m.sender || 'message')}${m.time ? c.dim(' · ' + m.time) : ''}\n  ${String(m.text ?? '').replace(/\n/g, '\n  ')}`);
    return head + (lines.join('\n\n') || c.dim('No messages.')) + pageFooter(data, c);
  }
  if (Array.isArray(data.checks)) {
    const checks = data.checks.map(check => `${check.status === 'pass' ? c.green('✔') : c.red('✖')} ${check.name}${check.message ? c.dim(' — ' + check.message) : ''}`);
    return [c.dim(`CustomerGPT CLI ${data.version} · Node ${data.node} · ${data.base}${data.profile ? ' · profile ' + data.profile : ''}`), ...checks].join('\n');
  }
  if (typeof data.message === 'string' && Object.keys(data).length <= 2) return c.green('✔ ') + data.message;
  return keyValues(data, c);
}

export function renderError(error, c) {
  const lines = [c.red('✖ ' + error.message) + (error.code ? c.dim(` (${error.code})`) : '')];
  if (error.hint) lines.push(c.dim('→ ') + error.hint);
  if (error.job?.id) lines.push(c.dim(`→ Resume with: customergpt jobs get ${error.job.id}${error.job.token ? ' --token <token>' : ''}`));
  return lines.join('\n');
}
