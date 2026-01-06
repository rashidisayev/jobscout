// Content script for scraping LinkedIn job listings
// Runs on https://www.linkedin.com/jobs/*

const SELECTORS = {
  // Search results page - multiple fallback selectors
  jobCard: [
    '.jobs-search-results__list-item',
    'li.jobs-search-results__list-item',
    '[data-job-id]',
    '.job-search-card',
    'li[data-occludable-job-id]',
    '.scaffold-layout__list-item',
    'li[data-view-name="job-search-card"]',
    '.job-card-container',
    'div[data-job-id]'
  ],
  jobTitle: [
    '.job-search-card__title-link',
    'a.job-search-card__title-link',
    'h3 a',
    '.base-search-card__title a',
    'a[data-tracking-control-name="job-card-title"]',
    '.job-card-list__title a',
    'h3.base-search-card__title a'
  ],
  jobCompany: [
    '.job-search-card__subtitle-link',
    'a.job-search-card__subtitle-link',
    '.job-search-card__subtitle',
    '.base-search-card__subtitle',
    'a[data-tracking-control-name="job-card-company"]',
    '.job-card-container__company-name',
    'h4.base-search-card__subtitle a',
    'h4.base-search-card__subtitle'
  ],
  jobLocation: [
    '.job-search-card__metadata-item',
    '.job-search-card__metadata',
    '.base-search-card__metadata',
    '.job-search-card__location',
    '.job-card-container__metadata-item',
    'span[data-testid="job-location"]',
    '.job-card-container__metadata-wrapper span'
  ],
  jobDate: [
    'span.white-space-pre', // Date is often in white-space-pre spans
    '.white-space-pre',
    'span[class*="white-space-pre"]',
    '.job-search-card__listdate',
    '.job-search-card__listdate--new',
    'time[datetime]',
    '.job-card-container__listed-date',
    'span[data-testid="job-posted-date"]',
    '.job-search-card__metadata-item time[datetime]',
    '.base-search-card__metadata time[datetime]',
    '.job-card-container__metadata-item time[datetime]',
    'li[data-testid="job-posted-date"]',
    '.jobs-search-results__list-item time[datetime]',
    'span.job-search-card__listdate',
    'div.job-search-card__listdate',
    '[class*="listdate"]',
    '[class*="listed-date"]',
    '[class*="posted-date"]',
    // Additional selectors for newer LinkedIn layouts - prioritize time elements with datetime
    '.base-search-card__metadata-item time[datetime]',
    '[data-test-id="job-posted-date"]',
    '.job-card-container__metadata-wrapper time[datetime]'
  ],
  jobLink: [
    '.job-search-card__title-link',
    'a.job-search-card__title-link',
    'h3 a',
    '.base-search-card__title a',
    'a[data-tracking-control-name="job-card-title"]',
    'a[href*="/jobs/view/"]'
  ],
  
  // Job detail page
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
  jobDetailDescription: [
    'article.jobs-description__container',
    'div.description',
    '[data-test-description]',
    '.jobs-description__text',
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '[data-test-id="job-details-description"]',
    '.jobs-description__text-container',
    // About the job section
    'section[data-test-id="job-details-section"]',
    'div[data-test-id="job-details-section"]',
    'section.jobs-description__section',
    'div.jobs-description__section'
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
  ],
  
  // Infinite scroll
  seeMoreJobs: 'button[aria-label*="See more jobs"]',
  loadMore: 'button[data-tracking-control-name*="see_more"]'
};

let utilsModulePromise = null;
function loadUtilsModule() {
  if (!utilsModulePromise) {
    utilsModulePromise = import(chrome.runtime.getURL('scripts/utils.js'))
      .catch(error => {
        console.error('Failed to load utils module:', error);
        return { sanitizeHtml: (html = '') => html };
      });
  }
  return utilsModulePromise;
}

let jobExtractorModulePromise = null;
function loadJobExtractorModule() {
  if (!jobExtractorModulePromise) {
    jobExtractorModulePromise = import(chrome.runtime.getURL('scripts/jobExtractor.js'))
      .catch(error => {
        console.error('Failed to load job extractor module:', error);
        return null;
      });
  }
  return jobExtractorModulePromise;
}

// Helper to find element with multiple selectors (optionally within a parent)
function findElement(selectors, parent = document) {
  const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of selectorArray) {
    const element = parent.querySelector ? parent.querySelector(selector) : document.querySelector(selector);
    if (element) return element;
  }
  return null;
}

// Helper to find all elements with multiple selectors (optionally within a parent)
function findAllElements(selectors, parent = document) {
  const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of selectorArray) {
    const elements = parent.querySelectorAll ? parent.querySelectorAll(selector) : document.querySelectorAll(selector);
    if (elements.length > 0) return elements;
  }
  return [];
}

// Listen for scrape command from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobs') {
    scrapeJobs(
      request.onlyNew, 
      request.lastSeenIds || [],
      request.pageIndex || 0
    ).then(results => {
      sendResponse({ jobs: results });
    }).catch(error => {
      console.error('Scraping error:', error);
      sendResponse({ jobs: [], error: error.message });
    });
    return true; // Keep channel open for async
  }
});

