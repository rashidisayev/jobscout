// Background service worker for JobScout
// Handles alarms, scanning, and badge updates

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
    const settings = await chrome.storage.local.get(['scanningEnabled']);
    if (settings.scanningEnabled) {
      await performScan();
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
  
  // Find or create a hidden tab for scanning
  let scanTab = null;
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (tabs.length > 0) {
    scanTab = tabs[0];
  } else {
    scanTab = await chrome.tabs.create({
      url: 'https://www.linkedin.com/jobs',
      active: false
    });
    // Wait for tab to load
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Process each search URL
  for (const searchUrl of settings.searchUrls) {
    try {
      await updateRunState({
        currentUrl: searchUrl,
        currentPage: 0
      });
      
      // Process up to 5 pages (start=0, 25, 50, 75, 100)
      const pageStarts = [0, 25, 50, 75, 100];
      
      for (let pageIndex = 0; pageIndex < pageStarts.length; pageIndex++) {
        const start = pageStarts[pageIndex];
        const pageUrl = addStartParameter(searchUrl, start);
        
        await updateRunState({
          currentPage: pageIndex + 1
        });
        
        // Navigate to page
        await chrome.tabs.update(scanTab.id, { url: pageUrl });
        
        // Wait for tab to finish loading
        await new Promise((resolve) => {
          const checkTab = async () => {
            try {
              const tab = await chrome.tabs.get(scanTab.id);
              if (tab.status === 'complete' && tab.url && tab.url.includes('linkedin.com/jobs')) {
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
        
        // Retry mechanism for sending message (content script should auto-inject from manifest)
        try {
          let results = null;
          let retries = 5;
          while (retries > 0 && !results) {
            try {
              results = await chrome.tabs.sendMessage(scanTab.id, {
                action: 'scrapeJobs',
                onlyNew: settings.onlyNewRoles,
                lastSeenIds: lastSeenIds,
                pageIndex: pageIndex
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
            const pageJobs = results.jobs;
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
  
  // Update badge
  await updateBadge();
}

// Add start parameter to LinkedIn search URL
function addStartParameter(url, start) {
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.set('start', start.toString());
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, append parameter manually
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}start=${start}`;
  }
}

// Handle job results: deduplicate, merge, match with resumes, store
// Returns count of new jobs added
async function handleJobResults(jobs = [], options = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return 0;
  }
  
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
  
  for (const incoming of jobs) {
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
      mergedJobs[existingIndex] = updated;
    } else {
      mergedJobs[existingIndex] = mergedRecord;
    }
  }
  
  await chrome.storage.local.set({
    jobs: mergedJobs,
    lastSeenJobIds: Array.from(lastSeenSet)
  });
  
  await updateBadge();
  return newJobsCount;
}

async function enrichJobMatchData(job, resumes) {
  const enrichedJob = { ...job };
  
  if (!resumes || resumes.length === 0) {
    enrichedJob.bestResume = null;
    enrichedJob.matchScore = 0;
    enrichedJob.topKeywords = [];
    enrichedJob.score = 0;
    return enrichedJob;
  }
  
  const textToMatch = getTextForMatching(job);
  const match = await matchResumeToJob(textToMatch, resumes);
  enrichedJob.bestResume = match.filename || null;
  enrichedJob.matchScore = match.score !== undefined && match.score !== null ? match.score : 0;
  enrichedJob.topKeywords = match.topKeywords || [];
  enrichedJob.score = enrichedJob.matchScore;
  return enrichedJob;
}

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

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word));
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
  
  // Calculate IDF with smoothing to avoid zero values
  // Standard formula: idf(t) = log((N + 1) / (df(t) + 1))
  // This prevents log(1) = 0 when a term appears in all documents
  // For small document sets (like 2 docs), this gives better differentiation
  for (const term in idf) {
    const docFreq = idf[term];
    // Smoothing: add 1 to both numerator and denominator
    // This ensures terms that appear in all docs still get a small positive IDF
    idf[term] = Math.log((totalDocs + 1) / (docFreq + 1));
    
    // Ensure minimum IDF value to prevent zero weights
    // Terms appearing in all docs get log((N+1)/(N+1)) = 0, so we add a small epsilon
    if (idf[term] <= 0) {
      idf[term] = 0.1; // Small positive value for common terms
    }
  }
  
  return idf;
}

function calculateTFIDF(tokens, idf) {
  const tf = calculateTF(tokens);
  const tfidf = {};
  for (const term in tf) {
    tfidf[term] = tf[term] * (idf[term] || 0);
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

function cosineSimilarity(jobDescription, resumeText) {
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
  
  // Calculate IDF with smoothing
  const idf = calculateIDF([jobTokens, resumeTokens]);
  const jobTFIDF = calculateTFIDF(jobTokens, idf);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf);
  
  // Calculate cosine similarity
  const similarity = calculateCosineSimilarity(jobTFIDF, resumeTFIDF);
  
  // Ensure similarity is a valid number between 0 and 1
  const normalizedSimilarity = Math.max(0, Math.min(1, similarity));
  
  // Debug logging for score calculation
  if (normalizedSimilarity < 0.01 && jobTokens.length > 10 && resumeTokens.length > 10) {
    const commonTerms = Object.keys(jobTFIDF).filter(term => resumeTFIDF[term]);
    const jobTFIDFValues = Object.values(jobTFIDF).filter(v => v > 0);
    const resumeTFIDFValues = Object.values(resumeTFIDF).filter(v => v > 0);
    console.log('Low similarity score (debug):', {
      rawScore: similarity,
      normalizedScore: normalizedSimilarity,
      jobTokensCount: jobTokens.length,
      resumeTokensCount: resumeTokens.length,
      commonTermsCount: commonTerms.length,
      jobTFIDFNonZero: jobTFIDFValues.length,
      resumeTFIDFNonZero: resumeTFIDFValues.length,
      sampleCommonTerms: commonTerms.slice(0, 10),
      sampleIDF: Object.fromEntries(Object.entries(idf).slice(0, 5))
    });
  }
  
  return normalizedSimilarity;
}

function getTopMatchingKeywords(jobDescription, resumeText, topN = 10) {
  const jobTokens = tokenize(jobDescription);
  const resumeTokens = tokenize(resumeText);
  if (jobTokens.length === 0 || resumeTokens.length === 0) {
    return [];
  }
  const idf = calculateIDF([jobTokens, resumeTokens]);
  const jobTFIDF = calculateTFIDF(jobTokens, idf);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf);
  const commonTerms = new Set(
    Object.keys(jobTFIDF).filter(term => resumeTFIDF[term])
  );
  const termScores = [];
  for (const term of commonTerms) {
    const score = jobTFIDF[term] * resumeTFIDF[term];
    termScores.push({ term, score });
  }
  termScores.sort((a, b) => b.score - a.score);
  return termScores.slice(0, topN).map(item => item.term);
}

// Match job description with best resume using NLP
async function matchResumeToJob(jobDescription, resumes) {
  let bestMatch = { filename: null, score: 0, topKeywords: [] };
  
  if (!jobDescription || jobDescription.trim().length < 10) {
    console.log('Job description too short for matching');
    // Still try to match with first available resume if description is short
    if (resumes.length > 0 && resumes[0].text && resumes[0].text.trim().length >= 10) {
      return {
        filename: resumes[0].filename,
        score: 0,
        topKeywords: []
      };
    }
    return bestMatch;
  }
  
  // Track if we found any valid resume
  let hasValidResume = false;
  
  for (const resume of resumes) {
    if (!resume || !resume.filename) {
      console.log('Skipping invalid resume entry');
      continue;
    }
    
    if (!resume.text || resume.text.trim().length < 10) {
      console.log(`Skipping resume ${resume.filename} - text too short or missing`);
      continue;
    }
    
    hasValidResume = true;
    const score = cosineSimilarity(jobDescription, resume.text);
    
    // Always update if this is the first valid resume or if score is better (including equal)
    if (!bestMatch.filename || score >= bestMatch.score) {
      const topKeywords = getTopMatchingKeywords(jobDescription, resume.text, 10);
      bestMatch = {
        filename: resume.filename,
        score: score,
        topKeywords: topKeywords
      };
    }
  }
  
  // If we have valid resumes but no match was found (all scores were 0 or negative),
  // still return the first valid resume as a fallback
  if (!bestMatch.filename && hasValidResume && resumes.length > 0) {
    const firstValidResume = resumes.find(r => r && r.text && r.text.trim().length >= 10);
    if (firstValidResume) {
      console.log('No match found, using first valid resume as fallback:', firstValidResume.filename);
      return {
        filename: firstValidResume.filename,
        score: 0,
        topKeywords: []
      };
    }
  }
  
  // Log if no good match found
  if (bestMatch.score === 0 && resumes.length > 0 && bestMatch.filename) {
    console.log('Match found but score is 0:', {
      bestResume: bestMatch.filename,
      resumesChecked: resumes.length,
      jobDescLength: jobDescription.length,
      resumeTextLengths: resumes.map(r => r.text?.length || 0)
    });
  } else if (!bestMatch.filename && resumes.length > 0) {
    console.log('No valid resume found for matching:', {
      resumesChecked: resumes.length,
      jobDescLength: jobDescription.length,
      resumeTextLengths: resumes.map(r => r.text?.length || 0)
    });
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
    hash = hash & hash; // Convert to 32bit integer
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
    // First try all date selectors
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
            if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
              return text;
            }
          }
        }
        if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
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
          if (text) return text;
        }
      }
    }
    
    // Fallback: look for all time elements (even without datetime)
    const allTimeElements = document.querySelectorAll('time');
    for (const el of allTimeElements) {
      const text = el.textContent?.trim();
      if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
        return text;
      }
    }
    
    // Fallback: look for date patterns in page text
    const pageText = document.body?.textContent || '';
    const datePatterns = [
      /(\d+\s+(day|week|month|hour|minute)s?\s+ago)/i,
      /(Just\s+now|Today|Yesterday)/i,
      /(Posted\s+(\d+\s+(day|week|month)s?\s+ago))/i,
      /(Posted\s+(Just\s+now|Today|Yesterday))/i,
      /(\d+d\s+ago|\d+w\s+ago|\d+m\s+ago)/i,
      /(Active\s+(\d+\s+(day|week|month)s?\s+ago))/i
    ];
    for (const pattern of datePatterns) {
      const match = pageText.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }
    
    // Last fallback: look through all job insight elements
    const insightElements = document.querySelectorAll('.jobs-details-top-card__job-insight, .jobs-details-top-card__job-insight-text-item, li');
    for (const el of insightElements) {
      const text = el.textContent?.trim();
      if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
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

