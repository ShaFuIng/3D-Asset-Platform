// Central control panel for mock mode.
//
// How to enable mock mode:
//   1. Copy `.env.example` to `.env` at the project root (if you haven't already).
//   2. Set `VITE_MOCK_MODE=true` in that `.env` file.
//   3. Restart the Vite dev server (`npm run dev`).
//   Mock mode is OFF by default, so nothing changes for teammates who don't opt in.
//
// How to tune simulated delays:
//   Edit the `MOCK_DELAYS` values below. All units are milliseconds.
//
// How to add a new mock scenario (e.g. a new failure case):
//   - To change how often 3D jobs fail, tweak `MOCK_JOB_OUTCOME_MODE` /
//     `MOCK_JOB_FAILURE_RATE` below and see `resolveJobOutcome()` in mockClient.ts.
//   - To simulate a specific failure deterministically (e.g. only for a certain
//     image), add a branch in `mockCreate3DJob()` in mockClient.ts that checks
//     `imageId` before falling back to `resolveJobOutcome()`.
//   - To add a brand new fake chat reply / prompt, extend the arrays in
//     fixtures.ts.

export const isMockModeEnabled = import.meta.env.VITE_MOCK_MODE === 'true';

export const MOCK_DELAYS = {
  // Generic round-trip latency for simple request/response calls (health checks, job lookups).
  networkLatency: 400,
  // Time to "generate" an image from a chat prompt.
  imageGeneration: 1200,
  // Time to "upload" a local image file.
  imageUpload: 600,
  // How long a freshly created job stays in the "queued" status.
  jobQueuedDuration: 3000,
  // How long a job stays in the "running" status before finishing (succeeded/failed).
  jobRunningDuration: 5000,
} as const;

export type MockJobOutcomeMode = 'random' | 'always-succeed' | 'always-fail';

// 'random' rolls MOCK_JOB_FAILURE_RATE on every new job.
// Switch to 'always-fail' to develop/test the failure UI, or 'always-succeed'
// for a fully deterministic happy path demo.
export const MOCK_JOB_OUTCOME_MODE: MockJobOutcomeMode = 'random';
export const MOCK_JOB_FAILURE_RATE = 0.15;
