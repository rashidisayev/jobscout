// Background service worker for JobScout
// Handles alarms, scanning, and badge updates

// Note: Service Workers don't support dynamic import(), so we use legacy matching
// The new hybrid matching system is available in options.js context where imports work
// For background worker, we use the enhanced legacy matching with better keyword extraction

// Configuration constants (matching scripts/config.js)
const MIN_SCORE_THRESHOLD = 0.05; // 5% minimum match score
const MAX_PAGES_PER_URL = 5;
const MAX_RECENT_JOB_IDS = 2000; // Maximum job IDs to keep in memory

const DEFAULT_SETTINGS = {
  searchUrls: [],
  scanInterval: 60, // minutes
  scanningEnabled: true,
  onlyNewRoles: true,
  lastScanTime: null,
  lastSeenJobIds: []
};

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.local.get(['searchUrls', 'scanInterval', 'scanningEnabled']);
  
  if (!settings.searchUrls) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
  }
  
  // Create alarm with configured interval
  const interval = settings.scanInterval || DEFAULT_SETTINGS.scanInterval;
  chrome.alarms.create('scan', { periodInMinutes: interval });
  console.log(`JobScout installed and alarm set to ${interval} minutes`);
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'scan') {
    const settings = await chrome.storage.local.get(['scanningEnabled', 'isPaused']);
    const isEnabled = settings.scanningEnabled !== false;
    const isPaused = settings.isPaused === true;
    
    if (isEnabled && !isPaused) {
      console.log('Alarm triggered: Starting scheduled scan');
      await performScan();
    } else if (isPaused) {
      console.log('Alarm triggered but scanning is paused, skipping...');
    } else {
      console.log('Alarm triggered but scanning is disabled, skipping...');
    }
  }
});

// Handle manual scan request
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanNow') {
    performScan().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('Scan error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'toggleScanning') {
    chrome.storage.local.get(['scanningEnabled']).then(settings => {
      const newState = !settings.scanningEnabled;
      chrome.storage.local.set({ scanningEnabled: newState });
      sendResponse({ enabled: newState });
    });
    return true;
  } else if (request.action === 'pauseScanning') {
    chrome.storage.local.set({ isPaused: true }).then(() => {
      console.log('Scanning paused by user');
      sendResponse({ success: true, paused: true });
    });
    return true;
  } else if (request.action === 'resumeScanning') {
    chrome.storage.local.set({ isPaused: false }).then(() => {
      console.log('Scanning resumed by user');
      sendResponse({ success: true, paused: false });
    });
    return true;
  } else if (request.action === 'jobResults') {
    handleJobResults(request.jobs, { forceRescan: request.forceRescan }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'getRunState') {
    chrome.storage.local.get([
      'scanRunStatus',
      'scanPagesProcessed',
      'scanJobsScanned',
      'scanNewJobs',
      'scanCurrentUrl',
      'scanCurrentPage'
    ]).then(state => {
      sendResponse({
        scanRunStatus: state.scanRunStatus || 'idle',
        scanPagesProcessed: state.scanPagesProcessed || 0,
        scanJobsScanned: state.scanJobsScanned || 0,
        scanNewJobs: state.scanNewJobs || 0,
        scanCurrentUrl: state.scanCurrentUrl || '',
        scanCurrentPage: state.scanCurrentPage || 0
      });
    });
    return true;
  } else if (request.action === 'extractJobDescription') {
    // Extract job description from a loaded tab
    extractJobDescriptionFromTab(request.jobUrl).then(result => {
      sendResponse(result);
    }).catch(error => {
      console.error('Error extracting job description:', error);
      sendResponse({ descriptionHtml: '', extractors: null, error: error.message });
    });
    return true;
  } else if (request.action === 'getOutreachState') {
    getOutreachState().then(state => sendResponse(state));
    return true;
  } else if (request.action === 'setOutreachEnabled') {
    (async () => {
      await updateOutreachState({ enabled: request.enabled });
      if (request.enabled) {
        await scheduleOutreachRun();
      } else {
        chrome.alarms.clear('outreach');
      }
      sendResponse({ success: true, enabled: request.enabled });
    })();
    return true;
  } else if (request.action === 'runOutreachNow') {
    performOutreachRun(true).then(result => sendResponse(result)); // forceRun=true for manual trigger
    return true;
  } else if (request.action === 'getOutreachLogs') {
    chrome.storage.local.get(['outreachLogs']).then(({ outreachLogs = [] }) => {
      sendResponse({ logs: outreachLogs.slice(0, request.limit || 100) });
    });
    return true;
  } else if (request.action === 'clearOutreachLogs') {
    chrome.storage.local.set({ outreachLogs: [] }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'resetOutreachState') {
    (async () => {
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diff));
      monday.setHours(0, 0, 0, 0);
      
      await chrome.storage.local.set({
        outreachEnabled: false,
        outreachWeeklyCount: 0,
        outreachWeekStart: monday.getTime(),
        outreachStatus: 'idle',
        outreachLastRun: 0,
        outreachSentProfiles: [],
        outreachLogs: [],
        outreachNextScheduled: 0
      });
      chrome.alarms.clear('outreach');
      sendResponse({ success: true });
    })();
    return true;
  }
});

// Helper functions for run state management (replacing storage.js imports)
async function resetRunState() {
  await chrome.storage.local.set({
    scanRunStatus: 'idle',
    scanPagesProcessed: 0,
    scanJobsScanned: 0,
    scanNewJobs: 0,
    scanCurrentUrl: '',
    scanCurrentPage: 0
  });
}

async function updateRunState(updates) {
  const stateUpdates = {};
  const keyMap = {
    status: 'scanRunStatus',
    pagesProcessed: 'scanPagesProcessed',
    jobsScanned: 'scanJobsScanned',
    newJobs: 'scanNewJobs',
    currentUrl: 'scanCurrentUrl',
    currentPage: 'scanCurrentPage'
  };
  
  for (const [key, value] of Object.entries(updates)) {
    if (keyMap[key]) {
      stateUpdates[keyMap[key]] = value;
    }
  }
  await chrome.storage.local.set(stateUpdates);
}

// Detect job source from URL
function detectJobSource(url) {
  if (!url) return { source: 'unknown', sourceType: 'unknown' };
  
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('linkedin.com')) {
    return { source: 'LinkedIn', sourceType: 'linkedin.com' };
  }
  
  if (urlLower.includes('arbeitsagentur.de')) {
    return { source: 'Agentur für Arbeit', sourceType: 'arbeitsagentur.de' };
  }
  
  // Add more sources here as needed
  return { source: 'Other', sourceType: new URL(url).hostname };
}

// Get content script file for a source
function getContentScriptForSource(sourceType) {
  switch (sourceType) {
    case 'linkedin.com':
      return 'content.js';
    case 'arbeitsagentur.de':
      return 'arbeitsagenturContent.js';
    default:
      return null;
  }
}

