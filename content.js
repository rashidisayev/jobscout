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
    '.job-search-card__listdate',
    '.job-search-card__listdate--new',
    'time',
    '.job-card-container__listed-date',
    'time[datetime]',
    'span[data-testid="job-posted-date"]'
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
    '.jobs-description__text',
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '[data-test-id="job-details-description"]',
    '.jobs-description__text-container'
  ],
  jobDetailDate: [
    '.jobs-details-top-card__job-insight',
    '.jobs-details-top-card__job-insight-text-item',
    'span[data-testid="job-posted-date"]',
    'time[datetime]'
  ],
  
  // Infinite scroll
  seeMoreJobs: 'button[aria-label*="See more jobs"]',
  loadMore: 'button[data-tracking-control-name*="see_more"]'
};

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
  for (const card of allJobCards) {
    try {
      const linkElement = findElement(SELECTORS.jobLink, card) || card.querySelector('a[href*="/jobs/view/"]');
      if (!linkElement || !linkElement.href) {
        // Try to find link by data attributes
        const jobIdAttr = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id');
        if (jobIdAttr) {
          // Construct URL from job ID if we have it
          const constructedLink = `https://www.linkedin.com/jobs/view/${jobIdAttr}`;
          const title = findElement(SELECTORS.jobTitle, card)?.textContent?.trim() || 'Unknown';
          jobLinks.push({
            link: constructedLink,
            id: hashUrl(constructedLink),
            title,
            company: findElement(SELECTORS.jobCompany, card)?.textContent?.trim() || 'Unknown',
            location: findElement(SELECTORS.jobLocation, card)?.textContent?.trim() || 'Unknown',
            datePosted: findElement(SELECTORS.jobDate, card)?.textContent?.trim() || 'Unknown'
          });
        }
        continue;
      }
      
      const jobLink = linkElement.href.split('?')[0]; // Remove query params
      const jobId = hashUrl(jobLink);
      
      if (onlyNew && seenIds.has(jobId)) {
        continue;
      }
      
      const title = linkElement.textContent.trim() || findElement(SELECTORS.jobTitle, card)?.textContent?.trim() || 'Unknown';
      
      // Try multiple methods to extract company
      let company = 'Unknown';
      const companyElement = findElement(SELECTORS.jobCompany, card);
      if (companyElement) {
        company = companyElement.textContent.trim();
      } else {
        // Try to find company in card text or aria-labels
        const cardText = card.textContent || '';
        const companyMatch = cardText.match(/(?:Company|at)\s+([A-Z][a-zA-Z\s&]+)/);
        if (companyMatch) company = companyMatch[1].trim();
      }
      
      // Try multiple methods to extract location
      let location = 'Unknown';
      const locationElement = findElement(SELECTORS.jobLocation, card);
      if (locationElement) {
        location = locationElement.textContent.trim();
      } else {
        // Try to find location patterns in metadata
        const metadataElements = card.querySelectorAll('span, li, div');
        for (const el of metadataElements) {
          const text = el.textContent.trim();
          // Look for location patterns (city, state, country, remote)
          if (text.match(/(Remote|On-site|Hybrid|United States|Canada|UK|Europe|Asia)/i) || 
              text.match(/^[A-Z][a-z]+,\s*[A-Z]{2}$/) || // City, State format
              text.match(/^[A-Z][a-z]+$/)) { // Single city name
            location = text;
            break;
          }
        }
      }
      
      // Try multiple methods to extract date
      let datePosted = 'Unknown';
      const dateElement = findElement(SELECTORS.jobDate, card);
      if (dateElement) {
        datePosted = dateElement.textContent.trim();
        // Try to get datetime attribute if it's a time element
        const datetime = dateElement.getAttribute('datetime');
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
          } catch (e) {
            // Keep original text
          }
        }
      } else {
        // Try to find date patterns in text
        const cardText = card.textContent || '';
        const dateMatch = cardText.match(/(\d+\s+(day|week|month)s?\s+ago|Just now|Today|Yesterday)/i);
        if (dateMatch) datePosted = dateMatch[1];
      }
      
      const jobData = {
        link: jobLink,
        id: jobId,
        title,
        company,
        location,
        datePosted
      };
      
      // Debug logging
      if (company === 'Unknown' || location === 'Unknown' || datePosted === 'Unknown') {
        console.log('Job card extraction - some fields missing:', {
          title,
          company,
          location,
          datePosted,
          cardHtml: card.outerHTML.substring(0, 200)
        });
      }
      
      jobLinks.push(jobData);
    } catch (error) {
      console.error('Error extracting job card:', error);
    }
  }
  
  // For each job, navigate to detail page and extract full description
  for (const jobInfo of jobLinks) {
    try {
      // Navigate to job detail
      const result = await getJobDescription(jobInfo.link);
      
      // Use extracted data from detail page if search results data is missing
      let finalCompany = jobInfo.company;
      let finalLocation = jobInfo.location;
      let finalDate = jobInfo.datePosted;
      
      if (result.extractors) {
        // Always try to get better data from detail page
        const detailCompany = result.extractors.getCompany();
        const detailLocation = result.extractors.getLocation();
        const detailDate = result.extractors.getDate();
        
        if (detailCompany && (finalCompany === 'Unknown' || !finalCompany)) {
          finalCompany = detailCompany;
        }
        if (detailLocation && (finalLocation === 'Unknown' || !finalLocation)) {
          finalLocation = detailLocation;
        }
        if (detailDate && (finalDate === 'Unknown' || !finalDate)) {
          finalDate = detailDate;
        }
      }
      
      const finalJobInfo = {
        ...jobInfo,
        description: result.description || '',
        company: finalCompany || 'Unknown',
        location: finalLocation || 'Unknown',
        datePosted: finalDate || 'Unknown'
      };
      
      // Debug logging for final data
      if (finalJobInfo.company === 'Unknown' || finalJobInfo.location === 'Unknown') {
        console.log('Final job info after detail page extraction:', {
          title: finalJobInfo.title,
          company: finalJobInfo.company,
          location: finalJobInfo.location,
          datePosted: finalJobInfo.datePosted,
          hasDescription: !!finalJobInfo.description
        });
      }
      
      jobs.push(finalJobInfo);
      
      // Random delay between job fetches
      await sleep(randomDelay(1500, 3000));
    } catch (error) {
      console.error(`Error fetching description for ${jobInfo.link}:`, error);
      // Still add job without description
      jobs.push(jobInfo);
    }
  }
  
  return jobs;
}

