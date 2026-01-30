// Content script for Agentur für Arbeit (German Federal Employment Agency)
// Scrapes job listings from arbeitsagentur.de job search

const SOURCE_NAME = 'Agentur für Arbeit';
const SOURCE_TYPE = 'arbeitsagentur.de';

/**
 * Extract job listings from the search results page
 */
function extractJobListings() {
  const jobs = [];
  
  // Try multiple selectors for job cards
  const jobCardSelectors = [
    '[data-testid="job-posting"]',
    '.ergebnisliste-item',
    '.stellenangebot',
    '[class*="JobPosting"]',
    '[class*="job-card"]',
    'article[class*="result"]',
    '.ba-job-teaser',
    '[data-job-id]',
    '.job-result-item'
  ];
  
  let jobCards = [];
  for (const selector of jobCardSelectors) {
    jobCards = document.querySelectorAll(selector);
    if (jobCards.length > 0) {
      console.log(`[ArbeitsagenturContent] Found ${jobCards.length} job cards using: ${selector}`);
      break;
    }
  }
  
  // Fallback: look for any links containing job detail URLs
  if (jobCards.length === 0) {
    const jobLinks = document.querySelectorAll('a[href*="/jobsuche/stellenangebot/"]');
    console.log(`[ArbeitsagenturContent] Found ${jobLinks.length} job links via href`);
    
    // Get unique parent containers
    const containers = new Set();
    jobLinks.forEach(link => {
      const container = link.closest('li') || link.closest('article') || link.closest('div[class*="result"]') || link.parentElement?.parentElement;
      if (container) {
        containers.add(container);
      }
    });
    jobCards = Array.from(containers);
    console.log(`[ArbeitsagenturContent] Extracted ${jobCards.length} unique job containers`);
  }
  
  // Process each job card
  for (const card of jobCards) {
    try {
      const job = extractJobData(card);
      if (job && job.title && job.url) {
        jobs.push(job);
      }
    } catch (error) {
      console.error('[ArbeitsagenturContent] Error extracting job:', error);
    }
  }
  
  console.log(`[ArbeitsagenturContent] Extracted ${jobs.length} jobs total`);
  return jobs;
}

/**
 * Extract data from a single job card
 */
function extractJobData(card) {
  // Job title - try multiple selectors
  let title = '';
  const titleSelectors = [
    'h2 a', 'h3 a', 'h4 a',
    '[class*="title"] a',
    '[class*="Title"] a',
    'a[class*="job-title"]',
    '.stellenangebot-titel',
    '.job-title',
    'a[href*="/jobsuche/stellenangebot/"]'
  ];
  
  for (const selector of titleSelectors) {
    const el = card.querySelector(selector);
    if (el?.textContent?.trim()) {
      title = el.textContent.trim();
      break;
    }
  }
  
  // If no title found in nested elements, try the card itself
  if (!title) {
    const headings = card.querySelectorAll('h2, h3, h4');
    for (const h of headings) {
      if (h.textContent?.trim()) {
        title = h.textContent.trim();
        break;
      }
    }
  }
  
  // Job URL
  let url = '';
  let jobId = '';
  const linkEl = card.querySelector('a[href*="/jobsuche/stellenangebot/"]') ||
                 card.querySelector('a[href*="jobsuche"]') ||
                 card.querySelector('h2 a, h3 a');
  
  if (linkEl?.href) {
    url = linkEl.href;
    // Extract job ID from URL
    const idMatch = url.match(/stellenangebot\/(\d+)/);
    if (idMatch) {
      jobId = idMatch[1];
    }
  }
  
  // Also check for data attributes
  if (!jobId) {
    jobId = card.getAttribute('data-job-id') || 
            card.getAttribute('data-id') ||
            card.getAttribute('id') ||
            '';
  }
  
  // Company name
  let company = '';
  const companySelectors = [
    '[class*="company"]',
    '[class*="Company"]',
    '[class*="arbeitgeber"]',
    '[class*="Arbeitgeber"]',
    '.employer',
    '.firma'
  ];
  
  for (const selector of companySelectors) {
    const el = card.querySelector(selector);
    if (el?.textContent?.trim()) {
      company = el.textContent.trim();
      break;
    }
  }
  
  // Fallback: look for text patterns
  if (!company) {
    const allText = card.textContent || '';
    // Often company is in a specific format or after certain keywords
    const companyMatch = allText.match(/(?:bei|Arbeitgeber|Firma|Company)[\s:]+([^,\n]+)/i);
    if (companyMatch) {
      company = companyMatch[1].trim();
    }
  }
  
  // Location
  let location = '';
  const locationSelectors = [
    '[class*="location"]',
    '[class*="Location"]',
    '[class*="ort"]',
    '[class*="Ort"]',
    '[class*="standort"]',
    '.arbeitsort',
    '.place'
  ];
  
  for (const selector of locationSelectors) {
    const el = card.querySelector(selector);
    if (el?.textContent?.trim()) {
      location = el.textContent.trim();
      break;
    }
  }
  
  // Posting date
  let datePosted = '';
  const dateSelectors = [
    '[class*="date"]',
    '[class*="Date"]',
    '[class*="datum"]',
    '[class*="Datum"]',
    'time',
    '[datetime]'
  ];
  
  for (const selector of dateSelectors) {
    const el = card.querySelector(selector);
    if (el) {
      datePosted = el.getAttribute('datetime') || el.textContent?.trim() || '';
      if (datePosted) break;
    }
  }
  
  // Create job object with source information
  return {
    id: jobId || `aa-${hashString(url || title)}`,
    title: cleanText(title),
    company: cleanText(company),
    location: cleanText(location),
    datePosted: datePosted,
    url: url,
    source: SOURCE_NAME,
    sourceType: SOURCE_TYPE,
    scrapedAt: Date.now(),
    foundAt: Date.now()
  };
}

