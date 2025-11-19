// Storage utilities for JobScout

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {string} title
 * @property {string} company
 * @property {string} location
 * @property {string} datePosted
 * @property {string} url
 * @property {string=} descriptionHtml
 * @property {number=} score
 * @property {number=} matchScore
 * @property {number} scrapedAt
 * @property {boolean=} needsFetch
 */

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

/**
 * Fetch a job by id.
 * @param {string} id
 * @returns {Promise<Job|null>}
 */
export async function getJobById(id) {
  if (!id) return null;
  const { jobs = [] } = await chrome.storage.local.get(['jobs']);
  return jobs.find(job => job?.id === id) || null;
}

/**
 * Update or insert a job record.
 * @param {Job} job
 * @returns {Promise<Job>}
 */
export async function updateJob(job) {
  if (!job || !job.id) {
    throw new Error('Job must include an id');
  }

  const { jobs = [] } = await chrome.storage.local.get(['jobs']);
  const index = jobs.findIndex(existing => existing?.id === job.id);

  if (index === -1) {
    jobs.push(job);
    await chrome.storage.local.set({ jobs });
    return job;
  }

  jobs[index] = { ...jobs[index], ...job };
  await chrome.storage.local.set({ jobs });
  return jobs[index];
}