// Perform scan of all configured search URLs with pagination
async function performScan() {
  const settings = await chrome.storage.local.get([
    'searchUrls',
    'onlyNewRoles',
    'lastSeenJobIds'
  ]);
  
  if (!settings.searchUrls || settings.searchUrls.length === 0) {
    console.log('No search URLs configured');
    return;
  }
  
  // Initialize run state
  await resetRunState();
  await updateRunState({
    status: 'scanning',
    pagesProcessed: 0,
    jobsScanned: 0,
    newJobs: 0
  });
  
  const lastSeenIds = settings.lastSeenJobIds || [];
  const allNewJobs = [];
  let totalPagesProcessed = 0;
  let totalJobsScanned = 0;
  
  // We'll create tabs as needed for different sources
  let scanTab = null;
  
  // Helper to normalize search URL items (supports both string and object formats)
  function normalizeSearchUrlItem(item) {
    if (!item) {
      return { url: '', location: '', keyword: '' };
    }
    
    if (typeof item === 'string') {
      return { url: item, location: '', keyword: '' };
    }
    
    const {
      url = '',
      location = '',
      keyword = ''
    } = item;
    
    return {
      url,
      location: location || '',
      keyword: keyword || ''
    };
  }
  
  // Process each search URL
  for (let searchIndex = 0; searchIndex < settings.searchUrls.length; searchIndex++) {
    // Check for pause before processing each search URL
    const { isPaused = false } = await chrome.storage.local.get(['isPaused']);
    if (isPaused) {
      console.log('Scan paused by user, stopping scan loop...');
      await updateRunState({ status: 'idle' });
      return;
    }
    
    const searchUrlItem = settings.searchUrls[searchIndex];
    const normalizedSearch = normalizeSearchUrlItem(searchUrlItem);
    const searchUrl = normalizedSearch.url;
    const searchLocationLabel = normalizedSearch.location;
    const searchKeywordLabel = normalizedSearch.keyword;
    
    try {
      if (!searchUrl) continue; // Skip invalid entries
      
      // Detect source from URL
      const { source: jobSource, sourceType } = detectJobSource(searchUrl);
      console.log(`Scanning ${sourceType} URL: ${searchUrl}`);
      
      await updateRunState({
        currentUrl: searchUrl,
        currentPage: 0
      });
      
      // Create or reuse tab for this source
      if (!scanTab) {
        scanTab = await chrome.tabs.create({
          url: searchUrl,
          active: false
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Process up to MAX_PAGES_PER_URL pages
      // Different pagination for different sources
      const pageStarts = sourceType === 'arbeitsagentur.de' 
        ? Array.from({ length: MAX_PAGES_PER_URL }, (_, i) => i) // Page numbers for arbeitsagentur
        : Array.from({ length: MAX_PAGES_PER_URL }, (_, i) => i * 25); // Offset for LinkedIn
      
      for (let pageIndex = 0; pageIndex < pageStarts.length; pageIndex++) {
        // Check for pause before processing each page
        const { isPaused = false } = await chrome.storage.local.get(['isPaused']);
        if (isPaused) {
          console.log('Scan paused by user during page iteration, stopping...');
          await updateRunState({ status: 'idle' });
          return;
        }
        
        const start = pageStarts[pageIndex];
        const pageUrl = addStartParameter(searchUrl, start, sourceType);
        
        await updateRunState({
          currentPage: pageIndex + 1
        });
        
        // Navigate to page
        await chrome.tabs.update(scanTab.id, { url: pageUrl });
        
        // Wait for tab to finish loading - different URL patterns for different sources
        await new Promise((resolve) => {
          const checkTab = async () => {
            try {
              const tab = await chrome.tabs.get(scanTab.id);
              const isCorrectPage = 
                (sourceType === 'linkedin.com' && tab.url?.includes('linkedin.com/jobs')) ||
                (sourceType === 'arbeitsagentur.de' && tab.url?.includes('arbeitsagentur.de')) ||
                tab.status === 'complete';
              
              if (tab.status === 'complete' && isCorrectPage) {
                resolve();
              } else {
                setTimeout(checkTab, 500);
              }
            } catch (error) {
              // Tab might have been closed, wait a bit and resolve
              setTimeout(resolve, 2000);
            }
          };
          checkTab();
        });
        
        // Wait longer for page to fully load, especially for first page
        const waitTime = pageIndex === 0 ? randomDelay(5000, 7000) : randomDelay(4000, 6000);
        await sleep(waitTime);
        
        // Try to inject the content script if not auto-injected
        const contentScript = getContentScriptForSource(sourceType);
        if (contentScript) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: scanTab.id },
              files: [contentScript]
            });
          } catch (e) {
            // Script may already be injected
          }
          await sleep(1000);
        }
        
        // Retry mechanism for sending message
        try {
          let results = null;
          let retries = 5;
          while (retries > 0 && !results) {
            try {
              results = await chrome.tabs.sendMessage(scanTab.id, {
                action: 'scrapeJobs',
                onlyNew: settings.onlyNewRoles,
                lastSeenIds: lastSeenIds,
                pageIndex: pageIndex,
                searchLocationLabel,
                searchKeywordLabel
              });
            } catch (msgError) {
              retries--;
              if (retries > 0) {
                console.log(`Message send failed (page ${pageIndex + 1}), retrying... (${retries} retries left)`);
                // Wait longer between retries
                await sleep(3000);
              } else {
                console.error(`Failed to send message after all retries for page ${pageIndex + 1}:`, msgError);
                throw msgError;
              }
            }
          }
          
          if (results && results.jobs) {
            // Add source information to each job
            const pageJobs = results.jobs.map(job => ({
              ...job,
              source: job.source || jobSource,
              sourceType: job.sourceType || sourceType
            }));
            
            totalJobsScanned += pageJobs.length;
            allNewJobs.push(...pageJobs);
            
            // Update seen IDs for deduplication
            for (const job of pageJobs) {
              if (job.id) {
                lastSeenIds.push(job.id);
              }
            }
            
            // Update run state
            await updateRunState({
              pagesProcessed: totalPagesProcessed + 1,
              jobsScanned: totalJobsScanned
            });
            totalPagesProcessed++;
            
            // If we got fewer jobs than expected, might be last page
            if (pageJobs.length < 10) {
              console.log(`Page ${pageIndex + 1} returned ${pageJobs.length} jobs, stopping pagination`);
              break;
            }
          }
        } catch (error) {
          console.error(`Error scraping page ${pageIndex + 1} of ${searchUrl}:`, error);
          // Continue to next page
        }
        
        // Random delay between pages
        await sleep(randomDelay(1500, 3000));
      }
      
      // Random delay between search URLs
      await sleep(randomDelay(2000, 4000));
    } catch (error) {
      console.error(`Error scanning ${searchUrl}:`, error);
    }
  }
  
  // Process and store results
  let newJobsCount = 0;
  if (allNewJobs.length > 0) {
    newJobsCount = await handleJobResults(allNewJobs);
    
    // Update run state with new jobs count during scan
    await updateRunState({
      newJobs: newJobsCount
    });
    await updateBadge(); // Update badge with new count
  }
  
  // Update run state to idle
  await updateRunState({
    status: 'idle'
  });
  
  // Update last scan time
  await chrome.storage.local.set({ lastScanTime: Date.now() });
  
  // Archive old jobs periodically (every 10 scans or so)
  // Use a simple counter to avoid archiving on every scan
  const { archiveCounter = 0 } = await chrome.storage.local.get(['archiveCounter']);
  if (archiveCounter >= 10) {
    // Archive jobs older than 90 days (using config constant)
    const ARCHIVAL_DAYS = 90;
    const { jobs = [] } = await chrome.storage.local.get(['jobs']);
    const cutoffDate = Date.now() - (ARCHIVAL_DAYS * 24 * 60 * 60 * 1000);
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
      const { archivedJobs = [] } = await chrome.storage.local.get(['archivedJobs']);
      const updatedArchived = [...archivedJobs, ...jobsToArchive];
      const maxArchived = 1000;
      const trimmedArchived = updatedArchived.length > maxArchived
        ? updatedArchived.slice(-maxArchived)
        : updatedArchived;
      
      await chrome.storage.local.set({
        jobs: jobsToKeep,
        archivedJobs: trimmedArchived,
        archiveCounter: 0 // Reset counter
      });
      
      console.log(`Archived ${jobsToArchive.length} old jobs`);
    } else {
      await chrome.storage.local.set({ archiveCounter: 0 });
    }
  } else {
    await chrome.storage.local.set({ archiveCounter: archiveCounter + 1 });
  }
  
  // Update badge
  await updateBadge();
}

