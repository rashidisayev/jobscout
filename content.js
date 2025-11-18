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
    'span[data-testid="job-posted-date"]',
    '.job-search-card__metadata-item time',
    '.base-search-card__metadata time',
    '.job-card-container__metadata-item time',
    'li[data-testid="job-posted-date"]',
    '.jobs-search-results__list-item time',
    'span.job-search-card__listdate',
    'div.job-search-card__listdate',
    '[class*="listdate"]',
    '[class*="listed-date"]',
    '[class*="posted-date"]'
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
      
      // Common false positives to filter out
      const falsePositives = new Set([
        'Page', 'View', 'Apply', 'Save', 'Share', 'More', 'Less', 'Show', 'Hide',
        'LinkedIn', 'Jobs', 'Search', 'Filter', 'Sort', 'Results', 'Next', 'Previous',
        'Today', 'Yesterday', 'Remote', 'On-site', 'Hybrid', 'Full-time', 'Part-time',
        'Contract', 'Internship', 'Temporary', 'Permanent', 'United States', 'USA',
        'Canada', 'UK', 'Europe', 'Asia', 'Location', 'Company', 'Date', 'Posted'
      ]);
      
      const isValidCompany = (text) => {
        if (!text || text.length < 2 || text.length > 50) return false;
        // Filter out false positives
        if (falsePositives.has(text.trim())) return false;
        // Filter out common UI elements
        if (text.match(/^(Page|View|Apply|Save|Share|More|Less|\d+)$/i)) return false;
        // Filter out single words that are too common
        if (text.match(/^(the|and|or|but|for|with|from|this|that|these|those)$/i)) return false;
        // Should start with capital letter (company names usually do)
        if (!/^[A-Z]/.test(text.trim())) return false;
        return true;
      };
      
      const companyElement = findElement(SELECTORS.jobCompany, card);
      if (companyElement) {
        const extracted = companyElement.textContent.trim();
        if (isValidCompany(extracted)) {
          company = extracted;
        }
      }
      
      // If still unknown, try more aggressive extraction
      if (company === 'Unknown' || !isValidCompany(company)) {
        // Try all links in the card that might be company
        const allLinks = card.querySelectorAll('a');
        for (const link of allLinks) {
          const href = link.href || '';
          const text = link.textContent.trim();
          // Company links often have /company/ in URL
          if (href.includes('/company/') && isValidCompany(text)) {
            company = text;
            break;
          }
          // Or check if it's a reasonable company name (not a button/link text)
          if (isValidCompany(text) && 
              !text.includes('View') && !text.includes('Apply') &&
              !text.includes('Save') && !text.includes('Share') &&
              !href.includes('/jobs/') && !href.includes('/search/')) {
            company = text;
            break;
          }
        }
        
        // Try to find company in card text
        if (company === 'Unknown' || !isValidCompany(company)) {
          const cardText = card.textContent || '';
          // Look for patterns like "at CompanyName" or "CompanyName ·"
          const patterns = [
            /at\s+([A-Z][a-zA-Z0-9\s&.,-]+?)(?:\s+·|\s+•|$)/,
            /([A-Z][a-zA-Z0-9\s&.,-]+?)\s+·/,
            /Company:\s*([A-Z][a-zA-Z0-9\s&.,-]+)/i
          ];
          for (const pattern of patterns) {
            const match = cardText.match(pattern);
            if (match && match[1]) {
              const candidate = match[1].trim();
              if (isValidCompany(candidate)) {
                company = candidate;
                break;
              }
            }
          }
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
      
      // Try multiple methods to extract date
      let datePosted = 'Unknown';
      
      // First, try all date selectors
      const dateElement = findElement(SELECTORS.jobDate, card);
      if (dateElement) {
        let dateText = dateElement.textContent.trim();
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
            // Fall back to text content
            if (dateText) datePosted = dateText;
          }
        } else if (dateText) {
          datePosted = dateText;
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
              const text = timeEl.textContent.trim();
              if (text) {
                datePosted = text;
                break;
              }
            }
          }
        }
      }
      
      // If still unknown, try to find date patterns in text
      if (datePosted === 'Unknown') {
        const cardText = card.textContent || '';
        const cardInnerText = card.innerText || '';
        const allText = cardText + ' ' + cardInnerText;
        
        // More comprehensive date patterns
        const datePatterns = [
          /(\d+\s+(day|week|month|hour|minute)s?\s+ago)/i,
          /(Just\s+now|Today|Yesterday)/i,
          /(Posted\s+(\d+\s+(day|week|month)s?\s+ago))/i,
          /(Posted\s+(Just\s+now|Today|Yesterday))/i,
          /(\d+d\s+ago|\d+w\s+ago|\d+m\s+ago)/i, // Short formats like "3d ago"
          /(Active\s+(\d+\s+(day|week|month)s?\s+ago))/i
        ];
        
        for (const pattern of datePatterns) {
          const match = allText.match(pattern);
          if (match) {
            datePosted = match[1] || match[0];
            break;
          }
        }
      }
      
      // If still unknown, look through all metadata elements
      if (datePosted === 'Unknown') {
        const metadataElements = card.querySelectorAll('.job-search-card__metadata-item, .base-search-card__metadata, .job-card-container__metadata-item, li, span');
        for (const el of metadataElements) {
          const text = el.textContent.trim();
          if (!text || text.length > 50) continue;
          
          // Check if it looks like a date
          if (text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday|\d+d\s+ago|\d+w\s+ago)/i)) {
            datePosted = text;
            break;
          }
        }
      }
      
      // If we still have unknowns, try extracting from card's full text structure
      if (company === 'Unknown' || location === 'Unknown' || datePosted === 'Unknown') {
        const cardText = card.innerText || card.textContent || '';
        const cardHTML = card.innerHTML || '';
        
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
      
      // Create job data object with final extracted values
      const jobData = {
        link: jobLink,
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
  
  // For each job, navigate to detail page and extract full description
  // Note: We'll extract from detail pages, but this requires navigation
  // For now, let's improve the card extraction and use detail page as fallback
  for (const jobInfo of jobLinks) {
    try {
      // Try to get data from detail page
      const result = await getJobDescription(jobInfo.link);
      
      // Use extracted data from detail page, prioritizing detail page data
      let finalCompany = jobInfo.company;
      let finalLocation = jobInfo.location;
      let finalDate = jobInfo.datePosted;
      
      if (result.extractors) {
        // Always prefer detail page data if available
        const detailCompany = result.extractors.getCompany();
        const detailLocation = result.extractors.getLocation();
        const detailDate = result.extractors.getDate();
        
        if (detailCompany) {
          finalCompany = detailCompany;
        }
        if (detailLocation) {
          finalLocation = detailLocation;
        }
        if (detailDate) {
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
      console.log('Job extracted:', {
        title: finalJobInfo.title,
        company: finalJobInfo.company,
        location: finalJobInfo.location,
        datePosted: finalJobInfo.datePosted,
        hasDescription: !!finalJobInfo.description,
        descriptionLength: finalJobInfo.description?.length || 0
      });
      
      jobs.push(finalJobInfo);
      
      // Random delay between job fetches
      await sleep(randomDelay(2000, 4000));
    } catch (error) {
      console.error(`Error fetching description for ${jobInfo.link}:`, error);
      // Still add job with whatever data we have
      jobs.push(jobInfo);
    }
  }
  
  return jobs;
}

// Get full job description and extract missing metadata from detail page
async function getJobDescription(jobUrl) {
  // Use fetch to get the page content (same origin)
  // Note: LinkedIn may serve content via JavaScript, so this might not get everything
  try {
    const response = await fetch(jobUrl, {
      headers: {
        'Accept': 'text/html',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    if (!response.ok) {
      console.warn(`Failed to fetch ${jobUrl}: ${response.status}`);
      return { description: '', extractors: null };
    }
    
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
        if (description.length > 50) break; // Need meaningful description
      }
    }
    
    // Extract company with multiple fallbacks
    const getCompany = () => {
      const falsePositives = new Set(['Page', 'View', 'Apply', 'Save', 'Share', 'More', 'Less', 'LinkedIn', 'Jobs']);
      const isValidCompany = (text) => {
        if (!text || text.length < 2 || text.length > 50) return false;
        if (falsePositives.has(text.trim())) return false;
        if (text.match(/^(Page|View|Apply|Save|Share|More|Less|\d+)$/i)) return false;
        return /^[A-Z]/.test(text.trim());
      };
      
      const companySelectors = Array.isArray(SELECTORS.jobDetailCompany)
        ? SELECTORS.jobDetailCompany
        : [SELECTORS.jobDetailCompany];
      for (const selector of companySelectors) {
        const element = doc.querySelector(selector);
        if (element) {
          const text = element.textContent.trim();
          if (isValidCompany(text)) return text;
        }
      }
      // Fallback: look for company links
      const companyLinks = doc.querySelectorAll('a[href*="/company/"]');
      for (const link of companyLinks) {
        const text = link.textContent.trim();
        if (isValidCompany(text)) return text;
      }
      // Fallback: try to find in page text
      const pageText = doc.body.textContent || '';
      const patterns = [
        /Company[:\s]+([A-Z][a-zA-Z0-9\s&.,-]+)/i,
        /at\s+([A-Z][a-zA-Z0-9\s&.,-]+?)(?:\s+·|\s+•|$)/,
        /([A-Z][a-zA-Z0-9\s&.,-]+?)\s+·\s*[A-Z]/
      ];
      for (const pattern of patterns) {
        const match = pageText.match(pattern);
        if (match && match[1]) {
          const candidate = match[1].trim();
          if (isValidCompany(candidate)) {
            return candidate;
          }
        }
      }
      return null;
    };
    
    // Extract location with multiple fallbacks
    const getLocation = () => {
      const locationSelectors = Array.isArray(SELECTORS.jobDetailLocation)
        ? SELECTORS.jobDetailLocation
        : [SELECTORS.jobDetailLocation];
      for (const selector of locationSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
          const text = element.textContent.trim();
          if (text) return text;
        }
      }
      // Fallback: look for location patterns in all elements
      const allElements = doc.querySelectorAll('li, span, div, p');
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (!text || text.length > 100) continue;
        if (text.match(/(Remote|On-site|Hybrid|Work from home|WFH)/i) ||
            text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/) ||
            text.match(/^(United States|USA|Canada|UK|United Kingdom|Europe|Asia|Australia)$/i)) {
          return text;
        }
      }
      return null;
    };
    
    // Extract date with multiple fallbacks
    const getDate = () => {
      // First try all date selectors
      const dateSelectors = Array.isArray(SELECTORS.jobDetailDate)
        ? SELECTORS.jobDetailDate
        : [SELECTORS.jobDetailDate];
      for (const selector of dateSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
          const text = element.textContent.trim();
          const datetime = element.getAttribute('datetime');
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
          }
          if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
            return text;
          }
        }
      }
      
      // Fallback: look for all time elements with datetime
      const timeElements = doc.querySelectorAll('time[datetime]');
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
            const text = el.textContent.trim();
            if (text) return text;
          }
        }
      }
      
      // Fallback: look for all time elements (even without datetime)
      const allTimeElements = doc.querySelectorAll('time');
      for (const el of allTimeElements) {
        const text = el.textContent.trim();
        if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
          return text;
        }
      }
      
      // Fallback: look for date patterns in page text
      const pageText = doc.body.textContent || '';
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
      const insightElements = doc.querySelectorAll('.jobs-details-top-card__job-insight, .jobs-details-top-card__job-insight-text-item, li');
      for (const el of insightElements) {
        const text = el.textContent.trim();
        if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Just\s+now|Today|Yesterday)/i)) {
          return text;
        }
      }
      
      return null;
    };
    
    return {
      description: description,
      extractors: {
        getCompany: getCompany,
        getLocation: getLocation,
        getDate: getDate
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

