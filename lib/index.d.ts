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
export interface TrainingItem { jobId: string | null; sourceId: string | null; name: string; status: string; startedAt: string }
export interface TrainingFailure { jobId: string | null; sourceId: string; name: string; error: string; failedAt: string }
/** Result of the training_status action. */
export interface TrainingStatus { chatbotId: string; idle: boolean; active: TrainingItem[]; failed: TrainingFailure[]; checkedAt: string }
/** Settled state after waitForTraining; failed is always empty because failures reject with TRAINING_FAILED. */
export interface TrainingWaitResult {
  chatbotId: string;
  idle: true;
  active: [];
  trained: Array<Pick<TrainingItem, 'jobId' | 'sourceId' | 'name'>>;
  failed: TrainingFailure[];
  waitedMs: number;
}
export interface TrainingWaitOptions extends PollingOptions { onProgress?(status: TrainingStatus): void }
export function request(action: undefined, input?: undefined, options?: ClientOptions): Promise<ActionCatalog>;
export function request<T = unknown>(action: string, input?: Record<string, unknown>, options?: ClientOptions): Promise<ActionResult<T>>;
export function waitForJob(job: Job, options?: ClientOptions & PollingOptions): Promise<Job>;
/** Wait until nothing trains for the bot. Rejects with code TRAINING_FAILED or WAIT_TIMEOUT and error.training. */
export function waitForTraining(chatbotId: string, options?: ClientOptions & TrainingWaitOptions): Promise<TrainingWaitResult>;
export function createClient(options?: ClientOptions): {
  actions(): Promise<ActionCatalog>;
  call<T = unknown>(action: string, input?: Record<string, unknown>): Promise<ActionResult<T>>;
  waitForJob(job: Job, options?: PollingOptions): Promise<Job>;
  waitForTraining(chatbotId: string, options?: TrainingWaitOptions): Promise<TrainingWaitResult>;
};