// Add start parameter to LinkedIn search URL
function addStartParameter(url, start, sourceType = 'linkedin.com') {
  try {
    const urlObj = new URL(url);
    
    // Different pagination parameters for different sources
    if (sourceType === 'arbeitsagentur.de') {
      // Agentur für Arbeit uses 'page' parameter (1-indexed)
      if (start > 0) {
        urlObj.searchParams.set('page', (start + 1).toString());
      }
    } else {
      // LinkedIn uses 'start' parameter (offset)
      urlObj.searchParams.set('start', start.toString());
    }
    
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, append parameter manually
    const param = sourceType === 'arbeitsagentur.de' ? 'page' : 'start';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${param}=${start}`;
  }
}

// Handle job results: deduplicate, merge, match with resumes, store
// Returns count of new jobs added
async function handleJobResults(jobs = [], options = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return 0;
  }
  
  // Filter out excluded jobs early (before any processing)
  // NOTE: MV3 service worker cannot use dynamic import().
  // We keep the exclusion logic here using storage + a local getJobKey helper.
  const { excludedJobs = [] } = await chrome.storage.local.get(['excludedJobs']);
  const excludedJobKeys = new Set(excludedJobs);

  function getJobKey(job) {
    // Prefer URL as the most stable unique identifier
    const urlStr = job?.url || job?.link;
    if (urlStr) {
      try {
        const url = new URL(urlStr);
        return `url:${url.origin}${url.pathname}`.replace(/\/$/, '');
      } catch (e) {
        return `url:${urlStr}`;
      }
    }

    // Fallback: composite key from job attributes
    const company = String(job?.company || '').toLowerCase().trim();
    const title = String(job?.title || '').toLowerCase().trim();
    const location = String(job?.location || '').toLowerCase().trim();
    const datePosted = String(job?.datePosted || '').toLowerCase().trim();
    return `composite:${company}|${title}|${location}|${datePosted}`;
  }
  
  const filteredJobs = jobs.filter(job => {
    if (!job) return false;
    const jobKey = getJobKey(job);
    const isExcluded = excludedJobKeys.has(jobKey);
    if (isExcluded) {
      console.log(`Filtering out excluded job: ${job.title || 'Unknown'} (${jobKey})`);
    }
    return !isExcluded;
  });
  
  if (filteredJobs.length === 0) {
    console.log('All jobs were excluded, no jobs to process');
    return 0;
  }
  
  console.log(`Processing ${filteredJobs.length} jobs (${jobs.length - filteredJobs.length} excluded)`);
  
  const { forceRescan = false } = options;
  const existing = await chrome.storage.local.get(['jobs', 'lastSeenJobIds', 'resumes']);
  const existingJobs = existing.jobs || [];
  const lastSeenSet = new Set(existing.lastSeenJobIds || []);
  const resumes = existing.resumes || [];
  const validResumes = resumes.filter(r => r && r.filename && r.text && r.text.trim().length >= 10);
  
  const idToIndex = new Map();
  existingJobs.forEach((job, index) => {
    const jobUrl = job?.url || job?.link;
    const jobId = job?.id || (jobUrl ? hashJobUrl(jobUrl) : null);
    if (jobId) {
      idToIndex.set(jobId, index);
      job.id = jobId;
    }
  });
  
  const mergedJobs = existingJobs.slice();
  let newJobsCount = 0;
  
  for (const incoming of filteredJobs) {
    if (!incoming) continue;
    
    const jobUrl = incoming.url || incoming.link;
    if (!jobUrl) continue;
    
    const jobId = incoming.id || hashJobUrl(jobUrl);
    const incomingForceRescan = Boolean(incoming.forceRescan);
    const scrapedAt = incoming.scrapedAt || Date.now();
    const incomingRecord = {
      ...incoming,
      id: jobId,
      url: jobUrl,
      link: jobUrl,
      scrapedAt,
      foundAt: incoming.foundAt || scrapedAt,
      needsFetch: incoming.needsFetch ?? !incoming.descriptionHtml
    };
    delete incomingRecord.forceRescan;
    
    if (!idToIndex.has(jobId)) {
      const enriched = await enrichJobMatchData(incomingRecord, validResumes);
      
      // Filter out jobs with very low scores (below threshold)
      if (validResumes.length > 0 && enriched.matchScore < MIN_SCORE_THRESHOLD) {
        console.log(`Excluding job "${enriched.title}" - score ${enriched.matchScore.toFixed(4)} below threshold ${MIN_SCORE_THRESHOLD}`);
        // Mark as excluded but don't add to jobs list
        enriched.excluded = true;
        enriched.exclusionReason = 'Score too low';
        // Still count it but mark as excluded
        continue;
      }
      
      mergedJobs.push(enriched);
      idToIndex.set(jobId, mergedJobs.length - 1);
      lastSeenSet.add(jobId);
      newJobsCount++;
      continue;
    }
    
    const existingIndex = idToIndex.get(jobId);
    const existingJob = mergedJobs[existingIndex];
    const forceMatch = forceRescan || incomingForceRescan;
    const mergedRecord = mergeJobRecords(existingJob, incomingRecord, {
      forceRescan: forceMatch
    });
    
    const descriptionUpdated = !!mergedRecord.descriptionHtml &&
      mergedRecord.descriptionHtml !== (existingJob.descriptionHtml || '');
    const shouldRecalculate = (descriptionUpdated || forceMatch) && validResumes.length > 0;
    
    if (shouldRecalculate) {
      const updated = await enrichJobMatchData(mergedRecord, validResumes);
      
      // Filter out jobs with very low scores (below threshold)
      if (validResumes.length > 0 && updated.matchScore < MIN_SCORE_THRESHOLD) {
        console.log(`Excluding existing job "${updated.title}" - score ${updated.matchScore.toFixed(4)} below threshold ${MIN_SCORE_THRESHOLD}`);
        // Mark as excluded and remove from list
        updated.excluded = true;
        updated.exclusionReason = 'Score too low';
        mergedJobs.splice(existingIndex, 1);
        // Rebuild idToIndex after removal
        idToIndex.clear();
        mergedJobs.forEach((job, idx) => {
          const jId = job?.id || (job?.url ? hashJobUrl(job.url) : null);
          if (jId) idToIndex.set(jId, idx);
        });
        continue;
      }
      
      mergedJobs[existingIndex] = updated;
    } else {
      mergedJobs[existingIndex] = mergedRecord;
    }
  }
  
  // Clean up: Remove any existing jobs that are now excluded (score too low)
  const cleanedJobs = mergedJobs.filter(job => {
    // Remove jobs marked as excluded
    if (job.excluded) {
      return false;
    }
    // Remove jobs with 0% score that have been matched (have bestResume field)
    const score = job.matchScore ?? job.score ?? 0;
    if (score === 0 && 'bestResume' in job && validResumes.length > 0) {
      console.log(`Removing existing job "${job.title}" - 0% score`);
      return false;
    }
    return true;
  });
  
  // Limit lastSeenJobIds size to prevent unbounded growth
  const lastSeenArray = Array.from(lastSeenSet);
  const trimmedLastSeen = lastSeenArray.length > MAX_RECENT_JOB_IDS
    ? lastSeenArray.slice(-MAX_RECENT_JOB_IDS) // Keep most recent
    : lastSeenArray;
  
  await chrome.storage.local.set({
    jobs: cleanedJobs,
    lastSeenJobIds: trimmedLastSeen
  });
  
  await updateBadge();
  return newJobsCount;
}

async function enrichJobMatchData(job, resumes) {
  const enrichedJob = { ...job };
  
  // Validate resumes
  if (!resumes || resumes.length === 0) {
    console.log('No resumes provided for matching');
    enrichedJob.bestResume = null;
    enrichedJob.matchScore = 0;
    enrichedJob.topKeywords = [];
    enrichedJob.score = 0;
    enrichedJob.matches = [];
    enrichedJob.bestMatch = null;
    return enrichedJob;
  }
  
  // Filter valid resumes
  const validResumes = resumes.filter(r => {
    const isValid = r && r.filename && r.text && r.text.trim().length >= 10;
    if (!isValid) {
      console.log('Invalid resume:', r ? r.filename : 'null');
    }
    return isValid;
  });
  
  if (validResumes.length === 0) {
    console.log('No valid resumes found after filtering');
    enrichedJob.bestResume = null;
    enrichedJob.matchScore = 0;
    enrichedJob.topKeywords = [];
    enrichedJob.score = 0;
    enrichedJob.matches = [];
    enrichedJob.bestMatch = null;
    return enrichedJob;
  }
  
  console.log(`Matching job "${job.title}" against ${validResumes.length} resume(s)`);
  
  // Service Workers don't support dynamic import(), so we use enhanced legacy matching
  // The hybrid matching system is available in options.js where imports work
  return await enrichJobMatchDataLegacy(job, validResumes);
}

// Enhanced legacy matching function (used in service worker since dynamic imports don't work)
async function enrichJobMatchDataLegacy(job, resumes) {
  const enrichedJob = { ...job };
  const textToMatch = getTextForMatching(job);
  const jobTitle = job.title || '';
  
  if (!textToMatch || textToMatch.trim().length < 10) {
    console.log('Job description too short for matching');
    enrichedJob.bestResume = null;
    enrichedJob.matchScore = 0;
    enrichedJob.topKeywords = [];
    enrichedJob.score = 0;
    enrichedJob.matches = [];
    enrichedJob.bestMatch = null;
    // Mark as excluded if we have resumes but description is too short
    if (resumes.length > 0) {
      enrichedJob.excluded = true;
      enrichedJob.exclusionReason = 'Description too short';
    }
    return enrichedJob;
  }
  
  const match = await matchResumeToJob(textToMatch, resumes, jobTitle);
  
  // If no match found (score below threshold), mark as excluded
  if (!match.filename && resumes.length > 0) {
    enrichedJob.bestResume = null;
    enrichedJob.matchScore = 0;
    enrichedJob.topKeywords = [];
    enrichedJob.score = 0;
    enrichedJob.matches = [];
    enrichedJob.bestMatch = null;
    enrichedJob.excluded = true;
    enrichedJob.exclusionReason = 'Score below threshold';
    console.log(`Job "${job.title}" excluded - no match found or score too low`);
    return enrichedJob;
  }
  
  // Create match structure compatible with new system
  const bestMatch = match.filename ? {
    cvId: `cv-${match.filename}`,
    cvName: match.filename,
    score: match.score || 0,
    explanation: {
      matchedKeywords: match.topKeywords || [],
      missingMustHaves: [],
      topSentences: []
    }
  } : null;
  
  enrichedJob.bestResume = match.filename || null;
  enrichedJob.matchScore = match.score !== undefined && match.score !== null ? match.score : 0;
  enrichedJob.topKeywords = match.topKeywords || [];
  enrichedJob.score = enrichedJob.matchScore;
  enrichedJob.matches = bestMatch ? [bestMatch] : [];
  enrichedJob.bestMatch = bestMatch;
  enrichedJob.excluded = false; // Explicitly mark as not excluded
  
  console.log(`Legacy matching result: ${match.filename || 'none'} with score ${enrichedJob.matchScore.toFixed(3)}`);
  
  return enrichedJob;
}

// Note: CV parsing and embedding functions removed since dynamic imports don't work in service workers
// These are available in options.js context where they can be used for enhanced matching

function mergeJobRecords(existingJob, incomingJob, { forceRescan = false } = {}) {
  const merged = { ...existingJob };
  for (const [key, value] of Object.entries(incomingJob)) {
    if (value === undefined) continue;
    merged[key] = value;
  }
  merged.foundAt = existingJob.foundAt || incomingJob.foundAt || Date.now();
  merged.scrapedAt = incomingJob.scrapedAt || existingJob.scrapedAt || Date.now();
  
  if (incomingJob.descriptionHtml) {
    merged.descriptionHtml = incomingJob.descriptionHtml;
    merged.needsFetch = false;
  } else if (!forceRescan) {
    merged.descriptionHtml = existingJob.descriptionHtml || '';
    if (existingJob.needsFetch === false) {
      merged.needsFetch = false;
    } else {
      merged.needsFetch = true;
    }
  } else {
    merged.needsFetch = true;
  }
  
  return merged;
}

// NLP functions (inlined from nlp.js to avoid dynamic imports)
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'the', 'this', 'but', 'they', 'have',
  'had', 'what', 'said', 'each', 'which', 'their', 'time', 'if',
  'up', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her',
  'would', 'make', 'like', 'into', 'him', 'has', 'two', 'more', 'very',
  'after', 'words', 'long', 'than', 'first', 'been', 'call', 'who',
  'oil', 'sit', 'now', 'find', 'down', 'day', 'did', 'get', 'come',
  'made', 'may', 'part'
]);

// Enhanced tokenization with better handling of technical terms
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s#+.-]/g, ' ') // Keep some special chars for tech terms (e.g., C++, .NET)
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word))
    .map(word => word.replace(/^[#+.-]+|[#+.-]+$/g, '')) // Clean up special chars at edges
    .filter(word => word.length > 2); // Filter again after cleaning
}

// Enhanced keyword extraction with synonym support
const TECHNICAL_SYNONYMS_LEGACY = {
  'javascript': ['js', 'ecmascript', 'nodejs', 'node.js'],
  'typescript': ['ts'],
  'react': ['reactjs', 'react.js'],
  'angular': ['angularjs', 'angular.js'],
  'vue': ['vuejs', 'vue.js'],
  'python': ['py'],
  'machine learning': ['ml', 'ai', 'artificial intelligence'],
  'data science': ['data analytics', 'data analysis'],
  'devops': ['dev ops', 'sre', 'site reliability'],
  'kubernetes': ['k8s'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  'microsoft azure': ['azure']
};

// Extract important keywords (skills, technologies, tools)
function extractImportantKeywords(text) {
  if (!text) return new Set();
  
  const keywords = new Set();
  const lowerText = text.toLowerCase();
  
  // Enhanced technical terms and patterns
  const techPatterns = [
    // Programming languages
    /\b(java|python|javascript|typescript|go|rust|c\+\+|c#|php|ruby|swift|kotlin|scala|r|matlab|perl|shell|bash|powershell)\b/gi,
    // Frameworks and libraries
    /\b(react|angular|vue|node|express|django|flask|spring|laravel|rails|asp\.net|\.net|jquery|bootstrap|tailwind)\b/gi,
    // Databases
    /\b(mysql|postgresql|mongodb|cassandra|redis|elasticsearch|oracle|sql|nosql|dynamodb|firebase)\b/gi,
    // Cloud and DevOps
    /\b(aws|azure|gcp|docker|kubernetes|jenkins|gitlab|github|terraform|ansible|chef|puppet|ci\/cd)\b/gi,
    // Tools and platforms
    /\b(git|svn|jira|confluence|slack|agile|scrum|kanban|devops|microservices|api|rest|graphql|soap)\b/gi,
    // Data and ML
    /\b(machine learning|ml|ai|artificial intelligence|data science|big data|hadoop|spark|tensorflow|pytorch|pandas|numpy)\b/gi,
    // Other important terms
    /\b(frontend|backend|fullstack|full stack|web development|mobile development|ios|android|linux|windows|macos)\b/gi
  ];
  
  // Extract matches from patterns
  for (const pattern of techPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const cleaned = match.toLowerCase().trim();
        if (cleaned.length > 2) {
          keywords.add(cleaned);
          // Add synonyms
          for (const [key, synonyms] of Object.entries(TECHNICAL_SYNONYMS_LEGACY)) {
            if (cleaned === key || synonyms.includes(cleaned)) {
              keywords.add(key);
              synonyms.forEach(syn => keywords.add(syn));
            }
          }
        }
      });
    }
  }
  
  // Also add capitalized words (often proper nouns, technologies, or company names)
  const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  if (capitalizedWords) {
    capitalizedWords.forEach(word => {
      const cleaned = word.toLowerCase().trim();
      if (cleaned.length > 3 && !STOPWORDS.has(cleaned)) {
        keywords.add(cleaned);
      }
    });
  }
  
  return keywords;
}

function calculateTF(tokens) {
  const tf = {};
  const totalTerms = tokens.length;
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  for (const term in tf) {
    tf[term] = tf[term] / totalTerms;
  }
  return tf;
}

function calculateIDF(documents) {
  const idf = {};
  const totalDocs = documents.length;
  
  // Count how many documents contain each term
  for (const doc of documents) {
    const uniqueTerms = new Set(doc);
    for (const term of uniqueTerms) {
      idf[term] = (idf[term] || 0) + 1;
    }
  }
  
  // Enhanced IDF calculation with better smoothing
  // Standard formula: idf(t) = log((N + 1) / (df(t) + 0.5))
  // Using 0.5 instead of 1 for better differentiation
  for (const term in idf) {
    const docFreq = idf[term];
    // Improved smoothing for better term discrimination
    idf[term] = Math.log((totalDocs + 1) / (docFreq + 0.5));
    
    // Boost important keywords in IDF
    // (We'll check this in extractImportantKeywords context)
    
    // Ensure minimum IDF value to prevent zero weights
    if (idf[term] <= 0) {
      idf[term] = 0.1; // Small positive value for common terms
    }
  }
  
  return idf;
}

function calculateTFIDF(tokens, idf, importantKeywords = new Set()) {
  const tf = calculateTF(tokens);
  const tfidf = {};
  
  // Enhanced weighting for important keywords
  const IMPORTANT_KEYWORD_WEIGHT = 2.5; // Increased from 2.0
  
  for (const term in tf) {
    let weight = 1.0;
    
    // Boost important keywords (skills, technologies, etc.)
    if (importantKeywords.has(term)) {
      weight = IMPORTANT_KEYWORD_WEIGHT;
    }
    
    // Also boost multi-word technical terms and longer terms
    if (term.includes('-') || term.includes('_') || term.length > 8) {
      weight *= 1.4; // Increased from 1.3
    }
    
    // Boost terms that appear in both documents (stronger signal)
    const idfValue = idf[term] || 0;
    if (idfValue > 0.5) { // Terms that are somewhat rare
      weight *= 1.2;
    }
    
    tfidf[term] = tf[term] * idfValue * weight;
  }
  
  return tfidf;
}

function calculateCosineSimilarity(vec1, vec2) {
  const allTerms = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (const term of allTerms) {
    const val1 = vec1[term] || 0;
    const val2 = vec2[term] || 0;
    dotProduct += val1 * val2;
    norm1 += val1 * val1;
    norm2 += val2 * val2;
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// Enhanced cosine similarity with keyword weighting
function cosineSimilarity(jobDescription, resumeText, jobTitle = '') {
  if (!jobDescription || !resumeText) {
    console.log('Missing text for similarity:', { 
      hasJobDesc: !!jobDescription, 
      hasResume: !!resumeText 
    });
    return 0;
  }
  
  const jobTokens = tokenize(jobDescription);
  const resumeTokens = tokenize(resumeText);
  
  if (jobTokens.length === 0 || resumeTokens.length === 0) {
    console.log('Empty tokens after tokenization:', {
      jobTokensCount: jobTokens.length,
      resumeTokensCount: resumeTokens.length,
      jobDescSample: jobDescription.substring(0, 100),
      resumeSample: resumeText.substring(0, 100)
    });
    return 0;
  }
  
  // Extract important keywords from both documents
  const jobKeywords = extractImportantKeywords(jobDescription);
  const resumeKeywords = extractImportantKeywords(resumeText);
  const allImportantKeywords = new Set([...jobKeywords, ...resumeKeywords]);
  
  // Calculate IDF with smoothing
  const idf = calculateIDF([jobTokens, resumeTokens]);
  const jobTFIDF = calculateTFIDF(jobTokens, idf, allImportantKeywords);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf, allImportantKeywords);
  
  // Calculate base cosine similarity
  let similarity = calculateCosineSimilarity(jobTFIDF, resumeTFIDF);
  
  // Enhanced bonus for matching important keywords
  const matchingKeywords = [...jobKeywords].filter(kw => resumeKeywords.has(kw));
  if (matchingKeywords.length > 0) {
    // Improved bonus calculation: logarithmic scaling for better distribution
    const keywordBonus = Math.min(0.18, Math.log(matchingKeywords.length + 1) * 0.04); // Max 18% bonus
    similarity += keywordBonus;
  }
  
  // Title matching bonus (if job title matches resume content)
  if (jobTitle) {
    const titleTokens = tokenize(jobTitle);
    const titleKeywords = extractImportantKeywords(jobTitle);
    const titleMatchesResume = titleTokens.some(token => resumeTokens.includes(token)) ||
                               [...titleKeywords].some(kw => resumeKeywords.has(kw));
    
    if (titleMatchesResume) {
      similarity += 0.06; // Increased to 6% bonus for title match
    }
  }
  
  // Apply calibration for better score distribution
  let normalizedSimilarity = Math.max(0, Math.min(1, similarity));
  
  // Slight boost for mid-range scores (0.3-0.7) to better differentiate
  if (normalizedSimilarity >= 0.3 && normalizedSimilarity <= 0.7) {
    normalizedSimilarity = normalizedSimilarity * 1.05;
    normalizedSimilarity = Math.min(1, normalizedSimilarity);
  }
  
  return normalizedSimilarity;
}

function getTopMatchingKeywords(jobDescription, resumeText, topN = 10) {
  const jobTokens = tokenize(jobDescription);
  const resumeTokens = tokenize(resumeText);
  if (jobTokens.length === 0 || resumeTokens.length === 0) {
    return [];
  }
  
  // Extract important keywords for weighting
  const jobKeywords = extractImportantKeywords(jobDescription);
  const resumeKeywords = extractImportantKeywords(resumeText);
  const allImportantKeywords = new Set([...jobKeywords, ...resumeKeywords]);
  
  const idf = calculateIDF([jobTokens, resumeTokens]);
  const jobTFIDF = calculateTFIDF(jobTokens, idf, allImportantKeywords);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf, allImportantKeywords);
  
  // Prioritize important keywords in the results
  const commonTerms = new Set(
    Object.keys(jobTFIDF).filter(term => resumeTFIDF[term])
  );
  
  const termScores = [];
  for (const term of commonTerms) {
    let score = jobTFIDF[term] * resumeTFIDF[term];
    
    // Boost important keywords in ranking
    if (allImportantKeywords.has(term)) {
      score *= 1.5;
    }
    
    termScores.push({ term, score });
  }
  
  termScores.sort((a, b) => b.score - a.score);
  return termScores.slice(0, topN).map(item => item.term);
}

// Check if job should be excluded based on exclusion filters
function shouldExcludeJob(jobTitle, jobDescription) {
  if (!jobTitle && !jobDescription) return false;
  
  const text = `${jobTitle || ''} ${jobDescription || ''}`.toLowerCase();
  
  // Exclusion patterns for clearly irrelevant jobs
  const exclusionPatterns = [
    // Different career levels
    /\b(intern|internship|entry level|junior|jr\.|graduate|student|trainee|apprentice)\b/i,
    // Different job types
    /\b(part time|contractor|freelance|consultant|volunteer|temporary)\b/i,
    // Different industries (add more as needed)
    /\b(real estate|sales representative|retail|cashier|waiter|server|bartender|driver|delivery|warehouse|factory|manufacturing|construction|plumber|electrician|mechanic)\b/i,
    // Different skills (if job requires skills not in resume, but this is handled by score)
    // We'll keep this minimal to avoid false positives
  ];
  
  // Only exclude if multiple exclusion patterns match (to avoid false positives)
  let exclusionCount = 0;
  for (const pattern of exclusionPatterns) {
    if (pattern.test(text)) {
      exclusionCount++;
    }
  }
  
  // Exclude if 2+ exclusion patterns match
  return exclusionCount >= 2;
}

// Match job description with best resume using enhanced NLP
async function matchResumeToJob(jobDescription, resumes, jobTitle = '') {
  console.log(`matchResumeToJob called with ${resumes?.length || 0} resumes`);
  
  let bestMatch = { filename: null, score: 0, topKeywords: [] };
  
  if (!jobDescription || jobDescription.trim().length < 10) {
    console.log('Job description too short for matching');
    return bestMatch;
  }
  
  if (!resumes || resumes.length === 0) {
    console.log('No resumes provided to matchResumeToJob');
    return bestMatch;
  }
  
  // Check exclusion filters
  if (shouldExcludeJob(jobTitle, jobDescription)) {
    console.log('Job excluded by filters:', jobTitle);
    return bestMatch;
  }
  
  // Track if we found any valid resume
  let hasValidResume = false;
  let resumeCount = 0;
  
  for (const resume of resumes) {
    resumeCount++;
    
    if (!resume) {
      console.log(`Resume ${resumeCount} is null/undefined`);
      continue;
    }
    
    if (!resume.filename) {
      console.log(`Resume ${resumeCount} missing filename:`, resume);
      continue;
    }
    
    if (!resume.text) {
      console.log(`Resume ${resume.filename} missing text property`);
      continue;
    }
    
    if (resume.text.trim().length < 10) {
      console.log(`Skipping resume ${resume.filename} - text too short (${resume.text.trim().length} chars)`);
      continue;
    }
    
    hasValidResume = true;
    console.log(`Matching against resume: ${resume.filename} (${resume.text.length} chars)`);
    
    const score = cosineSimilarity(jobDescription, resume.text, jobTitle);
    console.log(`Score for ${resume.filename}: ${score.toFixed(4)}`);
    
    // Always update if this is the first valid resume or if score is better (including equal)
    if (!bestMatch.filename || score >= bestMatch.score) {
      const topKeywords = getTopMatchingKeywords(jobDescription, resume.text, 10);
      bestMatch = {
        filename: resume.filename,
        score: score,
        topKeywords: topKeywords
      };
      console.log(`New best match: ${bestMatch.filename} with score ${bestMatch.score.toFixed(4)}`);
    }
  }
  
  if (!hasValidResume) {
    console.log('No valid resumes found after checking all:', {
      totalResumes: resumes.length,
      resumeDetails: resumes.map(r => ({
        filename: r?.filename || 'missing',
        hasText: !!r?.text,
        textLength: r?.text?.length || 0
      }))
    });
    return bestMatch;
  }
  
  // Minimum score threshold - filter out very low relevance jobs
  if (bestMatch.score < MIN_SCORE_THRESHOLD) {
    if (bestMatch.filename) {
      console.log('Job score below threshold, excluding:', {
        score: bestMatch.score,
        threshold: MIN_SCORE_THRESHOLD,
        jobTitle: jobTitle,
        resume: bestMatch.filename
      });
    }
    // Exclude jobs with very low or zero scores
    return { filename: null, score: 0, topKeywords: [] };
  }
  
  // Log final result
  if (bestMatch.filename) {
    console.log(`Final match result: ${bestMatch.filename} with score ${bestMatch.score.toFixed(4)}`);
  } else {
    console.log('No match found after processing all resumes');
  }
  
  return bestMatch;
}

function getTextForMatching(job) {
  if (!job) return '';
  if (job.descriptionHtml) {
    return job.descriptionHtml.replace(/<[^>]+>/g, ' ');
  }
  if (job.description) {
    return job.description;
  }
  return `${job.title || ''} ${job.company || ''}`.trim();
}

// Update badge with new job count
async function updateBadge() {
  try {
    // Get run state directly from storage (avoiding ES module import issues)
    const runState = await chrome.storage.local.get([
      'scanRunStatus',
      'scanNewJobs'
    ]);
    
    // If scanning, show new jobs from current run
    if (runState.scanRunStatus === 'scanning' && runState.scanNewJobs > 0) {
      chrome.action.setBadgeText({ text: runState.scanNewJobs.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#28a745' }); // Green for active scan
      return;
    }
  } catch (error) {
    console.error('Error getting run state for badge:', error);
    // Continue to fallback logic
  }
  
  // Otherwise show new jobs since last scan
  const settings = await chrome.storage.local.get(['lastScanTime', 'jobs']);
  const lastScanTime = settings.lastScanTime;
  const allJobs = settings.jobs || [];
  
  if (!lastScanTime) {
    chrome.action.setBadgeText({ text: '0' });
    return;
  }
  
  const newJobsCount = allJobs.filter(job => job.foundAt > lastScanTime).length;
  chrome.action.setBadgeText({ text: newJobsCount.toString() });
  chrome.action.setBadgeBackgroundColor({ color: '#0077b5' });
}

// Utility: Sleep for ms milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility: Random delay between min and max
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Utility: Hash job URL to create unique ID
function hashJobUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash | 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString();
}

// Update badge periodically during scan
setInterval(async () => {
  try {
    const runState = await chrome.storage.local.get(['scanRunStatus']);
    if (runState.scanRunStatus === 'scanning') {
      await updateBadge();
    }
  } catch (error) {
    console.error('Error checking scan status for badge update:', error);
  }
}, 2000); // Every 2 seconds during scan

// Initialize badge on startup
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge when extension starts
updateBadge();

// ============================================================
// Connection Outreach Automation
// ============================================================

const OUTREACH_CONFIG = {
  MAX_WEEKLY_INVITES: 100,
  MAX_INVITES_PER_RUN: 25, // Allow up to 25 invites per run (5 pages x ~5 per page)
  MAX_INVITES_PER_PAGE: 5, // Max invites to send on each page
  BUSINESS_HOURS_START: 9,
  BUSINESS_HOURS_END: 18,
  MIN_DELAY_BETWEEN_RUNS_MS: 30 * 60 * 1000, // 30 minutes minimum
  TARGET_TITLES: [
    'VP of Operations', 'Vice President of Operations', 'Director of Operations',
    'Director of Technology', 'Director of Infrastructure', 'Director of Platform',
    'Head of Operations', 'CTO', 'Chief Technology Officer',
    'Data Center Manager', 'Head of Data Center',
    'Recruiter', 'Technical Recruiter', 'Talent Partner'
  ]
};

// Build LinkedIn people search URL
function buildOutreachSearchUrl() {
  // Use a simpler search query - just search for key titles
  // LinkedIn will show various matches; content script filters by exact title match
  const simpleQuery = 'Director Operations OR VP Operations OR CTO OR Recruiter';
  const encodedQuery = encodeURIComponent(simpleQuery);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodedQuery}&origin=GLOBAL_SEARCH_HEADER`;
}

// Check if it's business hours
function isBusinessHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  // Skip weekends
  if (day === 0 || day === 6) return false;
  return hour >= OUTREACH_CONFIG.BUSINESS_HOURS_START && hour < OUTREACH_CONFIG.BUSINESS_HOURS_END;
}

