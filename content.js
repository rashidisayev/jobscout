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
    '.scaffold-layout__list-item'
  ],
  jobTitle: [
    '.job-search-card__title-link',
    'a.job-search-card__title-link',
    'h3 a',
    '.base-search-card__title a'
  ],
  jobCompany: [
    '.job-search-card__subtitle-link',
    'a.job-search-card__subtitle-link',
    '.job-search-card__subtitle',
    '.base-search-card__subtitle'
  ],
  jobLocation: [
    '.job-search-card__metadata-item',
    '.job-search-card__metadata',
    '.base-search-card__metadata'
  ],
  jobDate: [
    '.job-search-card__listdate',
    '.job-search-card__listdate--new',
    'time'
  ],
  jobLink: [
    '.job-search-card__title-link',
    'a.job-search-card__title-link',
    'h3 a',
    '.base-search-card__title a'
  ],
  
  // Job detail page
  jobDetailTitle: '.jobs-details-top-card__job-title',
  jobDetailCompany: '.jobs-details-top-card__company-name',
  jobDetailLocation: '.jobs-details-top-card__bullet',
  jobDetailDescription: '.jobs-description__text',
  jobDetailDate: '.jobs-details-top-card__job-insight',
  
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
      const companyElement = findElement(SELECTORS.jobCompany, card);
      const company = companyElement ? companyElement.textContent.trim() : 'Unknown';
      const locationElement = findElement(SELECTORS.jobLocation, card);
      const location = locationElement ? locationElement.textContent.trim() : 'Unknown';
      const dateElement = findElement(SELECTORS.jobDate, card);
      const datePosted = dateElement ? dateElement.textContent.trim() : 'Unknown';
      
      jobLinks.push({
        link: jobLink,
        id: jobId,
        title,
        company,
        location,
        datePosted
      });
    } catch (error) {
      console.error('Error extracting job card:', error);
    }
  }
  
  // For each job, navigate to detail page and extract full description
  for (const jobInfo of jobLinks) {
    try {
      // Navigate to job detail
      const fullDescription = await getJobDescription(jobInfo.link);
      
      jobs.push({
        ...jobInfo,
        description: fullDescription
      });
      
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

// Get full job description by navigating to detail page
async function getJobDescription(jobUrl) {
  // Use fetch to get the page content (same origin)
  try {
    const response = await fetch(jobUrl);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Try to find description
    const descElement = doc.querySelector(SELECTORS.jobDetailDescription);
    if (descElement) {
      return descElement.textContent.trim();
    }
    
    // Fallback: try alternative selectors
    const altSelectors = [
      '.jobs-description-content__text',
      '.jobs-box__html-content',
      '[data-test-id="job-details-description"]'
    ];
    
    for (const selector of altSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        return element.textContent.trim();
      }
    }
    
    return '';
  } catch (error) {
    console.error('Error fetching job description:', error);
    return '';
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

