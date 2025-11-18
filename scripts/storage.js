// Storage utilities for JobScout

/**
 * Get a value from chrome.storage.local
 */
export async function get(key, defaultValue = null) {
  const result = await chrome.storage.local.get([key]);
  return result[key] !== undefined ? result[key] : defaultValue;
}

/**
 * Set a value in chrome.storage.local
 */
export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Get multiple values from chrome.storage.local
 */
export async function getMultiple(keys) {
  return await chrome.storage.local.get(keys);
}

/**
 * Set multiple values in chrome.storage.local
 */
export async function setMultiple(data) {
  await chrome.storage.local.set(data);
}

/**
 * Remove a key from chrome.storage.local
 */
export async function remove(key) {
  await chrome.storage.local.remove([key]);
}

/**
 * Clear all storage
 */
export async function clear() {
  await chrome.storage.local.clear();
}

/**
 * Get all stored data
 */
export async function getAll() {
  return await chrome.storage.local.get(null);
}

/**
 * Run state management for scanning
 */
const RUN_STATE_KEYS = {
  status: 'scanRunStatus', // 'idle' | 'scanning'
  pagesProcessed: 'scanPagesProcessed',
  jobsScanned: 'scanJobsScanned',
  newJobs: 'scanNewJobs',
  currentUrl: 'scanCurrentUrl',
  currentPage: 'scanCurrentPage'
};

/**
 * Initialize/reset run state
 */
export async function resetRunState() {
  await setMultiple({
    [RUN_STATE_KEYS.status]: 'idle',
    [RUN_STATE_KEYS.pagesProcessed]: 0,
    [RUN_STATE_KEYS.jobsScanned]: 0,
    [RUN_STATE_KEYS.newJobs]: 0,
    [RUN_STATE_KEYS.currentUrl]: '',
    [RUN_STATE_KEYS.currentPage]: 0
  });
}

/**
 * Get current run state
 */
export async function getRunState() {
  return await getMultiple([
    RUN_STATE_KEYS.status,
    RUN_STATE_KEYS.pagesProcessed,
    RUN_STATE_KEYS.jobsScanned,
    RUN_STATE_KEYS.newJobs,
    RUN_STATE_KEYS.currentUrl,
    RUN_STATE_KEYS.currentPage
  ]);
}

/**
 * Update run state
 */
export async function updateRunState(updates) {
  const stateUpdates = {};
  for (const [key, value] of Object.entries(updates)) {
    if (RUN_STATE_KEYS[key]) {
      stateUpdates[RUN_STATE_KEYS[key]] = value;
    }
  }
  await setMultiple(stateUpdates);
}