// Get random time within business hours for next run
function getNextOutreachTime() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  // If it's a weekend, schedule for Monday
  let targetDate = new Date(now);
  if (currentDay === 0) { // Sunday
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (currentDay === 6) { // Saturday
    targetDate.setDate(targetDate.getDate() + 2);
  } else if (currentHour >= OUTREACH_CONFIG.BUSINESS_HOURS_END) {
    // Past business hours, schedule for next day
    targetDate.setDate(targetDate.getDate() + 1);
    if (targetDate.getDay() === 6) targetDate.setDate(targetDate.getDate() + 2);
    if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() + 1);
  }
  
  // Set random time within business hours
  const randomHour = OUTREACH_CONFIG.BUSINESS_HOURS_START + 
    Math.floor(Math.random() * (OUTREACH_CONFIG.BUSINESS_HOURS_END - OUTREACH_CONFIG.BUSINESS_HOURS_START));
  const randomMinute = Math.floor(Math.random() * 60);
  
  targetDate.setHours(randomHour, randomMinute, 0, 0);
  
  // If the target time is in the past (same day, but earlier hour), add a random delay
  if (targetDate.getTime() <= now.getTime()) {
    targetDate = new Date(now.getTime() + OUTREACH_CONFIG.MIN_DELAY_BETWEEN_RUNS_MS + Math.random() * 60 * 60 * 1000);
  }
  
  return targetDate.getTime();
}