// Main scraping function with pagination support
async function scrapeJobs(onlyNew = true, lastSeenIds = [], pageIndex = 0) {
  const jobs = [];
  const seenIds = new Set(lastSeenIds);
  
  // Check if we're on a search results page
  if (!window.location.href.includes('/jobs/search')) {
    console.log('Not on a search results page');
    return jobs;
  }
  
  // Wait for page to be fully loaded
  await waitForPageReady();
  
  // Wait for job cards to appear with multiple selector fallbacks
  const jobCards = await waitForJobCards(15000);
  
  if (jobCards.length === 0) {
    console.warn(`Page ${pageIndex + 1}: No job cards found, page might still be loading or structure changed`);
    return jobs;
  }
  
  console.log(`Page ${pageIndex + 1}: Found ${jobCards.length} job cards`);
  
  // Scroll to load jobs on current page
  await scrollToLoadMore(2); // Scroll a couple times to ensure all jobs on page load
  
  // Re-fetch job cards after scrolling (in case more loaded)
  const allJobCards = findAllElements(SELECTORS.jobCard);
  console.log(`Page ${pageIndex + 1}: After scroll, found ${allJobCards.length} total job cards`);
  
  // Extract basic info from cards
  const jobLinks = [];
  const jobExtractorModule = await loadJobExtractorModule();
  
  // Extract JSON-LD once for the page (if available)
  let pageJsonLd = null;
  if (jobExtractorModule && jobExtractorModule.extractJsonLd) {
    pageJsonLd = jobExtractorModule.extractJsonLd(document);
  }
  
  // Track seen titles to prevent duplicates
  const seenTitles = new Map(); // title -> count
  
  for (const card of allJobCards) {
    try {
      const linkElement = findElement(SELECTORS.jobLink, card) || card.querySelector('a[href*="/jobs/view/"]');
      if (!linkElement || !linkElement.href) {
        // Try to find link by data attributes
        const jobIdAttr = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id');
        if (jobIdAttr) {
          // Construct URL from job ID if we have it
          const constructedLink = `https://www.linkedin.com/jobs/view/${jobIdAttr}`;
          
          // Use enhanced title extraction
          let title = 'Unknown';
          if (jobExtractorModule && jobExtractorModule.extractTitle) {
            title = jobExtractorModule.extractTitle(card, pageJsonLd);
          } else {
            // Fallback to original method
            title = findElement(SELECTORS.jobTitle, card)?.textContent?.trim() || 'Unknown';
          }
          
          // Deduplicate title if we've seen it before
          if (seenTitles.has(title)) {
            const count = seenTitles.get(title);
            seenTitles.set(title, count + 1);
            // Only deduplicate if we've seen it multiple times (might be legitimate duplicates)
            // For now, keep the title as-is since job ID should be unique
          } else {
            seenTitles.set(title, 1);
          }
          
          // Use enhanced date extraction
          let datePosted = null;
          if (jobExtractorModule && jobExtractorModule.extractDatePosted) {
            datePosted = jobExtractorModule.extractDatePosted(card, pageJsonLd);
          }
          
          // Use enhanced company extraction
          let company = 'Unknown';
          if (jobExtractorModule && jobExtractorModule.extractCompany) {
            company = jobExtractorModule.extractCompany(card, pageJsonLd, title);
          } else {
            company = findElement(SELECTORS.jobCompany, card)?.textContent?.trim() || 'Unknown';
          }
          
          jobLinks.push({
            link: constructedLink,
            url: constructedLink,
            id: hashUrl(constructedLink),
            title,
            company,
            location: findElement(SELECTORS.jobLocation, card)?.textContent?.trim() || 'Unknown',
            datePosted: datePosted || 'Unknown'
          });
        }
        continue;
      }
      
      const jobLink = linkElement.href.split('?')[0]; // Remove query params
      const jobId = hashUrl(jobLink);
      
      if (onlyNew && seenIds.has(jobId)) {
        continue;
      }
      
      // Use enhanced title extraction with deduplication
      let title = 'Unknown';
      if (jobExtractorModule && jobExtractorModule.extractTitle) {
        title = jobExtractorModule.extractTitle(card, pageJsonLd);
      } else {
        // Fallback: ensure we get title from within the card, not globally
        title = linkElement.textContent.trim() || 
                (card.querySelector(SELECTORS.jobTitle[0])?.textContent?.trim()) ||
                (card.querySelector('h3 a')?.textContent?.trim()) ||
                'Unknown';
      }
      
      // Deduplicate title
      if (seenTitles.has(title)) {
        const count = seenTitles.get(title);
        seenTitles.set(title, count + 1);
      } else {
        seenTitles.set(title, 1);
      }
      
      // Use enhanced company extraction
      let company = 'Unknown';
      if (jobExtractorModule && jobExtractorModule.extractCompany) {
        company = jobExtractorModule.extractCompany(card, pageJsonLd, title);
      } else {
        // Fallback to original method
        const companyElement = findElement(SELECTORS.jobCompany, card);
        if (companyElement) {
          company = companyElement.textContent.trim() || 'Unknown';
        }
      }
      
      // Try multiple methods to extract location
      let location = 'Unknown';
      const locationElement = findElement(SELECTORS.jobLocation, card);
      if (locationElement) {
        location = locationElement.textContent.trim();
      }
      
      // If still unknown, try more aggressive extraction
      if (location === 'Unknown' || !location) {
        // Look through all text elements in the card
        const allElements = card.querySelectorAll('span, li, div, p');
        for (const el of allElements) {
          const text = el.textContent.trim();
          if (!text || text.length > 100) continue; // Skip long text
          
          // Location patterns
          if (text.match(/(Remote|On-site|Hybrid|Work from home|WFH)/i)) {
            location = text;
            break;
          }
          // City, State format (e.g., "San Francisco, CA")
          if (text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/)) {
            location = text;
            break;
          }
          // Country names
          if (text.match(/^(United States|USA|Canada|UK|United Kingdom|Europe|Asia|Australia|Germany|France|Spain|Italy)$/i)) {
            location = text;
            break;
          }
          // City names (common tech cities)
          const techCities = ['San Francisco', 'New York', 'Seattle', 'Austin', 'Boston', 'Chicago', 'Los Angeles', 'Denver', 'Atlanta', 'London', 'Toronto', 'Vancouver', 'Sydney', 'Melbourne'];
          for (const city of techCities) {
            if (text.includes(city)) {
              location = text;
              break;
            }
          }
          if (location !== 'Unknown') break;
        }
      }
      
      // Use enhanced date extraction
      let datePosted = null;
      if (jobExtractorModule && jobExtractorModule.extractDatePosted) {
        datePosted = jobExtractorModule.extractDatePosted(card, pageJsonLd);
      }
      
      // If still unknown, specifically look for white-space-pre spans and their siblings/parents
      if (datePosted === 'Unknown') {
        const whiteSpacePreElements = card.querySelectorAll('span.white-space-pre, .white-space-pre, span[class*="white-space-pre"], [class*="white-space-pre"]');
        for (const el of whiteSpacePreElements) {
          // Check parent element (date is often in the parent of white-space-pre)
          const parent = el.parentElement;
          if (parent) {
            const parentClone = parent.cloneNode(true);
            parentClone.querySelectorAll('span.white-space-pre, .white-space-pre').forEach(ws => ws.remove());
            let text = parentClone.textContent?.trim() || parentClone.innerText?.trim() || '';
            if (!text || text.length === 0) {
              text = parent.textContent?.trim() || parent.innerText?.trim() || '';
            }
            
            if (text && text.length > 0 && text.length < 150) {
              const hasDateKeywords = text.match(/\b(ago|day|days|week|weeks|month|months|hour|hours|minute|minutes|today|yesterday|just|now|posted|active|reposted)\b/i);
              if (hasDateKeywords) {
                const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia|Australia|Germany|France|Spain|Italy|New York|San Francisco|Los Angeles|Chicago|Boston|Seattle|Austin|Denver|Atlanta|London|Toronto|Vancouver|Sydney|Melbourne|Berlin|Vienna|Austria)/i) ||
                                  text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/);
                if (!isLocation) {
                  const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
                  if (dateMatch && dateMatch[1] && typeof dateMatch[1] === 'string') {
                    datePosted = String(dateMatch[1]).trim();
                    break;
                  } else if (text.match(/\b(ago|day|days|week|weeks|month|months)\b/i)) {
                    datePosted = String(text).trim();
                    break;
                  }
                }
              }
            }
          }
          
          // Check next sibling
          const nextSibling = el.nextElementSibling;
          if (nextSibling && datePosted === 'Unknown') {
            const text = nextSibling.textContent?.trim() || nextSibling.innerText?.trim() || '';
            if (text && text.length > 0 && text.length < 100) {
              if (text.match(/\b(ago|day|days|week|weeks|month|months|hour|hours|minute|minutes|today|yesterday|just|now|posted|active|reposted)\b/i)) {
                const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia|Australia|Germany|France|Spain|Italy|New York|San Francisco|Los Angeles|Chicago|Boston|Seattle|Austin|Denver|Atlanta|London|Toronto|Vancouver|Sydney|Melbourne|Berlin|Vienna|Austria)/i);
                if (!isLocation) {
                  const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
                  if (dateMatch && dateMatch[1] && typeof dateMatch[1] === 'string') {
                    datePosted = String(dateMatch[1]).trim();
                    break;
                  } else {
                    datePosted = String(text).trim();
                    break;
                  }
                }
              }
            }
          }
          
          // Check previous sibling
          const prevSibling = el.previousElementSibling;
          if (prevSibling && datePosted === 'Unknown') {
            const text = prevSibling.textContent?.trim() || prevSibling.innerText?.trim() || '';
            if (text && text.length > 0 && text.length < 100) {
              if (text.match(/\b(ago|day|days|week|weeks|month|months|hour|hours|minute|minutes|today|yesterday|just|now|posted|active|reposted)\b/i)) {
                const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia|Australia|Germany|France|Spain|Italy|New York|San Francisco|Los Angeles|Chicago|Boston|Seattle|Austin|Denver|Atlanta|London|Toronto|Vancouver|Sydney|Melbourne|Berlin|Vienna|Austria)/i);
                if (!isLocation) {
                  const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
                  if (dateMatch && dateMatch[1] && typeof dateMatch[1] === 'string') {
                    datePosted = String(dateMatch[1]).trim();
                    break;
                  } else {
                    datePosted = String(text).trim();
                    break;
                  }
                }
              }
            }
          }
        }
      }
      
      // If still unknown, try to find all time elements in the card
      if (datePosted === 'Unknown') {
        const timeElements = card.querySelectorAll('time[datetime]');
        for (const timeEl of timeElements) {
          const datetime = timeEl.getAttribute('datetime');
          if (datetime) {
            try {
              const date = new Date(datetime);
              const now = new Date();
              const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
              if (diffDays === 0) datePosted = 'Today';
              else if (diffDays === 1) datePosted = '1 day ago';
              else if (diffDays < 7) datePosted = `${diffDays} days ago`;
              else if (diffDays < 30) datePosted = `${Math.floor(diffDays / 7)} weeks ago`;
              else datePosted = `${Math.floor(diffDays / 30)} months ago`;
              break;
            } catch (e) {
              const text = timeEl.textContent?.trim();
              if (text) {
                datePosted = text;
                break;
              }
            }
          } else {
            const text = timeEl.textContent?.trim();
            if (text) {
              // Extract date from "Reposted/Posted X weeks ago" format
              const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
              if (dateMatch && dateMatch[1] && typeof dateMatch[1] === 'string') {
                datePosted = String(dateMatch[1]).trim();
              } else {
                datePosted = String(text).trim();
              }
              break;
            }
          }
        }
      }
      
      // Also try all time elements without datetime attribute
      if (datePosted === 'Unknown') {
        const allTimeElements = card.querySelectorAll('time');
        for (const timeEl of allTimeElements) {
          const text = timeEl.textContent?.trim();
          if (text) {
            // Extract date from "Reposted/Posted X weeks ago" format
            const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
            if (dateMatch && dateMatch[1]) {
              datePosted = dateMatch[1].trim();
            } else {
              datePosted = text;
            }
            break;
          }
        }
      }
      
      // If still unknown, search through all metadata elements (similar to location extraction)
      if (datePosted === 'Unknown') {
        // Look through all metadata elements in the card
        const metadataElements = card.querySelectorAll('.job-search-card__metadata-item, .base-search-card__metadata-item, .job-card-container__metadata-item, .base-search-card__metadata, .job-search-card__metadata, li, span, div');
        for (const el of metadataElements) {
          const text = el.textContent?.trim() || '';
          if (!text || text.length > 100) continue; // Increased from 50 to 100
          
          // Check if it looks like a date (contains date keywords)
          if (text.match(/\b(ago|day|days|week|weeks|month|months|hour|hours|minute|minutes|today|yesterday|just|now|posted|active|reposted)\b/i)) {
            // Exclude location patterns - but be less strict
            const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia|Australia|Germany|France|Spain|Italy|New York|San Francisco|Los Angeles|Chicago|Boston|Seattle|Austin|Denver|Atlanta|London|Toronto|Vancouver|Sydney|Melbourne|Berlin|Vienna|Austria)/i) ||
                              text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/);
            
            if (!isLocation) {
              // Extract date from "Reposted/Posted X weeks ago" format
              const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
              if (dateMatch && dateMatch[1] && typeof dateMatch[1] === 'string') {
                datePosted = String(dateMatch[1]).trim();
              } else {
                datePosted = String(text).trim();
              }
              break;
            }
          }
        }
      }
      
      // Last resort: search through all text elements in the card
      if (datePosted === 'Unknown') {
        const allElements = card.querySelectorAll('span, li, div, p, time');
        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          if (!text || text.length > 100) continue; // Increased from 50 to 100
          
          // Check for date patterns (including "Reposted" and "Posted")
          if (text.match(/\b(ago|day|days|week|weeks|month|months|hour|hours|minute|minutes|today|yesterday|just|now|posted|active|reposted)\b/i)) {
            // Exclude location patterns - but be less strict
            const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia|Australia|Germany|France|Spain|Italy|New York|San Francisco|Los Angeles|Chicago|Boston|Seattle|Austin|Denver|Atlanta|London|Toronto|Vancouver|Sydney|Melbourne|Berlin|Vienna|Austria)/i) ||
                              text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/);
            
            if (!isLocation) {
              // Extract date from "Reposted/Posted X weeks ago" format
              const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
              if (dateMatch && dateMatch[1] && typeof dateMatch[1] === 'string') {
                datePosted = String(dateMatch[1]).trim();
              } else {
                datePosted = String(text).trim();
              }
              console.log('Found date in text element:', text, '-> extracted:', datePosted);
              break;
            }
          }
        }
      }
      
      // Debug logging if still unknown
      if (datePosted === 'Unknown') {
        console.warn('Date extraction failed for job card:', {
          title: title,
          company: company,
          location: location,
          cardHTML: card.innerHTML.substring(0, 500),
          allTimeElements: Array.from(card.querySelectorAll('time')).map(el => ({
            text: el.textContent?.trim(),
            datetime: el.getAttribute('datetime'),
            classes: el.className
          })),
          metadataElements: Array.from(card.querySelectorAll('.base-search-card__metadata-item, .job-search-card__metadata-item')).map(el => ({
            text: el.textContent?.trim(),
            classes: el.className
          }))
        });
      }
      
      // If we still have unknowns, try extracting from card's full text structure
      if (company === 'Unknown' || location === 'Unknown' || datePosted === 'Unknown') {
        const cardText = card.innerText || card.textContent || '';
        const cardHTML = card.innerHTML || '';
        
        // Helper function to validate company names
        const isValidCompany = (text) => {
          if (!text || text.length < 2 || text.length > 100) return false;
          const falsePositives = new Set([
            'Page', 'View', 'Apply', 'Save', 'Share', 'More', 'Less', 'Show', 'Hide',
            'LinkedIn', 'Jobs', 'Search', 'Filter', 'Sort', 'Results', 'Next', 'Previous',
            'Today', 'Yesterday', 'Remote', 'On-site', 'Hybrid', 'Full-time', 'Part-time',
            'Contract', 'Internship', 'Temporary', 'Permanent'
          ]);
          if (falsePositives.has(text.trim())) return false;
          if (text.match(/^(Page|View|Apply|Save|Share|More|Less|\d+)$/i)) return false;
          if (text.match(/^(the|and|or|but|for|with|from|this|that|these|those)$/i)) return false;
          if (!/^[A-Z]/.test(text.trim())) return false;
          if (title && text.trim().toLowerCase() === title.trim().toLowerCase()) return false;
          return true;
        };
        
        // More aggressive company extraction
        if (company === 'Unknown' || !isValidCompany(company)) {
          // Look for company name patterns in the card
          const lines = cardText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          // Company is usually on the second or third line after title
          for (let i = 1; i < Math.min(5, lines.length); i++) {
            const line = lines[i];
            // Skip if it looks like a location or date
            if (line.match(/(Remote|ago|days|weeks|months|Today|Yesterday|Page|View|Apply)/i)) continue;
            // Skip if it's too long (likely description)
            if (line.length > 50) continue;
            // Validate it's a real company name
            if (isValidCompany(line)) {
              company = line;
              break;
            }
          }
        }
        
        // More aggressive location extraction
        if (location === 'Unknown') {
          // Look through all text nodes
          const allText = cardText.split(/\s+/);
          for (let i = 0; i < allText.length - 1; i++) {
            const word = allText[i];
            const nextWord = allText[i + 1];
            // Check for "City, State" pattern
            if (word.match(/^[A-Z][a-z]+$/) && nextWord && nextWord.match(/^[A-Z]{2}$/)) {
              location = `${word}, ${nextWord}`;
              break;
            }
            // Check for location keywords
            if (word.match(/^(Remote|On-site|Hybrid|United|States|Canada|UK|Europe|Asia)$/i)) {
              location = word;
              if (nextWord && nextWord.match(/^States$/i)) {
                location = 'United States';
              }
              break;
            }
          }
        }
        
        // More aggressive date extraction
        if (datePosted === 'Unknown') {
          // Look for date patterns in text
          const datePatterns = [
            /(\d+\s+(day|week|month|hour|minute)s?\s+ago)/i,
            /(Just\s+now|Today|Yesterday)/i,
            /(Posted\s+(\d+\s+(day|week|month)s?\s+ago))/i,
            /(Posted\s+(Just\s+now|Today|Yesterday))/i,
            /(\d+d\s+ago|\d+w\s+ago|\d+m\s+ago)/i,
            /(Active\s+(\d+\s+(day|week|month)s?\s+ago))/i
          ];
          for (const pattern of datePatterns) {
            const match = cardText.match(pattern);
            if (match) {
              datePosted = match[1] || match[0];
              break;
            }
          }
          
          // Also check HTML for time elements with datetime
          if (datePosted === 'Unknown') {
            const timeElements = card.querySelectorAll('time');
            for (const timeEl of timeElements) {
              const datetime = timeEl.getAttribute('datetime');
              if (datetime) {
                try {
                  const date = new Date(datetime);
                  const now = new Date();
                  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
                  if (diffDays === 0) datePosted = 'Today';
                  else if (diffDays === 1) datePosted = '1 day ago';
                  else if (diffDays < 7) datePosted = `${diffDays} days ago`;
                  else if (diffDays < 30) datePosted = `${Math.floor(diffDays / 7)} weeks ago`;
                  else datePosted = `${Math.floor(diffDays / 30)} months ago`;
                  break;
                } catch (e) {
                  const text = timeEl.textContent.trim();
                  if (text) {
                    datePosted = text;
                    break;
                  }
                }
              }
            }
          }
        }
        
        // Debug logging
        if (company === 'Unknown' || location === 'Unknown' || datePosted === 'Unknown') {
          console.log('Job card extraction - still missing fields:', {
            title,
            company,
            location,
            datePosted,
            cardTextSample: cardText.substring(0, 300),
            cardStructure: Array.from(card.children).map(c => c.tagName + (c.className ? '.' + c.className.split(' ')[0] : '')).join(' > ')
          });
        }
      }
      
      // Debug logging for date extraction
      if (datePosted === 'Unknown') {
        console.log('Date extraction failed for job:', {
          title,
          cardHTML: card.innerHTML.substring(0, 500),
          timeElements: Array.from(card.querySelectorAll('time')).map(el => ({
            text: el.textContent?.trim(),
            datetime: el.getAttribute('datetime'),
            classes: el.className
          })),
          metadataElements: Array.from(card.querySelectorAll('.base-search-card__metadata-item, .job-search-card__metadata-item')).map(el => ({
            text: el.textContent?.trim(),
            classes: el.className
          }))
        });
      }
      
      // Create job data object with final extracted values
      const jobData = {
        link: jobLink,
        url: jobLink,
        id: jobId,
        title,
        company: company || 'Unknown',
        location: location || 'Unknown',
        datePosted: datePosted || 'Unknown'
      };
      
      jobLinks.push(jobData);
    } catch (error) {
      console.error('Error extracting job card:', error);
    }
  }
  
  // Add jobs without fetching descriptions (to avoid opening tabs during scanning)
  // Descriptions will be fetched on-demand when user clicks "Fetch description"
  for (const jobInfo of jobLinks) {
    // Ensure datePosted is properly set (convert null to 'Unknown' for display)
    let finalDatePosted = jobInfo.datePosted;
    if (!finalDatePosted || finalDatePosted === null) {
      finalDatePosted = 'Unknown';
    }
    
    const finalJobInfo = {
      ...jobInfo,
      url: jobInfo.url || jobInfo.link,
      title: jobInfo.title || 'Unknown',
      company: jobInfo.company || 'Unknown',
      location: jobInfo.location || 'Unknown',
      datePosted: finalDatePosted,
      descriptionHtml: '',
      needsFetch: true,
      scrapedAt: Date.now()
    };
    
    // Debug: log if date is still Unknown
    if (finalJobInfo.datePosted === 'Unknown') {
      console.warn('Job added with Unknown date:', {
        title: finalJobInfo.title,
        company: finalJobInfo.company,
        url: finalJobInfo.url
      });
    }
    
    jobs.push(finalJobInfo);
  }
  
  return jobs;
}

