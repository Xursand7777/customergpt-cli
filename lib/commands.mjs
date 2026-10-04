import {closest, suggestCommand} from './suggest.mjs';

export const commands = {
  'messages send': {action:'messages_send',pos:['message'],usage:'messages send <question> --chatbot <id> --yes (preview; uses message quota)'},
  'installation snippet': {action:'installation_snippet',usage:'installation snippet --chatbot <id>'},
  'chatbots list': {action:'chatbots_list',usage:'chatbots list'},
  'chatbots get': {action:'chatbots_get',pos:['chatbotId'],usage:'chatbots get <id>'},
  'chatbots create': {action:'chatbots_create',pos:['name'],usage:'chatbots create <name> --url <website> --yes'},
  'chatbots update': {action:'chatbots_update',pos:['chatbotId'],usage:'chatbots update <id> --name <name> --yes'},
  'chatbots delete': {action:'chatbots_delete',pos:['chatbotId'],usage:'chatbots delete <id> --dry-run, then --yes (permanent: removes knowledge, conversations and leads)'},
  'knowledge website add': {action:'sources_add',pos:['url'],usage:'knowledge website add <url> --chatbot <id> --yes [--wait]'},
  'knowledge links add': {action:'sources_add',rest:'urls',usage:'knowledge links add <url> [url…] --chatbot <id> --yes [--wait] (only these pages, up to 20)'},
  'knowledge sitemap add': {action:'sources_add',pos:['sitemapUrl'],usage:'knowledge sitemap add <sitemap-url> --chatbot <id> --yes [--wait] (pages listed in sitemap.xml)'},
  'knowledge files add': {action:'sources_add',pos:['filePath'],usage:'knowledge files add <path> --chatbot <id> --yes [--wait] (.pdf, .docx, .md, .txt or .csv up to 10 MB)'},
  'knowledge text add': {action:'sources_add',pos:['content'],usage:'knowledge text add <text> --chatbot <id> --name <name> --yes [--wait]'},
  'knowledge documents list': {action:'sources_list',usage:'knowledge documents list --chatbot <id>'},
  'knowledge documents resync': {action:'sources_sync',pos:['sourceId'],usage:'knowledge documents resync <source-id> --chatbot <id> --yes [--wait]'},
  'knowledge documents delete': {action:'sources_delete',pos:['sourceId'],usage:'knowledge documents delete <source-id> --chatbot <id> --yes'},
  'knowledge responses list': {action:'responses_list',required:['chatbotId'],usage:'knowledge responses list --chatbot <id> (fixed answers to specific questions)'},
  'knowledge responses add': {action:'responses_create',required:['chatbotId','question','answer'],usage:'knowledge responses add --chatbot <id> --question <text> --answer <text> --yes'},
  'knowledge responses update': {action:'responses_update',pos:['responseId'],required:['chatbotId'],usage:'knowledge responses update <response-id> --chatbot <id> [--question <text>] [--answer <text>] --yes'},
  'knowledge responses delete': {action:'responses_delete',pos:['responseId'],required:['chatbotId'],usage:'knowledge responses delete <response-id> --chatbot <id> --dry-run, then --yes'},
  'knowledge status': {action:'training_status',required:['chatbotId'],usage:'knowledge status --chatbot <id> (what is training now and recent failures)'},
  'knowledge wait': {action:'training_status',required:['chatbotId'],waitAll:true,usage:'knowledge wait --chatbot <id> [--timeout <seconds>] (until all training settles; nonzero exit if any failed)',
    options:['--chatbot <UUID> Required: bot ID','--timeout <seconds> Total wait (default 900); on timeout exits with WAIT_TIMEOUT','--quiet Hide progress on stderr']},
  'onboarding start': {action:'onboarding_start',pos:['url'],usage:'onboarding start <url> --yes [--wait]'},
  'onboarding status': {action:'jobs_get',pos:['jobId'],usage:'onboarding status <job-id> --token <temporary-token>'},
  'onboarding preview': {action:'onboarding_preview',pos:['jobId'],usage:'onboarding preview <job-id> --token <temporary-token> --message <question>'},
  'onboarding claim': {action:'onboarding_claim',pos:['jobId'],usage:'onboarding claim <job-id> --token <temporary-token> --yes'},
  'jobs get': {action:'jobs_get',pos:['jobId'],usage:'jobs get <job-id>'},
  'conversations list': {action:'conversations_list',usage:'conversations list --chatbot <id> [--mode human] [--leads-only]'},
  'leads list': {action:'conversations_list',fixed:{leadsOnly:true},usage:'leads list --chatbot <id> (conversations that captured contact details)'},
  'conversations get': {action:'conversations_get',pos:['conversationId'],usage:'conversations get <id> --chatbot <id>'},
  'conversations update': {action:'conversations_update',pos:['conversationId'],usage:'conversations update <id> --chatbot <id> --status closed --yes'},
  'analytics get': {action:'analytics_get',usage:'analytics get --chatbot <id>'},
  'usage': {action:'account_usage',usage:'usage'},
  'whoami': {action:'account_usage',usage:'whoami (validate current account access and show usage)'},
};
const booleans = {'--leads-only':'leadsOnly'};
const passthroughFlags = ['--yes','--dry-run','--wait'];
const fields = {'--chatbot':'chatbotId','--source':'sourceId','--name':'name','--url':'url','--content':'content','--token':'token','--message':'message','--status':'status','--mode':'mode','--page':'page','--limit':'limit','--max-pages':'maxPages','--question':'question','--answer':'answer'};
export function parseCommand(args) {
  const found = Object.entries(commands).sort(([a],[b])=>b.length-a.length).find(([name]) => args.slice(0,name.split(' ').length).join(' ') === name);
  if (!found) {
    const suggestion = suggestCommand(args, [...Object.keys(commands), ...Object.keys(specialHelp)]);
    const error = new Error(suggestion ? 'Unknown command. Did you mean "customergpt '+suggestion+'"?' : 'Unknown command');
    error.code = 'UNKNOWN_COMMAND';
    error.hint = suggestion ? 'Run customergpt '+suggestion+' --help' : 'Run customergpt --help to list commands.';
    throw error;
  }
  const [name,def] = found;
  const rest = args.slice(name.split(' ').length), input = {...def.fixed}, passthrough = [];
  let position = 0;
  for (let i=0;i<rest.length;i++) {
    const arg = rest[i];
    if (fields[arg]) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(arg+' requires a value');
      const field = fields[arg];
      input[field] = ['page','limit','maxPages'].includes(field) ? Number(value) : value;
      if (typeof input[field] === 'number' && (!Number.isInteger(input[field]) || input[field] < 1)) throw new Error(arg+' requires a positive integer');
    } else if (booleans[arg]) input[booleans[arg]] = true;
    else if (passthroughFlags.includes(arg)) passthrough.push(arg);
    else if (arg === '--json') { /* Output format is chosen by the caller. */ }
    else if (arg.startsWith('-')) {
      const suggestion = closest(arg, [...Object.keys(fields), ...Object.keys(booleans), ...passthroughFlags, '--json']);
      const error = new Error('Unknown option: '+arg+(suggestion ? '. Did you mean '+suggestion+'?' : ''));
      error.code = 'UNKNOWN_OPTION';
      error.hint = 'Run customergpt '+name+' --help';
      throw error;
    }
    else if (def.pos?.[position]) input[def.pos[position++]] = arg;
    else if (def.rest) (input[def.rest] ??= []).push(arg);
    else throw new Error('Unexpected argument: '+arg);
  }
  for (const field of [...(def.pos || []), ...(def.rest ? [def.rest] : []), ...(def.required || [])]) if (!input[field]) throw new Error('Usage: customergpt '+def.usage);
  if (def.action === 'chatbots_create' || def.action === 'chatbots_update') { if (input.url) { input.websiteUrl = input.url; delete input.url; } }
  const firstUrl = input.url || input.urls?.[0] || input.sitemapUrl;
  if (def.action === 'sources_add' && !input.name && firstUrl) input.name = new URL(firstUrl).hostname + (input.urls ? ' links' : input.sitemapUrl ? ' sitemap' : '');
  return ['call',def.action,'--json',JSON.stringify(input),...passthrough,...(def.waitAll ? ['--wait-all'] : [])];
}
const commandOptions = {
  chatbots_list: ['--page <integer> Page number (default 1)','--limit <integer> Items per page (default 25, max 100)'],
  chatbots_create: ['--url <URL> Required: website URL'],
  chatbots_delete: ['--dry-run Show the bot name and how many sources and conversations would be removed','--yes Delete permanently; cannot be undone'],
  chatbots_update: ['--name <text> New name','--url <URL> New website URL'],
  sources_add: ['--chatbot <UUID> Required: bot ID','--name <text> Required for text; others default to the hostname','--max-pages <integer> Page limit for website and sitemap (default 5, max 20)'],
  sources_list: ['--chatbot <UUID> Required: bot ID','--page <integer> Page number','--limit <integer> Page size'],
  sources_sync: ['--chatbot <UUID> Required: bot ID','--max-pages <integer> Crawl limit (max 20)'],
  sources_delete: ['--chatbot <UUID> Required: bot ID'],
  messages_send: ['--chatbot <UUID> Required: bot ID'],
  installation_snippet: ['--chatbot <UUID> Required: bot ID'],
  jobs_get: ['--token <secret> Required for anonymous jobs'],
  onboarding_start: ['--name <text> Optional bot name','--max-pages <integer> Crawl limit (default 5, max 20)'],
  onboarding_preview: ['--token <secret> Required: draft token','--message <text> Required: question'],
  onboarding_claim: ['--token <secret> Required: draft token; login is required'],
  conversations_list: ['--chatbot <UUID> Required: bot ID','--mode <ai|human> Filter','--leads-only Only conversations that captured a lead','--page <integer> Page number','--limit <integer> Page size'],
  conversations_get: ['--chatbot <UUID> Required: bot ID','--page <integer> Page number','--limit <integer> Page size'],
  conversations_update: ['--chatbot <UUID> Required: bot ID','--status <open|closed> Set status','--mode <ai|human> Set mode; provide status or mode'],
  analytics_get: ['--chatbot <UUID> Required: bot ID'],
  training_status: ['--chatbot <UUID> Required: bot ID'],
  responses_list: ['--chatbot <UUID> Required: bot ID','--page <integer> Page number','--limit <integer> Page size'],
  responses_create: ['--chatbot <UUID> Required: bot ID','--question <text> Required: up to 500 characters; matched ignoring case and punctuation','--answer <text> Required: up to 4000 characters, returned verbatim on an exact match'],
  responses_update: ['--chatbot <UUID> Required: bot ID','--question <text> New question','--answer <text> New answer; provide question or answer'],
  responses_delete: ['--chatbot <UUID> Required: bot ID','--dry-run Validate without deleting','--yes Delete permanently'],
};
const specialHelp = {
  login: ['login [--no-browser | --token-stdin] [--read-only] [--profile <name>]','Opens browser OAuth. --no-browser prints the URL. --read-only requests only agents:read. --token-stdin reads an existing API key from stdin.'],
  logout: ['logout [--profile <name>]','Revokes saved OAuth and clears this profile. Environment keys remain unchanged.'],
  profiles: ['profiles list | profiles use <name>','Create a profile with login --profile <name>. List never prints tokens.'],
  doctor: ['doctor [--profile <name>] [--api-base <origin>]','Checks Node.js, API, OAuth metadata and credentials. Does not create bots or make AI requests. Exits nonzero if any check fails.'],
  call: ['call <action> [--json <object> | --json-file <path>] [--yes | --dry-run] [--wait]','Use actions for live input schemas. --json is input data for call.'],
  actions: ['actions','Print the deployed server action catalog and JSON schemas.'],
  mcp: ['mcp [--profile <name>]','Start stdio MCP with this profile. stdout is reserved for MCP messages.'],
  'agent-guide': ['agent-guide','Print the workflow and command map as JSON.'],
  dashboard: ['dashboard [--print]','Open the CustomerGPT dashboard in your browser; --print (or a non-terminal) only prints the URL.'],
  completion: ['completion bash | completion zsh','Print a shell completion script. Add source <(customergpt completion zsh) to ~/.zshrc.'],
};
export function help(prefix = '') {
  const selected = Object.entries(commands).filter(([name]) => !prefix || name === prefix || name.startsWith(prefix+' '));
  const lines = selected.flatMap(([name,def]) => [
    '  customergpt '+def.usage,
    ...(prefix === name ? (def.options || commandOptions[def.action] || []).map(value=>'    '+value) : []),
  ]);
  const special = specialHelp[prefix];
  if(prefix && !special && !lines.length) throw new Error('Unknown command: '+prefix+'. Run customergpt --help.');
  return ['CustomerGPT CLI','',...(special ? ['  customergpt '+special[0],special[1]] : []),...(!prefix ? Object.values(specialHelp).map(value=>'  customergpt '+value[0]) : []),...lines,'',
    'Global flags:',
    '  --profile, -p <name> Select saved account/server (or CUSTOMERGPT_PROFILE)',
    '  --api-base <origin> Override server; never forwards saved tokens to another origin',
    '  --debug Trace API method/path/status/timing to stderr; never logs tokens or payloads',
    '  --quiet, -q Suppress job progress; errors and requested debug output remain visible',
    '  --timeout <seconds> Positive duration up to 86400; per API request and total training wait',
    '  --json Print JSON (default when stdout is not a terminal); NO_COLOR disables colors',
    '  --help, -h Show help; --version Show CLI version',
    '', 'Action flags: --yes, --dry-run, --wait.',
    'Writes require --yes. --dry-run validates without changes. --wait waits for a returned training job.',
    'Examples: customergpt login --profile work; customergpt chatbots list --profile work',
  ].join('\n');
}