// Get outreach state from storage
async function getOutreachState() {
  const data = await chrome.storage.local.get([
    'outreachEnabled',
    'outreachWeeklyCount',
    'outreachWeekStart',
    'outreachStatus',
    'outreachLastRun',
    'outreachSentProfiles',
    'outreachNextScheduled'
  ]);
  
  // Get start of current week (Monday)
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  const currentWeekStart = monday.getTime();
  
  // Reset weekly count if new week
  let weeklyCount = data.outreachWeeklyCount || 0;
  const storedWeekStart = data.outreachWeekStart || 0;
  if (storedWeekStart < currentWeekStart) {
    weeklyCount = 0;
    await chrome.storage.local.set({
      outreachWeeklyCount: 0,
      outreachWeekStart: currentWeekStart
    });
  }
  
  return {
    enabled: data.outreachEnabled || false,
    weeklyCount,
    status: data.outreachStatus || 'idle',
    lastRun: data.outreachLastRun || 0,
    sentProfiles: data.outreachSentProfiles || [],
    nextScheduled: data.outreachNextScheduled || 0
  };
}

// Update outreach state
async function updateOutreachState(updates) {
  const toSet = {};
  if (updates.enabled !== undefined) toSet.outreachEnabled = updates.enabled;
  if (updates.weeklyCount !== undefined) toSet.outreachWeeklyCount = updates.weeklyCount;
  if (updates.status !== undefined) toSet.outreachStatus = updates.status;
  if (updates.lastRun !== undefined) toSet.outreachLastRun = updates.lastRun;
  if (updates.sentProfiles !== undefined) toSet.outreachSentProfiles = updates.sentProfiles;
  if (updates.nextScheduled !== undefined) toSet.outreachNextScheduled = updates.nextScheduled;
  await chrome.storage.local.set(toSet);
}