// Get full job description and extract missing metadata from detail page
async function getJobDescription(jobUrl) {
  try {
    // First try: Use background script to extract from a loaded tab (handles dynamic content)
    console.log(`Requesting job description extraction from background for ${jobUrl}...`);
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'extractJobDescription',
        jobUrl: jobUrl
      });
      
      if (result && result.descriptionHtml) {
        const { sanitizeHtml } = await loadUtilsModule();
        const descriptionHtml = sanitizeHtml(result.descriptionHtml);
        console.log(`Successfully extracted description via background script (${descriptionHtml.length} chars)`);
        return {
          descriptionHtml,
          extractors: result.extractors || null
        };
      }
    } catch (error) {
      console.warn('Background extraction failed, trying fetch method:', error);
    }
    
    // Fallback: Try fetching (may not work if content is dynamically loaded)
    console.log(`Fetching job description from ${jobUrl}...`);
    const response = await fetch(jobUrl, {
      headers: {
        'Accept': 'text/html',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'include'
    });
    
    if (!response.ok) {
      console.warn(`Failed to fetch ${jobUrl}: ${response.status}`);
      return { descriptionHtml: '', extractors: null };
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Use shared description extractor
    let descriptionExtractorModule;
    try {
      descriptionExtractorModule = await import(chrome.runtime.getURL('scripts/descriptionExtractor.js'));
    } catch (error) {
      console.warn('Failed to load description extractor, using fallback:', error);
      descriptionExtractorModule = null;
    }
    
    const { sanitizeHtml } = await loadUtilsModule();
    const rawHtml = descriptionExtractorModule 
      ? descriptionExtractorModule.extractDescriptionContent(doc)
      : extractDescriptionContent(doc); // Fallback to local function
    const descriptionHtml = rawHtml ? sanitizeHtml(rawHtml) : '';
    
    if (!descriptionHtml) {
      console.warn(`No description found for ${jobUrl}`);
      console.warn(`Page HTML length: ${html.length} chars`);
      console.warn(`Body text length: ${doc.body?.textContent?.length || 0} chars`);
      // Try to find any text that might be the description
      const allText = doc.body?.textContent || '';
      if (allText.length > 500) {
        console.warn(`Found ${allText.length} chars of text, but extraction failed`);
        // Log first 500 chars to see what we got
        console.warn(`First 500 chars: ${allText.substring(0, 500)}`);
      }
    } else {
      console.log(`Successfully extracted description (${descriptionHtml.length} chars) for ${jobUrl}`);
    }
    
    // Use shared metadata extractors if available, otherwise use local fallback
    let extractors;
    if (descriptionExtractorModule && descriptionExtractorModule.createMetadataExtractors) {
      extractors = descriptionExtractorModule.createMetadataExtractors(doc);
    } else {
      // Fallback: create simple extractors
      extractors = {
        getTitle: () => {
          const h1 = doc.querySelector('h1');
          return h1 ? h1.textContent?.trim() : null;
        },
        getCompany: () => null,
        getLocation: () => null,
        getDate: () => null
      };
    }
    
    return {
      descriptionHtml,
      extractors
    };
  } catch (error) {
    console.error('Error fetching job description:', error);
    return { descriptionHtml: '', extractors: null };
  }
}

