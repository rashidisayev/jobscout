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

// ============================================================
// Connection Outreach Storage Helpers
// ============================================================

/**
 * @typedef {Object} ConnectionInvite
 * @property {string} profileUrl
 * @property {string} profileName
 * @property {string} title
 * @property {string} company
 * @property {string} outcome - 'sent' | 'skipped' | 'error'
 * @property {string} reason - reason for skip/error
 * @property {number} timestamp
 */

/**
 * @typedef {Object} OutreachState
 * @property {boolean} enabled
 * @property {number} weeklyCount - invites sent this week
 * @property {number} weekStartTimestamp - start of current week
 * @property {string} status - 'idle' | 'running' | 'paused'
 * @property {number} lastRunTimestamp
 * @property {string[]} sentProfileUrls - URLs already sent invites to
 */

const OUTREACH_KEYS = {
  enabled: 'outreachEnabled',
  weeklyCount: 'outreachWeeklyCount',
  weekStart: 'outreachWeekStart',
  status: 'outreachStatus',
  lastRun: 'outreachLastRun',
  sentProfiles: 'outreachSentProfiles',
  logs: 'outreachLogs',
  nextScheduled: 'outreachNextScheduled'
};

const MAX_WEEKLY_INVITES = 100;
const MAX_LOGS = 500;

/**
 * Get the start of the current week (Monday 00:00:00)
 * @returns {number} timestamp
 */
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when Sunday
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

/**
 * Get outreach state
 * @returns {Promise<OutreachState>}
 */
export async function getOutreachState() {
  const data = await chrome.storage.local.get([
    OUTREACH_KEYS.enabled,
    OUTREACH_KEYS.weeklyCount,
    OUTREACH_KEYS.weekStart,
    OUTREACH_KEYS.status,
    OUTREACH_KEYS.lastRun,
    OUTREACH_KEYS.sentProfiles,
    OUTREACH_KEYS.nextScheduled
  ]);
  
  const currentWeekStart = getWeekStart();
  const storedWeekStart = data[OUTREACH_KEYS.weekStart] || 0;
  
  // Reset weekly count if new week
  let weeklyCount = data[OUTREACH_KEYS.weeklyCount] || 0;
  if (storedWeekStart < currentWeekStart) {
    weeklyCount = 0;
    await chrome.storage.local.set({
      [OUTREACH_KEYS.weeklyCount]: 0,
      [OUTREACH_KEYS.weekStart]: currentWeekStart
    });
  }
  
  return {
    enabled: data[OUTREACH_KEYS.enabled] || false,
    weeklyCount,
    weekStartTimestamp: currentWeekStart,
    status: data[OUTREACH_KEYS.status] || 'idle',
    lastRunTimestamp: data[OUTREACH_KEYS.lastRun] || 0,
    sentProfileUrls: data[OUTREACH_KEYS.sentProfiles] || [],
    nextScheduled: data[OUTREACH_KEYS.nextScheduled] || 0
  };
}

/**
 * Update outreach state
 * @param {Partial<OutreachState>} updates
 */
export async function updateOutreachState(updates) {
  const toSet = {};
  if (updates.enabled !== undefined) toSet[OUTREACH_KEYS.enabled] = updates.enabled;
  if (updates.weeklyCount !== undefined) toSet[OUTREACH_KEYS.weeklyCount] = updates.weeklyCount;
  if (updates.status !== undefined) toSet[OUTREACH_KEYS.status] = updates.status;
  if (updates.lastRunTimestamp !== undefined) toSet[OUTREACH_KEYS.lastRun] = updates.lastRunTimestamp;
  if (updates.sentProfileUrls !== undefined) toSet[OUTREACH_KEYS.sentProfiles] = updates.sentProfileUrls;
  if (updates.nextScheduled !== undefined) toSet[OUTREACH_KEYS.nextScheduled] = updates.nextScheduled;
  
  await chrome.storage.local.set(toSet);
}