// Add log entry
async function addOutreachLog(entry) {
  const { outreachLogs = [] } = await chrome.storage.local.get(['outreachLogs']);
  const logEntry = { ...entry, timestamp: entry.timestamp || Date.now() };
  outreachLogs.unshift(logEntry);
  const trimmed = outreachLogs.slice(0, 500);
  await chrome.storage.local.set({ outreachLogs: trimmed });
}

// Schedule next outreach run
async function scheduleOutreachRun() {
  const state = await getOutreachState();
  if (!state.enabled) {
    console.log('[Outreach] Disabled, not scheduling');
    return;
  }
  
  // Check if we've hit weekly limit
  const remaining = OUTREACH_CONFIG.MAX_WEEKLY_INVITES - state.weeklyCount;
  if (remaining <= 0) {
    console.log('[Outreach] Weekly limit reached, not scheduling until next week');
    return;
  }
  
  const nextTime = getNextOutreachTime();
  await updateOutreachState({ nextScheduled: nextTime });
  
  // Create alarm
  const delayMinutes = Math.max(1, Math.ceil((nextTime - Date.now()) / 60000));
  chrome.alarms.create('outreach', { delayInMinutes: delayMinutes });
  
  console.log(`[Outreach] Scheduled next run in ${delayMinutes} minutes (${new Date(nextTime).toLocaleString()})`);
}

// Perform outreach run
// forceRun: true bypasses business hours check (for manual "Run Now")
async function performOutreachRun(forceRun = false) {
  console.log('[Outreach] performOutreachRun called, forceRun:', forceRun);
  
  const state = await getOutreachState();
  console.log('[Outreach] Current state:', JSON.stringify(state));
  
  if (!state.enabled) {
    console.log('[Outreach] Disabled, skipping run');
    return { success: false, reason: 'disabled' };
  }
  
  // Check if job scan is running
  const { scanRunStatus } = await chrome.storage.local.get(['scanRunStatus']);
  if (scanRunStatus === 'scanning') {
    console.log('[Outreach] Job scan is running, postponing outreach');
    await scheduleOutreachRun(); // Reschedule for later
    return { success: false, reason: 'job_scan_running' };
  }
  
  // Check business hours (skip if forceRun from manual trigger)
  if (!forceRun && !isBusinessHours()) {
    console.log('[Outreach] Outside business hours, rescheduling');
    await scheduleOutreachRun();
    return { success: false, reason: 'outside_business_hours' };
  }
  
  // Check weekly limit
  const remaining = OUTREACH_CONFIG.MAX_WEEKLY_INVITES - state.weeklyCount;
  if (remaining <= 0) {
    console.log('[Outreach] Weekly limit reached');
    return { success: false, reason: 'weekly_limit_reached' };
  }
  
  const maxInvites = Math.min(OUTREACH_CONFIG.MAX_INVITES_PER_RUN, remaining);
  const MAX_PAGES = 5; // Process up to 5 pages per run
  
  console.log(`[Outreach] Starting run, max invites: ${maxInvites}, weekly remaining: ${remaining}`);
  await updateOutreachState({ status: 'running' });
  
  let totalSentCount = 0;
  const updatedSentProfiles = [...state.sentProfiles];
  const allResults = [];
  
  try {
    // Create a tab for outreach
    let tab = null;
    const searchUrl = buildOutreachSearchUrl();
    console.log('[Outreach] Opening search URL:', searchUrl);
    
    tab = await chrome.tabs.create({
      url: searchUrl,
      active: true
    });
    console.log('[Outreach] Created tab:', tab.id);
    
    // Process multiple pages
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      console.log(`[Outreach] ===== Processing page ${pageNum} of ${MAX_PAGES} =====`);
      
      // Check if we've sent enough
      if (totalSentCount >= maxInvites) {
        console.log('[Outreach] Reached max invites, stopping pagination');
        break;
      }
      
      // Wait for tab to load
      await new Promise((resolve) => {
        const checkTab = async () => {
          try {
            const t = await chrome.tabs.get(tab.id);
            if (t.status === 'complete' && t.url?.includes('linkedin.com/search')) {
              resolve();
            } else {
              setTimeout(checkTab, 500);
            }
          } catch (e) {
            setTimeout(resolve, 3000);
          }
        };
        setTimeout(checkTab, 2000);
      });
      
      // Wait for content to render
      console.log('[Outreach] Page loaded, waiting for content...');
      await sleep(randomDelay(3000, 5000));
      
      // Inject content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['connectionContent.js']
        });
        await sleep(1000);
      } catch (injectError) {
        // Script may already be injected
      }
      
      // Send message to content script
      let result = null;
      let retries = 3;
      // Limit invites per page, but also respect overall remaining
      const overallRemaining = maxInvites - totalSentCount;
      const invitesForThisPage = Math.min(OUTREACH_CONFIG.MAX_INVITES_PER_PAGE, overallRemaining);
      
      console.log(`[Outreach] Processing page ${pageNum}, invites for this page: ${invitesForThisPage}, overall remaining: ${overallRemaining}`);
      
      while (retries > 0 && !result) {
        try {
          result = await chrome.tabs.sendMessage(tab.id, {
            action: 'processOutreach',
            maxInvites: invitesForThisPage,
            sentProfileUrls: updatedSentProfiles,
            scrollFirst: true
          });
        } catch (e) {
          retries--;
          if (retries > 0) {
            console.log(`[Outreach] Message failed, retrying... (${retries} left)`);
            await sleep(2000);
          }
        }
      }
      
      if (!result) {
        console.error('[Outreach] Failed to communicate with content script on page', pageNum);
        break;
      }
      
      // Handle rate limit
      if (result.error === 'RATE_LIMIT') {
        console.warn('[Outreach] Rate limit detected!');
        await addOutreachLog({
          profileUrl: '',
          profileName: 'SYSTEM',
          title: '',
          company: '',
          outcome: 'error',
          reason: 'LinkedIn rate limit detected'
        });
        break;
      }
      
      // Process page results
      const pageSentCount = result.sentCount || 0;
      totalSentCount += pageSentCount;
      
      for (const entry of (result.results || [])) {
        allResults.push(entry);
        if (entry.outcome === 'sent' && entry.profileUrl) {
          updatedSentProfiles.push(entry.profileUrl.toLowerCase());
        }
      }
      
      console.log(`[Outreach] Page ${pageNum} complete: sent ${pageSentCount}, total sent: ${totalSentCount}`);
      
      // Only stop if we've reached the overall max invites for this run
      if (totalSentCount >= maxInvites) {
        console.log('[Outreach] Reached max invites for this run');
        break;
      }
      
      // Always try to navigate to next page (unless it's the last page)
      // Continue even if no invites were sent on this page (profiles might not match, already connected, etc.)
      if (pageNum < MAX_PAGES) {
        console.log('[Outreach] Navigating to next page...');
        
        // Click Next button via script injection
        try {
          const nextPageResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Look for Next button
              const nextBtn = document.querySelector('button[aria-label="Next"]') ||
                              document.querySelector('button.artdeco-pagination__button--next') ||
                              document.querySelector('[aria-label="Next"]');
              
              if (nextBtn && !nextBtn.disabled) {
                nextBtn.click();
                return { success: true };
              }
              
              // Try finding by text
              const buttons = document.querySelectorAll('button');
              for (const btn of buttons) {
                if (btn.textContent?.trim().toLowerCase() === 'next' && !btn.disabled) {
                  btn.click();
                  return { success: true };
                }
              }
              
              return { success: false, reason: 'Next button not found or disabled' };
            }
          });
          
          if (!nextPageResult?.[0]?.result?.success) {
            console.log('[Outreach] Could not navigate to next page:', nextPageResult?.[0]?.result?.reason);
            break;
          }
          
          // Wait for page navigation
          console.log('[Outreach] Waiting for next page to load...');
          await sleep(randomDelay(3000, 5000));
          
        } catch (navError) {
          console.error('[Outreach] Navigation error:', navError);
          break;
        }
      }
    }
    
    // Close the tab
    console.log('[Outreach] Closing tab...');
    await sleep(2000);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      // Tab might already be closed
    }
    
    // Log all results
    for (const entry of allResults) {
      await addOutreachLog(entry);
    }
    
    // Update state
    await updateOutreachState({
      status: 'idle',
      weeklyCount: state.weeklyCount + totalSentCount,
      lastRun: Date.now(),
      sentProfiles: updatedSentProfiles
    });
    
    console.log(`[Outreach] Completed. Sent: ${totalSentCount}, Weekly total: ${state.weeklyCount + totalSentCount}`);
    
    // Schedule next run
    await scheduleOutreachRun();
    
    return { success: true, sentCount: totalSentCount, results: allResults };
    
  } catch (error) {
    console.error('[Outreach] Error during run:', error);
    await addOutreachLog({
      profileUrl: '',
      profileName: 'SYSTEM',
      title: '',
      company: '',
      outcome: 'error',
      reason: error.message
    });
    await updateOutreachState({ status: 'idle' });
    await scheduleOutreachRun();
    return { success: false, reason: error.message };
  }
}