function extractDescriptionContent(doc) {
  console.log('Extracting description content...');
  
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
  
  // Strategy 1: Look for embedded JSON data in script tags (LinkedIn often embeds data)
  const scripts = doc.querySelectorAll('script[type="application/ld+json"], script:not([src])');
  console.log(`Strategy 1: Found ${scripts.length} script tags to check`);
  for (const script of scripts) {
    try {
      const text = script.textContent || '';
      if (text.includes('description') || text.includes('jobDescription') || text.includes('about')) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          // Look for description in various possible locations
          const desc = data.description || data.jobDescription || data.about || 
                       data['@graph']?.find(item => item.description)?.description ||
                       data.mainEntity?.description;
          if (desc && typeof desc === 'string' && desc.length > 100) {
            console.log('Strategy 1 SUCCESS: Found description in JSON data');
            return `<p>${desc.replace(/\n/g, '</p><p>')}</p>`;
          }
        }
      }
    } catch (e) {
      // Not valid JSON, continue
    }
  }
  
  // Strategy 2: Look for data attributes that might contain description
  const dataElements = doc.querySelectorAll('[data-description], [data-job-description], [data-content]');
  console.log(`Strategy 2: Found ${dataElements.length} elements with data attributes`);
  for (const el of dataElements) {
    const desc = el.getAttribute('data-description') || 
                 el.getAttribute('data-job-description') || 
                 el.getAttribute('data-content');
    if (desc && desc.length > 100) {
      console.log('Strategy 2 SUCCESS: Found description in data attribute');
      return desc;
    }
  }
  
  // Strategy 3: Search for "About the job" or similar headings and get ALL following content
  const allHeadings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"], [class*="header"], span, div, p');
  console.log(`Strategy 3: Found ${allHeadings.length} potential headings to check`);
  let aboutHeadingFound = false;
  
  for (const heading of allHeadings) {
    // Skip navigation elements
    if (isNavigationElement(heading)) continue;
    
    const headingText = heading.textContent?.trim() || '';
    const headingLower = headingText.toLowerCase();
    
    // Skip if it contains navigation keywords
    if (NAV_KEYWORDS.some(kw => headingLower.includes(kw))) continue;
    
    // More flexible matching - look for "about" and "job" anywhere in the text
    const isAboutHeading = headingText.toLowerCase().includes('about') && 
                          (headingText.toLowerCase().includes('job') || 
                           headingText.toLowerCase().includes('position') ||
                           headingText.toLowerCase().includes('role') ||
                           headingText.length < 20); // Short headings like "About"
    
    if (isAboutHeading || 
        headingText.match(/^about$/i) ||
        headingText.match(/job\s+description/i) ||
        headingText.match(/^description$/i) ||
        headingText.match(/overview/i)) {
      aboutHeadingFound = true;
      console.log(`Strategy 3: Found matching heading: "${headingText}"`);
      
      // Strategy 3a: Find the closest parent section/div that contains substantial content
      let current = heading;
      let bestContainer = null;
      let bestTextLength = 0;
      
      // Walk up the DOM tree to find the best container
      for (let depth = 0; depth < 10 && current && current !== doc.body; depth++) {
        // Skip if parent is navigation
        if (isNavigationElement(current)) {
          current = current.parentElement;
          continue;
        }
        
        const text = current.textContent?.trim() || '';
        const textLower = text.toLowerCase();
        
        // Skip if text contains too many navigation keywords
        const navKeywordCount = NAV_KEYWORDS.filter(kw => textLower.includes(kw)).length;
        if (navKeywordCount > 3) {
          current = current.parentElement;
          continue;
        }
        
        // Look for containers with substantial content (likely the description section)
        if (text.length > bestTextLength && text.length > 200) {
          // Check if this looks like a description container
          const hasJobKeywords = text.toLowerCase().includes('responsibilities') ||
                                text.toLowerCase().includes('requirements') ||
                                text.toLowerCase().includes('qualifications') ||
                                text.toLowerCase().includes('experience') ||
                                text.toLowerCase().includes('skills') ||
                                text.length > 500; // Or just very long text
          
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
        // Remove navigation elements from clone
        clone.querySelectorAll('nav, header, [class*="nav"], [class*="header"], [id*="nav"], [id*="header"]').forEach(node => node.remove());
        removeDangerousNodes(clone);
        const inner = clone.innerHTML?.trim() || '';
        
        // Check if result contains too many navigation keywords
        const innerLower = inner.toLowerCase();
        const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
        if (inner.length > 100 && navCount < 3) {
          console.log(`Strategy 3a SUCCESS: Found description in parent container (${bestTextLength} chars)`);
          return inner;
        }
      }
      
      // Strategy 3b: Get ALL following siblings until we hit another major heading
      let sibling = heading.nextElementSibling;
      const parts = [];
      let collectedText = '';
      
      while (sibling && parts.length < 50) {
        // Skip navigation elements
        if (isNavigationElement(sibling)) {
          sibling = sibling.nextElementSibling;
          continue;
        }
        
        const tag = sibling.tagName?.toUpperCase() || '';
        // Stop at major headings (but allow h4, h5, h6 which might be subsections)
        if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
          // Check if this is a new major section
          const siblingText = sibling.textContent?.trim() || '';
          const siblingLower = siblingText.toLowerCase();
          // Skip if it's a navigation heading
          if (NAV_KEYWORDS.some(kw => siblingLower.includes(kw))) {
            break;
          }
          if (siblingText.length < 50 && 
              (siblingText.toLowerCase().includes('requirements') ||
               siblingText.toLowerCase().includes('benefits') ||
               siblingText.toLowerCase().includes('qualifications'))) {
            // This might be a subsection, continue
          } else {
            break; // New major section, stop here
          }
        }
        
        const text = sibling.textContent?.trim() || '';
        // Skip if text contains navigation keywords
        const textLower = text.toLowerCase();
        if (NAV_KEYWORDS.some(kw => textLower.includes(kw)) && text.length < 200) {
          sibling = sibling.nextElementSibling;
          continue;
        }
        
        if (text.length > 10) {
          const clone = sibling.cloneNode(true);
          removeDangerousNodes(clone);
          parts.push(clone.outerHTML);
          collectedText += text + ' ';
        }
        sibling = sibling.nextElementSibling;
      }
      
      if (parts.length > 0 && collectedText.trim().length > 100) {
        // Final check: make sure collected text doesn't have too many nav keywords
        const collectedLower = collectedText.toLowerCase();
        const navCount = NAV_KEYWORDS.filter(kw => collectedLower.includes(kw)).length;
        if (navCount < 5) {
          console.log(`Strategy 3b SUCCESS: Found description in ${parts.length} sibling elements (${collectedText.trim().length} chars)`);
          return parts.join('');
        }
      }
      
      // Strategy 3c: Find the next section/div after the heading
      let nextSection = heading.nextElementSibling;
      while (nextSection && nextSection !== doc.body) {
        if (isNavigationElement(nextSection)) {
          nextSection = nextSection.nextElementSibling;
          continue;
        }
        
        const tagName = nextSection.tagName?.toUpperCase() || '';
        if (tagName === 'SECTION' || tagName === 'DIV' || tagName === 'ARTICLE') {
          const text = nextSection.textContent?.trim() || '';
          const textLower = text.toLowerCase();
          const navCount = NAV_KEYWORDS.filter(kw => textLower.includes(kw)).length;
          if (text.length > 200 && navCount < 3) {
            const clone = nextSection.cloneNode(true);
            removeDangerousNodes(clone);
            const inner = clone.innerHTML?.trim() || '';
            if (inner.length > 100) {
              console.log(`Strategy 3c SUCCESS: Found description in next section (${text.length} chars)`);
              return inner;
            }
          }
        }
        nextSection = nextSection.nextElementSibling;
        if (!nextSection) break;
        // Don't go too far - stop if we hit another heading
        if (nextSection.tagName?.match(/^H[1-3]$/)) break;
      }
    }
  }
  
  if (aboutHeadingFound) {
    console.log('Strategy 3: Found "About" heading but could not extract content from siblings/parents');
  }
  
  // Strategy 4: Try standard CSS selectors
  const selectors = Array.isArray(SELECTORS.jobDetailDescription)
    ? SELECTORS.jobDetailDescription
    : [SELECTORS.jobDetailDescription];
  console.log(`Strategy 4: Trying ${selectors.length} CSS selectors`);
  for (const selector of selectors) {
    try {
      const element = doc.querySelector(selector);
      if (!element) continue;
      
      const clone = element.cloneNode(true);
      removeDangerousNodes(clone);
      let inner = clone.innerHTML?.trim() || '';
      if (!inner) {
        const text = clone.textContent?.trim();
        if (text && text.length > 50) {
          inner = `<p>${text}</p>`;
        }
      }
      if (inner.length > 100) {
        console.log(`Strategy 4 SUCCESS: Found description using selector "${selector}"`);
        return inner;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }
  
  // Strategy 5: Find the largest text block that looks like a description
  // Look for divs/sections with substantial text content
  const candidates = doc.querySelectorAll('div, section, article, main');
  let bestCandidate = null;
  let bestScore = 0;
  
  for (const candidate of candidates) {
    // Skip navigation elements
    if (isNavigationElement(candidate)) continue;
    
    const text = candidate.textContent?.trim() || '';
    const textLower = text.toLowerCase();
    
    // Skip if contains too many navigation keywords
    const navKeywordCount = NAV_KEYWORDS.filter(kw => textLower.includes(kw)).length;
    if (navKeywordCount > 3) continue;
    
    // Score based on length and whether it contains job-related keywords
    if (text.length > 200) {
      const keywords = ['responsibilities', 'requirements', 'qualifications', 'experience', 
                        'skills', 'benefits', 'salary', 'location', 'remote', 'full-time'];
      const keywordCount = keywords.filter(kw => textLower.includes(kw)).length;
      const score = text.length + (keywordCount * 100);
      
      if (score > bestScore && text.length > 300) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }
  }
  
  if (bestCandidate && !isNavigationElement(bestCandidate)) {
    const clone = bestCandidate.cloneNode(true);
    // Remove navigation elements from clone
    clone.querySelectorAll('nav, header, [class*="nav"], [class*="header"], [id*="nav"], [id*="header"]').forEach(node => node.remove());
    removeDangerousNodes(clone);
    const inner = clone.innerHTML?.trim() || '';
    
    // Final check for navigation keywords
    const innerLower = inner.toLowerCase();
    const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
    if (inner.length > 100 && navCount < 3) {
      console.log(`Strategy 5 SUCCESS: Found description in best candidate (score: ${bestScore})`);
      return inner;
    }
  }
  
  // Strategy 6: Look for any element with class containing "description", "content", "body", "text"
  const descClasses = doc.querySelectorAll('[class*="description"], [class*="content"], [class*="body"], [class*="text"], [class*="detail"]');
  console.log(`Strategy 6: Found ${descClasses.length} elements with description-related classes`);
  for (const el of descClasses) {
    // Skip navigation elements
    if (isNavigationElement(el)) continue;
    
    const text = el.textContent?.trim() || '';
    const textLower = text.toLowerCase();
    
    // Skip if contains navigation keywords
    if (NAV_KEYWORDS.some(kw => textLower.includes(kw)) && text.length < 200) continue;
    
    if (text.length > 300) {
      const clone = el.cloneNode(true);
      removeDangerousNodes(clone);
      const inner = clone.innerHTML?.trim() || '';
      
      // Check for navigation keywords
      const innerLower = inner.toLowerCase();
      const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
      if (inner.length > 100 && navCount < 3) {
        console.log('Strategy 6 SUCCESS: Found description in class-based search');
        return inner;
      }
    }
  }
  
  console.log('All strategies failed - no description found');
  return '';
}

function removeDangerousNodes(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
}

// Scroll page to load more jobs (infinite scroll)
async function scrollToLoadMore(maxScrolls = 3) {
  for (let i = 0; i < maxScrolls; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2000); // Wait for new content to load
    
    // Check if "See more jobs" button exists and click it
    const seeMoreButton = document.querySelector(SELECTORS.seeMoreJobs);
    if (seeMoreButton && !seeMoreButton.disabled) {
      seeMoreButton.click();
      await sleep(2000);
    }
  }
}