/**
 * Check if profile URL was already sent an invite
 * @param {string} profileUrl
 * @returns {Promise<boolean>}
 */
export async function isProfileAlreadySent(profileUrl) {
  const state = await getOutreachState();
  const normalizedUrl = normalizeProfileUrl(profileUrl);
  return state.sentProfileUrls.some(url => normalizeProfileUrl(url) === normalizedUrl);
}

/**
 * Normalize LinkedIn profile URL
 * @param {string} url
 * @returns {string}
 */
function normalizeProfileUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    // Remove trailing slash and query params
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Record a sent invite
 * @param {ConnectionInvite} invite
 */
export async function recordOutreachInvite(invite) {
  const state = await getOutreachState();
  
  // Add to sent profiles list
  const normalizedUrl = normalizeProfileUrl(invite.profileUrl);
  if (!state.sentProfileUrls.includes(normalizedUrl)) {
    state.sentProfileUrls.push(normalizedUrl);
  }
  
  // Increment weekly count if sent
  let newWeeklyCount = state.weeklyCount;
  if (invite.outcome === 'sent') {
    newWeeklyCount = state.weeklyCount + 1;
  }
  
  await updateOutreachState({
    weeklyCount: newWeeklyCount,
    sentProfileUrls: state.sentProfileUrls,
    lastRunTimestamp: Date.now()
  });
  
  // Add to logs
  await addOutreachLog(invite);
}

/**
 * Add an entry to outreach logs
 * @param {ConnectionInvite} entry
 */
export async function addOutreachLog(entry) {
  const { [OUTREACH_KEYS.logs]: logs = [] } = await chrome.storage.local.get([OUTREACH_KEYS.logs]);
  
  const logEntry = {
    ...entry,
    timestamp: entry.timestamp || Date.now()
  };
  
  logs.unshift(logEntry);
  
  // Trim logs to max size
  const trimmedLogs = logs.slice(0, MAX_LOGS);
  
  await chrome.storage.local.set({ [OUTREACH_KEYS.logs]: trimmedLogs });
}

/**
 * Get outreach logs
 * @param {number} limit
 * @returns {Promise<ConnectionInvite[]>}
 */
export async function getOutreachLogs(limit = 100) {
  const { [OUTREACH_KEYS.logs]: logs = [] } = await chrome.storage.local.get([OUTREACH_KEYS.logs]);
  return logs.slice(0, limit);
}

/**
 * Clear outreach logs
 */
export async function clearOutreachLogs() {
  await chrome.storage.local.set({ [OUTREACH_KEYS.logs]: [] });
}

/**
 * Check if we can send more invites this week
 * @returns {Promise<{canSend: boolean, remaining: number}>}
 */
export async function canSendMoreInvites() {
  const state = await getOutreachState();
  const remaining = MAX_WEEKLY_INVITES - state.weeklyCount;
  return {
    canSend: remaining > 0,
    remaining: Math.max(0, remaining)
  };
}

/**
 * Check if job scan is currently running
 * @returns {Promise<boolean>}
 */
export async function isJobScanRunning() {
  const { scanRunStatus } = await chrome.storage.local.get(['scanRunStatus']);
  return scanRunStatus === 'scanning';
}

/**
 * Reset outreach state (for testing/admin)
 */
export async function resetOutreachState() {
  await chrome.storage.local.set({
    [OUTREACH_KEYS.enabled]: false,
    [OUTREACH_KEYS.weeklyCount]: 0,
    [OUTREACH_KEYS.weekStart]: getWeekStart(),
    [OUTREACH_KEYS.status]: 'idle',
    [OUTREACH_KEYS.lastRun]: 0,
    [OUTREACH_KEYS.sentProfiles]: [],
    [OUTREACH_KEYS.logs]: [],
    [OUTREACH_KEYS.nextScheduled]: 0
  });
}