// Handle outreach alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'outreach') {
    console.log('[Outreach] Alarm triggered');
    await performOutreachRun();
  }
});

// Initialize outreach on startup
chrome.runtime.onStartup.addListener(async () => {
  const state = await getOutreachState();
  if (state.enabled) {
    await scheduleOutreachRun();
  }
});

// Check outreach scheduling on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const state = await getOutreachState();
  if (state.enabled) {
    await scheduleOutreachRun();
  }
});

// Extract job description from a tab by navigating to it and waiting for content to load
async function extractJobDescriptionFromTab(jobUrl) {
  try {
    // Create or find a tab for extraction
    let tab = null;
    const tabs = await chrome.tabs.query({ url: jobUrl.split('?')[0] + '*' });
    if (tabs.length > 0) {
      tab = tabs[0];
    } else {
      // Create a new tab
      tab = await chrome.tabs.create({
        url: jobUrl,
        active: false
      });
      // Wait for tab to load
      await new Promise((resolve) => {
        const checkTab = async () => {
          try {
            const updatedTab = await chrome.tabs.get(tab.id);
            if (updatedTab.status === 'complete') {
              // Wait a bit more for dynamic content to load
              setTimeout(resolve, 3000);
            } else {
              setTimeout(checkTab, 500);
            }
          } catch (error) {
            setTimeout(resolve, 3000);
          }
        };
        checkTab();
      });
    }
    
    // Inject script to extract description
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDescriptionFromPage
    });
    
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    
    return { descriptionHtml: '', extractors: null };
  } catch (error) {
    console.error('Error in extractJobDescriptionFromTab:', error);
    return { descriptionHtml: '', extractors: null, error: error.message };
  }
}