// Get full job description and extract missing metadata from detail page
async function getJobDescription(jobUrl) {
  // Use fetch to get the page content (same origin)
  try {
    const response = await fetch(jobUrl);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract description
    let description = '';
    const descSelectors = Array.isArray(SELECTORS.jobDetailDescription) 
      ? SELECTORS.jobDetailDescription 
      : [SELECTORS.jobDetailDescription];
    
    for (const selector of descSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        description = element.textContent.trim();
        break;
      }
    }
    
    return {
      description: description,
      // Return metadata extractors for use in main function
      extractors: {
        getCompany: () => {
          const companySelectors = Array.isArray(SELECTORS.jobDetailCompany)
            ? SELECTORS.jobDetailCompany
            : [SELECTORS.jobDetailCompany];
          for (const selector of companySelectors) {
            const element = doc.querySelector(selector);
            if (element) return element.textContent.trim();
          }
          return null;
        },
        getLocation: () => {
          const locationSelectors = Array.isArray(SELECTORS.jobDetailLocation)
            ? SELECTORS.jobDetailLocation
            : [SELECTORS.jobDetailLocation];
          for (const selector of locationSelectors) {
            const element = doc.querySelector(selector);
            if (element) return element.textContent.trim();
          }
          return null;
        },
        getDate: () => {
          const dateSelectors = Array.isArray(SELECTORS.jobDetailDate)
            ? SELECTORS.jobDetailDate
            : [SELECTORS.jobDetailDate];
          for (const selector of dateSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
              const text = element.textContent.trim();
              // Try to get datetime attribute if it's a time element
              const datetime = element.getAttribute('datetime');
              return datetime || text;
            }
          }
          return null;
        }
      }
    };
  } catch (error) {
    console.error('Error fetching job description:', error);
    return { description: '', extractors: null };
  }
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

