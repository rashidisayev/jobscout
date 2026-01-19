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

/**
 * Archive old jobs to prevent unbounded storage growth
 * @param {number} daysToArchive - Archive jobs older than this many days (default: 90)
 * @returns {Promise<{archived: number, remaining: number}>}
 */
export async function archiveOldJobs(daysToArchive = 90) {
  const { jobs = [], archivedJobs = [] } = await chrome.storage.local.get(['jobs', 'archivedJobs']);
  
  if (jobs.length === 0) {
    return { archived: 0, remaining: 0 };
  }
  
  const cutoffDate = Date.now() - (daysToArchive * 24 * 60 * 60 * 1000);
  const jobsToArchive = [];
  const jobsToKeep = [];
  
  for (const job of jobs) {
    const jobDate = job.foundAt || job.scrapedAt || 0;
    if (jobDate < cutoffDate) {
      jobsToArchive.push(job);
    } else {
      jobsToKeep.push(job);
    }
  }
  
  if (jobsToArchive.length > 0) {
    // Add archived jobs to archive list (limit archive size to prevent growth)
    const updatedArchived = [...archivedJobs, ...jobsToArchive];
    const maxArchived = 1000; // Keep max 1000 archived jobs
    const trimmedArchived = updatedArchived.length > maxArchived
      ? updatedArchived.slice(-maxArchived) // Keep most recent archived
      : updatedArchived;
    
    await chrome.storage.local.set({
      jobs: jobsToKeep,
      archivedJobs: trimmedArchived
    });
    
    console.log(`Archived ${jobsToArchive.length} old jobs (older than ${daysToArchive} days)`);
  }
  
  return {
    archived: jobsToArchive.length,
    remaining: jobsToKeep.length
  };
}/**
 * Get archived jobs
 * @returns {Promise<Job[]>}
 */
export async function getArchivedJobs() {
  const { archivedJobs = [] } = await chrome.storage.local.get(['archivedJobs']);
  return archivedJobs;
}/**
 * Clear archived jobs
 * @returns {Promise<void>}
 */
export async function clearArchivedJobs() {
  await chrome.storage.local.set({ archivedJobs: [] });
}

/**
 * Job Exclusion Management
 * Excluded jobs are marked as "not valid" and will never appear again
 */

/**
 * Generate a unique key for a job (prefer URL, fallback to composite key)
 * @param {Job} job
 * @returns {string}
 */
export function getJobKey(job) {
  // Prefer URL as the most stable unique identifier
  if (job.url) {
    // Normalize URL (remove query params, trailing slashes)
    try {
      const url = new URL(job.url);
      return `url:${url.origin}${url.pathname}`.replace(/\/$/, '');
    } catch (e) {
      // If URL parsing fails, use as-is
      return `url:${job.url}`;
    }
  }
  
  // Fallback: composite key from job attributes
  const company = (job.company || '').toLowerCase().trim();
  const title = (job.title || '').toLowerCase().trim();
  const location = (job.location || '').toLowerCase().trim();
  const datePosted = (job.datePosted || '').toLowerCase().trim();
  
  return `composite:${company}|${title}|${location}|${datePosted}`;
}

/**
 * Get all excluded job keys
 * @returns {Promise<Set<string>>}
 */
export async function getExcludedJobs() {
  const { excludedJobs = [] } = await chrome.storage.local.get(['excludedJobs']);
  return new Set(excludedJobs);
}

/**
 * Check if a job is excluded
 * @param {Job} job
 * @returns {Promise<boolean>}
 */
export async function isJobExcluded(job) {
  const excluded = await getExcludedJobs();
  const jobKey = getJobKey(job);
  return excluded.has(jobKey);
}

/**
 * Add a job to the exclusion list
 * @param {Job} job
 * @returns {Promise<void>}
 */
export async function excludeJob(job) {
  const excluded = await getExcludedJobs();
  const jobKey = getJobKey(job);
  
  excluded.add(jobKey);
  
  // Convert Set to Array for storage
  await chrome.storage.local.set({ excludedJobs: Array.from(excluded) });
  
  console.log(`Excluded job: ${jobKey}`);
}

/**
 * Remove a job from the exclusion list
 * @param {Job} job
 * @returns {Promise<void>}
 */
export async function unexcludeJob(job) {
  const excluded = await getExcludedJobs();
  const jobKey = getJobKey(job);
  
  excluded.delete(jobKey);
  
  await chrome.storage.local.set({ excludedJobs: Array.from(excluded) });
  
  console.log(`Un-excluded job: ${jobKey}`);
}

/**
 * Clear all excluded jobs (dev/admin function)
 * @returns {Promise<number>} Number of excluded jobs that were cleared
 */
export async function clearExcludedJobs() {
  const excluded = await getExcludedJobs();
  const count = excluded.size;
  
  await chrome.storage.local.set({ excludedJobs: [] });
  
  console.log(`Cleared ${count} excluded jobs`);
  return count;
}