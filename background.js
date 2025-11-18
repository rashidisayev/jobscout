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
    handleJobResults(request.jobs).then(() => {
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
        // Wait longer for page to load, especially for first page
        const waitTime = pageIndex === 0 ? randomDelay(4000, 6000) : randomDelay(3000, 5000);
        await sleep(waitTime);
        
        // Inject content script and start scraping
        try {
          const results = await chrome.tabs.sendMessage(scanTab.id, {
            action: 'scrapeJobs',
            onlyNew: settings.onlyNewRoles,
            lastSeenIds: lastSeenIds,
            pageIndex: pageIndex
          });
          
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

// Handle job results: deduplicate, match with resumes, store
// Returns count of new jobs added
async function handleJobResults(jobs) {
  const existing = await chrome.storage.local.get(['jobs', 'lastSeenJobIds', 'resumes']);
  const existingJobs = existing.jobs || [];
  const lastSeenIds = existing.lastSeenJobIds || [];
  const resumes = existing.resumes || [];
  
  const newJobIds = new Set(lastSeenIds);
  const deduplicatedJobs = [];
  
  for (const job of jobs) {
    const jobId = job.id || hashJobUrl(job.link);
    if (!newJobIds.has(jobId)) {
      newJobIds.add(jobId);
      
      // Match with resumes if available
      if (resumes.length > 0) {
        // Use description if available, otherwise use title + company as fallback
        const textToMatch = job.description || `${job.title || ''} ${job.company || ''}`.trim();
        if (textToMatch && textToMatch.length > 10) { // Need meaningful text to match
          const match = await matchResumeToJob(textToMatch, resumes);
          job.bestResume = match.filename || null;
          job.matchScore = match.score || 0;
          job.topKeywords = match.topKeywords || [];
          
          // Debug logging
          if (match.score === 0) {
            console.log('Zero score match:', {
              jobTitle: job.title,
              hasDescription: !!job.description,
              descriptionLength: job.description?.length || 0,
              textToMatchLength: textToMatch.length,
              resumeCount: resumes.length,
              resumeTextLengths: resumes.map(r => r.text?.length || 0)
            });
          }
        } else {
          console.log('Skipping match - insufficient text:', {
            jobTitle: job.title,
            hasDescription: !!job.description,
            textToMatchLength: textToMatch?.length || 0
          });
          job.bestResume = null;
          job.matchScore = 0;
          job.topKeywords = [];
        }
      } else {
        job.bestResume = null;
        job.matchScore = 0;
        job.topKeywords = [];
      }
      
      job.id = jobId;
      job.foundAt = Date.now();
      deduplicatedJobs.push(job);
    }
  }
  
  // Merge with existing jobs
  const allJobs = [...existingJobs, ...deduplicatedJobs];
  
  // Update storage
  await chrome.storage.local.set({
    jobs: allJobs,
    lastSeenJobIds: Array.from(newJobIds)
  });
  
  await updateBadge();
  
  return deduplicatedJobs.length;
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
  for (const doc of documents) {
    const uniqueTerms = new Set(doc);
    for (const term of uniqueTerms) {
      idf[term] = (idf[term] || 0) + 1;
    }
  }
  for (const term in idf) {
    idf[term] = Math.log(totalDocs / idf[term]);
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
  
  const idf = calculateIDF([jobTokens, resumeTokens]);
  const jobTFIDF = calculateTFIDF(jobTokens, idf);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf);
  
  const similarity = calculateCosineSimilarity(jobTFIDF, resumeTFIDF);
  
  // Debug very low scores
  if (similarity < 0.01 && jobTokens.length > 10 && resumeTokens.length > 10) {
    const commonTerms = Object.keys(jobTFIDF).filter(term => resumeTFIDF[term]);
    console.log('Low similarity score:', {
      score: similarity,
      jobTokensCount: jobTokens.length,
      resumeTokensCount: resumeTokens.length,
      commonTermsCount: commonTerms.length,
      sampleCommonTerms: commonTerms.slice(0, 10)
    });
  }
  
  return similarity;
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
    return bestMatch;
  }
  
  for (const resume of resumes) {
    if (!resume.text || resume.text.trim().length < 10) {
      console.log(`Skipping resume ${resume.filename} - text too short or missing`);
      continue;
    }
    
    const score = cosineSimilarity(jobDescription, resume.text);
    
    if (score > bestMatch.score) {
      const topKeywords = getTopMatchingKeywords(jobDescription, resume.text, 10);
      bestMatch = {
        filename: resume.filename,
        score: score,
        topKeywords: topKeywords
      };
    }
  }
  
  // Log if no good match found
  if (bestMatch.score === 0 && resumes.length > 0) {
    console.log('No match found above 0:', {
      resumesChecked: resumes.length,
      jobDescLength: jobDescription.length,
      resumeTextLengths: resumes.map(r => r.text?.length || 0)
    });
  }
  
  return bestMatch;
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