const extraCommands = ['dashboard','login','logout','profiles list','profiles use','doctor','call','actions','mcp','agent-guide','completion bash','completion zsh','help'];
const globalFlags = ['--profile','--api-base','--debug','--quiet','--timeout','--json','--help'];

/** Next words for shell completion after the typed words (flags already typed are ignored). */
export function completions(typed) {
  const words = typed.filter(word => !word.startsWith('-'));
  const names = [...Object.keys(commands), ...extraCommands].map(name => name.split(' '));
  const exact = Object.entries(commands).find(([name]) => name === words.slice(0, name.split(' ').length).join(' ') && name.split(' ').length <= words.length);
  if (exact) {
    const [, def] = exact;
    const flags = (def.options || commandOptions[def.action] || []).map(option => option.split(' ')[0]);
    const write = /--yes/.test(def.usage) ? ['--yes','--dry-run'] : [];
    const wait = /--wait/.test(def.usage) ? ['--wait'] : [];
    return [...new Set([...flags, ...write, ...wait, ...globalFlags])];
  }
  const next = names.filter(parts => parts.length > words.length && words.every((word, i) => parts[i] === word)).map(parts => parts[words.length]);
  return [...new Set(next)];
}

export function completionScript(shell) {
  if (shell === 'bash') return `# customergpt bash completion
_customergpt() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\n'
  COMPREPLY=($(compgen -W "$(customergpt __complete "\${COMP_WORDS[@]:1:COMP_CWORD-1}" 2>/dev/null)" -- "$cur"))
}
complete -o default -F _customergpt customergpt
`;
  if (shell === 'zsh') return `#compdef customergpt
# customergpt zsh completion
_customergpt() {
  local -a options
  options=("\${(@f)$(customergpt __complete "\${(@)words[2,CURRENT-1]}" 2>/dev/null)}")
  compadd -- $options
}
compdef _customergpt customergpt
`;
  throw new Error('Usage: customergpt completion bash | completion zsh');
}
