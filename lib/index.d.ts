export interface ClientOptions {
  /** HTTP request deadline in milliseconds. */
  requestTimeoutMs?: number;
  /** Log HTTP metadata to stderr without payloads or credentials. */
  debug?: boolean;
  /** Backend origin without /api. Defaults to CUSTOMERGPT_API_URL, saved config or https://api.customergpt.ai. */
  base?: string;
  /** Defaults to CUSTOMERGPT_API_KEY. */
  key?: string;
}
export interface Job {
  id: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'claimed';
  token?: string;
  previewUrl?: string;
  error?: string;
  [key: string]: unknown;
}
export interface ActionResult<T = unknown> { ok: true; data: T }
export interface ActionCatalog { actions: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; authentication: string }> }
export interface PollingOptions { timeoutMs?: number; intervalMs?: number }
export function request(action: undefined, input?: undefined, options?: ClientOptions): Promise<ActionCatalog>;
export function request<T = unknown>(action: string, input?: Record<string, unknown>, options?: ClientOptions): Promise<ActionResult<T>>;
export function waitForJob(job: Job, options?: ClientOptions & PollingOptions): Promise<Job>;
export function createClient(options?: ClientOptions): {
  actions(): Promise<ActionCatalog>;
  call<T = unknown>(action: string, input?: Record<string, unknown>): Promise<ActionResult<T>>;
  waitForJob(job: Job, options?: PollingOptions): Promise<Job>;
};