/**
 * Clean text - remove extra whitespace, newlines, and German result numbering
 */
function cleanText(text) {
  if (!text) return '';
  // Remove patterns like "119. Ergebnis:" or "1. Ergebnis:"
  let cleaned = text.replace(/^\d+\.\s*Ergebnis:\s*/i, '');
  // Remove any remaining leading numbers with dots like "119. "
  cleaned = cleaned.replace(/^\d+\.\s+/, '');
  // Normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Simple hash function for generating IDs
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash | 0;
  }
  return Math.abs(hash).toString();
}

/**
 * Extract full job description from detail page
 */
function extractJobDescription() {
  const descriptionSelectors = [
    '[class*="description"]',
    '[class*="Description"]',
    '[class*="beschreibung"]',
    '[class*="Beschreibung"]',
    '.stellenbeschreibung',
    '.job-description',
    'article',
    '.detail-content',
    '#job-detail',
    '[class*="detail"]'
  ];
  
  for (const selector of descriptionSelectors) {
    const el = document.querySelector(selector);
    if (el?.innerHTML && el.innerHTML.length > 100) {
      return el.innerHTML;
    }
  }
  
  // Fallback: get main content
  const main = document.querySelector('main') || document.querySelector('[role="main"]');
  if (main?.innerHTML) {
    return main.innerHTML;
  }
  
  return '';
}

/**
 * Scroll to load more results (if infinite scroll is used)
 */
async function scrollToLoadMore() {
  const scrollHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  let currentScroll = 0;
  
  while (currentScroll < scrollHeight - viewportHeight) {
    currentScroll += viewportHeight * 0.8;
    window.scrollTo({ top: currentScroll, behavior: 'smooth' });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await new Promise(resolve => setTimeout(resolve, 300));
}

// Message listener for communication with background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ArbeitsagenturContent] Received message:', message.action);
  
  if (message.action === 'scrapeJobs') {
    (async () => {
      try {
        // Scroll to potentially load more results
        await scrollToLoadMore();
        
        const jobs = extractJobListings();
        
        console.log(`[ArbeitsagenturContent] Scraped ${jobs.length} jobs`);
        sendResponse({ 
          jobs,
          source: SOURCE_NAME,
          sourceType: SOURCE_TYPE
        });
      } catch (error) {
        console.error('[ArbeitsagenturContent] Error scraping jobs:', error);
        sendResponse({ jobs: [], error: error.message });
      }
    })();
    
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'extractDescription') {
    try {
      const descriptionHtml = extractJobDescription();
      sendResponse({ descriptionHtml });
    } catch (error) {
      console.error('[ArbeitsagenturContent] Error extracting description:', error);
      sendResponse({ descriptionHtml: '', error: error.message });
    }
    return true;
  }
  
  if (message.action === 'checkPage') {
    const jobs = extractJobListings();
    sendResponse({
      isValidPage: jobs.length > 0 || window.location.href.includes('jobsuche'),
      jobCount: jobs.length
    });
    return true;
  }
});

// Initial log
console.log('[ArbeitsagenturContent] Content script loaded on:', window.location.href);

// Run initial diagnostic
setTimeout(() => {
  const jobs = extractJobListings();
  console.log(`[ArbeitsagenturContent] Initial scan found ${jobs.length} jobs`);
  if (jobs.length > 0) {
    console.log('[ArbeitsagenturContent] Sample job:', jobs[0]);
  }
}, 2000);