// Function to extract description from the page (runs in page context)
function extractDescriptionFromPage() {
  // This function runs in the page context, so it has access to the live DOM
  const SELECTORS = {
    jobDetailTitle: [
      '.jobs-details-top-card__job-title',
      'h1.jobs-details-top-card__job-title',
      'h1[data-test-id="job-title"]'
    ],
    jobDetailCompany: [
      '.jobs-details-top-card__company-name',
      'a.jobs-details-top-card__company-name',
      'a[data-tracking-control-name="job-details-company-name"]',
      '.jobs-details-top-card__company-link'
    ],
    jobDetailLocation: [
      '.jobs-details-top-card__bullet',
      '.jobs-details-top-card__primary-description-without-tagline',
      'span[data-testid="job-location"]',
      '.jobs-details-top-card__primary-description li'
    ],
    jobDetailDate: [
      // Newer LinkedIn unified job details header
      '.job-details-jobs-unified-top-card__tertiary-description-container',
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis',
      '.job-details-jobs-unified-top-card__tertiary-description-container [class*="tvm__text"]',
      '[class*="unified-top-card"] [class*="tertiary-description"]',
      '[class*="unified-top-card"] .tvm__text--low-emphasis',
      '.jobs-details-top-card__job-insight',
      '.jobs-details-top-card__job-insight-text-item',
      'span[data-testid="job-posted-date"]',
      'time[datetime]',
      '.jobs-details-top-card__primary-description time',
      '.jobs-details-top-card__primary-description-without-tagline time',
      'li[data-testid="job-posted-date"]',
      '[class*="job-insight"] time',
      '[class*="posted-date"]',
      '.jobs-details-top-card__primary-description li:last-child',
      '.jobs-details-top-card__primary-description-without-tagline li:last-child'
    ]
  };
  
  // LinkedIn navigation/header keywords to exclude
  const NAV_KEYWORDS = [
    'skip to search', 'skip to main content', 'keyboard shortcuts', 'close jump menu',
    'new feed updates', 'notifications', 'home', 'my network', 'jobs', 'messaging',
    'for business', 'advertise', 'me', 'search', 'sign in', 'join now', 'sign up',
    'linkedin', 'navigation', 'menu', 'header', 'footer', 'sidebar'
  ];
  
  function isNavigationElement(element) {
    if (!element) return false;
    
    const classes = (element.className || '').toLowerCase();
    if (classes.includes('nav') || classes.includes('header') || 
        classes.includes('footer') || classes.includes('sidebar') ||
        classes.includes('global-nav') || classes.includes('top-bar') ||
        classes.includes('skip-link') || classes.includes('accessibility')) {
      return true;
    }
    
    const id = (element.id || '').toLowerCase();
    if (id.includes('nav') || id.includes('header') || id.includes('footer') ||
        id.includes('skip') || id.includes('accessibility')) {
      return true;
    }
    
    const text = (element.textContent || '').toLowerCase().trim();
    if (text.length < 100) {
      for (const keyword of NAV_KEYWORDS) {
        if (text.includes(keyword)) {
          return true;
        }
      }
    }
    
    let parent = element.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const parentClasses = (parent.className || '').toLowerCase();
      const parentId = (parent.id || '').toLowerCase();
      if (parentClasses.includes('nav') || parentClasses.includes('header') ||
          parentClasses.includes('global-nav') || parentId.includes('nav') ||
          parentId.includes('header')) {
        return true;
      }
      parent = parent.parentElement;
    }
    
    return false;
  }
  
  function extractDescriptionContent(doc) {
    // Strategy: Find "About the job" heading and get everything after it
    const allHeadings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, span, div, p');
    
    for (const heading of allHeadings) {
      // Skip navigation elements
      if (isNavigationElement(heading)) continue;
      
      const headingText = heading.textContent?.trim() || '';
      const headingLower = headingText.toLowerCase();
      
      // Skip if it contains navigation keywords
      if (NAV_KEYWORDS.some(kw => headingLower.includes(kw))) continue;
      
      const isAboutHeading = headingText.toLowerCase().includes('about') && 
                            (headingText.toLowerCase().includes('job') || 
                             headingText.toLowerCase().includes('position') ||
                             headingText.toLowerCase().includes('role') ||
                             headingText.length < 20);
      
      if (isAboutHeading || 
          headingText.match(/^about$/i) ||
          headingText.match(/job\s+description/i)) {
        
        // Find parent container with substantial content
        let current = heading;
        let bestContainer = null;
        let bestTextLength = 0;
        
        for (let depth = 0; depth < 10 && current && current !== document.body; depth++) {
          if (isNavigationElement(current)) {
            current = current.parentElement;
            continue;
          }
          
          const text = current.textContent?.trim() || '';
          const textLower = text.toLowerCase();
          const navKeywordCount = NAV_KEYWORDS.filter(kw => textLower.includes(kw)).length;
          if (navKeywordCount > 3) {
            current = current.parentElement;
            continue;
          }
          
          if (text.length > bestTextLength && text.length > 200) {
            const hasJobKeywords = text.toLowerCase().includes('responsibilities') ||
                                  text.toLowerCase().includes('requirements') ||
                                  text.toLowerCase().includes('qualifications') ||
                                  text.length > 500;
            
            if (hasJobKeywords || text.length > 1000) {
              const tagName = current.tagName?.toUpperCase() || '';
              if (tagName === 'SECTION' || tagName === 'DIV' || tagName === 'ARTICLE' || 
                  tagName === 'MAIN' || current.classList.length > 0) {
                bestContainer = current;
                bestTextLength = text.length;
              }
            }
          }
          current = current.parentElement;
        }
        
        if (bestContainer && !isNavigationElement(bestContainer)) {
          const clone = bestContainer.cloneNode(true);
          clone.querySelectorAll('nav, header, [class*="nav"], [class*="header"], [id*="nav"], [id*="header"]').forEach(node => node.remove());
          clone.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
          const inner = clone.innerHTML?.trim() || '';
          
          const innerLower = inner.toLowerCase();
          const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
          if (inner.length > 100 && navCount < 3) {
            return inner;
          }
        }
        
        // Get all following siblings
        let sibling = heading.nextElementSibling;
        const parts = [];
        let collectedText = '';
        
        while (sibling && parts.length < 50) {
          if (isNavigationElement(sibling)) {
            sibling = sibling.nextElementSibling;
            continue;
          }
          
          const tag = sibling.tagName?.toUpperCase() || '';
          if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
            const siblingText = sibling.textContent?.trim() || '';
            const siblingLower = siblingText.toLowerCase();
            if (NAV_KEYWORDS.some(kw => siblingLower.includes(kw))) {
              break;
            }
            if (siblingText.length > 50 || 
                !siblingText.toLowerCase().includes('requirements') &&
                !siblingText.toLowerCase().includes('benefits')) {
              break;
            }
          }
          
          const text = sibling.textContent?.trim() || '';
          const textLower = text.toLowerCase();
          if (NAV_KEYWORDS.some(kw => textLower.includes(kw)) && text.length < 200) {
            sibling = sibling.nextElementSibling;
            continue;
          }
          
          if (text.length > 10) {
            const clone = sibling.cloneNode(true);
            clone.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
            parts.push(clone.outerHTML);
            collectedText += text + ' ';
          }
          sibling = sibling.nextElementSibling;
        }
        
        if (parts.length > 0 && collectedText.trim().length > 100) {
          const collectedLower = collectedText.toLowerCase();
          const navCount = NAV_KEYWORDS.filter(kw => collectedLower.includes(kw)).length;
          if (navCount < 5) {
            return parts.join('');
          }
        }
      }
    }
    
    return '';
  }
  
  const rawHtml = extractDescriptionContent(document);
  
  // Extract metadata
  const getTitle = () => {
    for (const selector of SELECTORS.jobDetailTitle) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent?.trim() : null;
  };
  
  const getCompany = () => {
    for (const selector of SELECTORS.jobDetailCompany) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 50 && /^[A-Z]/.test(text)) {
          return text;
        }
      }
    }
    return null;
  };
  
  const getLocation = () => {
    for (const selector of SELECTORS.jobDetailLocation) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    return null;
  };
  
  const getDate = () => {
    const extractRelativeDate = (raw) => {
      if (!raw) return null;
      const text = String(raw)
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/^[\s·•|–—\-:,]+/g, '')
        .trim();
      const match = text.match(/(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)/i);
      return match ? match[1].trim() : null;
    };

    // Simple approach - try all date selectors (similar to location)
    for (const selector of SELECTORS.jobDetailDate) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        const datetime = el.getAttribute('datetime');
        if (datetime) {
          try {
            const date = new Date(datetime);
            const now = new Date();
            const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'Today';
            else if (diffDays === 1) return '1 day ago';
            else if (diffDays < 7) return `${diffDays} days ago`;
            else if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
            else return `${Math.floor(diffDays / 30)} months ago`;
          } catch (e) {
            if (text) return text;
          }
        } else if (text) {
          const relative = extractRelativeDate(text);
          if (relative) return relative;
          // Extract date from "Reposted/Posted X weeks ago" format
          const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
          if (dateMatch && dateMatch[1]) {
            const cleaned = extractRelativeDate(dateMatch[1]) || dateMatch[1].trim();
            return cleaned;
          }
          return text;
        }
      }
    }
    
    // Fallback: look for all time elements with datetime
    const timeElements = document.querySelectorAll('time[datetime]');
    for (const el of timeElements) {
      const datetime = el.getAttribute('datetime');
      if (datetime) {
        try {
          const date = new Date(datetime);
          const now = new Date();
          const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
          if (diffDays === 0) return 'Today';
          else if (diffDays === 1) return '1 day ago';
          else if (diffDays < 7) return `${diffDays} days ago`;
          else if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
          else return `${Math.floor(diffDays / 30)} months ago`;
        } catch (e) {
          const text = el.textContent?.trim();
          if (text) {
            const relative = extractRelativeDate(text);
            if (relative) return relative;
            // Extract date from "Reposted/Posted X weeks ago" format
            const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
            if (dateMatch && dateMatch[1]) {
              const cleaned = extractRelativeDate(dateMatch[1]) || dateMatch[1].trim();
              return cleaned;
            }
            return text;
          }
        }
      } else {
        const text = el.textContent?.trim();
        if (text) {
          const relative = extractRelativeDate(text);
          if (relative) return relative;
          // Extract date from "Reposted/Posted X weeks ago" format
          const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
          if (dateMatch && dateMatch[1]) {
            const cleaned = extractRelativeDate(dateMatch[1]) || dateMatch[1].trim();
            return cleaned;
          }
          return text;
        }
      }
    }
    
    // Fallback: look for all time elements (even without datetime)
    const allTimeElements = document.querySelectorAll('time');
    for (const el of allTimeElements) {
      const text = el.textContent?.trim();
      if (text) {
        const relative = extractRelativeDate(text);
        if (relative) return relative;
        // Extract date from "Reposted/Posted X weeks ago" format
        const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
        if (dateMatch && dateMatch[1]) {
          const cleaned = extractRelativeDate(dateMatch[1]) || dateMatch[1].trim();
          return cleaned;
        }
        return text;
      }
    }
    
    return null;
  };
  
  return {
    descriptionHtml: rawHtml,
    extractors: {
      getTitle,
      getCompany,
      getLocation,
      getDate
    }
  };
}

// Re-match existing jobs when resumes are added or updated
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.resumes) {
    const newResumes = changes.resumes.newValue || [];
    const oldResumes = changes.resumes.oldValue || [];
    
    // Only re-match if resumes were actually added or changed (not just deleted)
    if (newResumes.length > 0 && newResumes.some(r => r && r.text && r.text.trim().length >= 10)) {
      console.log('Resumes updated, re-matching existing jobs...');
      
      try {
        const storage = await chrome.storage.local.get(['jobs']);
        const jobs = storage.jobs || [];
        
        if (jobs.length === 0) {
          console.log('No existing jobs to re-match');
          return;
        }
        
        const validResumes = newResumes.filter(r => r && r.filename && r.text && r.text.trim().length >= 10);
        
        if (validResumes.length === 0) {
          console.log('No valid resumes available for re-matching');
          return;
        }
        
        let updatedCount = 0;
        const updatedJobs = [];
        
        for (const job of jobs) {
          // Skip if job already has a bestResume (unless we want to re-evaluate)
          // For now, only match jobs that don't have a bestResume
          if (!job.bestResume || job.bestResume === 'N/A' || job.bestResume === null) {
            const textToMatch = getTextForMatching(job);
            const match = await matchResumeToJob(textToMatch, validResumes);
            
            if (match.filename) {
              job.bestResume = match.filename;
              job.matchScore = match.score !== undefined && match.score !== null ? match.score : 0;
              job.topKeywords = match.topKeywords || [];
              job.score = job.matchScore;
              updatedCount++;
            }
          }
          updatedJobs.push(job);
        }
        
        if (updatedCount > 0) {
          await chrome.storage.local.set({ jobs: updatedJobs });
          console.log(`Re-matched ${updatedCount} jobs with resumes`);
          await updateBadge();
        } else {
          console.log('No jobs needed re-matching');
        }
      } catch (error) {
        console.error('Error re-matching jobs:', error);
      }
    }
  }
});