// Wait for page to be ready
async function waitForPageReady() {
  // Wait for document to be ready
  if (document.readyState === 'complete') {
    await sleep(1000); // Give it a moment for dynamic content
    return;
  }
  
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      setTimeout(resolve, 1000);
      return;
    }
    
    window.addEventListener('load', () => {
      setTimeout(resolve, 1000);
    }, { once: true });
  });
}

// Wait for job cards with multiple selector fallbacks
async function waitForJobCards(timeout = 15000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const cards = findAllElements(SELECTORS.jobCard);
    if (cards.length > 0) {
      return cards;
    }
    
    // Wait a bit before retrying
    await sleep(500);
  }
  
  // Last attempt - return whatever we find (even if empty)
  return findAllElements(SELECTORS.jobCard);
}

// Wait for element to appear (legacy function for compatibility)
function waitForElement(selector, timeout = 5000) {
  const selectorArray = Array.isArray(selector) ? selector : [selector];
  
  return new Promise((resolve, reject) => {
    // Check immediately
    for (const sel of selectorArray) {
      if (document.querySelector(sel)) {
        resolve();
        return;
      }
    }
    
    const observer = new MutationObserver((mutations, obs) => {
      for (const sel of selectorArray) {
        if (document.querySelector(sel)) {
          obs.disconnect();
          resolve();
          return;
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element not found with selectors: ${selectorArray.join(', ')} within ${timeout}ms`));
    }, timeout);
  });
}

// Utility: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility: Random delay
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Utility: Hash URL to create ID
function hashUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString();
}

