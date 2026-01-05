// Enhanced job data extraction utilities
// Handles JSON-LD, meta tags, and DOM-based extraction with robust fallbacks

/**
 * Extract JSON-LD structured data from document
 * @param {Document} doc
 * @returns {Object|null}
 */
export function extractJsonLd(doc) {
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        // Look for JobPosting schema
        if (data['@type'] === 'JobPosting' || data['@type'] === 'http://schema.org/JobPosting') {
          return data;
        }
        // Check if it's in @graph array
        if (Array.isArray(data['@graph'])) {
          const jobPosting = data['@graph'].find(item => 
            item['@type'] === 'JobPosting' || item['@type'] === 'http://schema.org/JobPosting'
          );
          if (jobPosting) return jobPosting;
        }
        // Check mainEntity
        if (data.mainEntity && (data.mainEntity['@type'] === 'JobPosting' || data.mainEntity['@type'] === 'http://schema.org/JobPosting')) {
          return data.mainEntity;
        }
      } catch (e) {
        // Invalid JSON, continue
      }
    }
  } catch (e) {
    // Error parsing, return null
  }
  return null;
}

/**
 * Extract title from job card with deduplication
 * @param {Element} card - The job card element
 * @param {Object} jsonLd - Optional JSON-LD data
 * @returns {string}
 */
export function extractTitle(card, jsonLd = null) {
  // Priority 1: JSON-LD
  if (jsonLd && jsonLd.title) {
    console.log('[extractTitle] Found from JSON-LD');
    return jsonLd.title.trim();
  }
  
  // Priority 2: Most specific selectors within card
  const specificSelectors = [
    'a.job-search-card__title-link',
    '.job-search-card__title-link',
    'a[data-tracking-control-name="job-card-title"]',
    '.base-search-card__title a',
    '.job-card-list__title a'
  ];
  
  for (const selector of specificSelectors) {
    const element = card.querySelector(selector);
    if (element) {
      const text = element.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        console.log(`[extractTitle] Found from selector: ${selector}`);
        return text;
      }
    }
  }
  
  // Priority 3: Generic selectors (but ensure it's within card)
  const genericSelectors = ['h3 a', 'h3', '.base-search-card__title'];
  for (const selector of genericSelectors) {
    const element = card.querySelector(selector);
    if (element && card.contains(element)) {
      const text = element.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        // Verify it's not a duplicate by checking if it's the link text
        const link = card.querySelector('a[href*="/jobs/view/"]');
        if (link && link.textContent.trim() === text) {
          console.log(`[extractTitle] Found from generic selector: ${selector}`);
          return text;
        }
      }
    }
  }
  
  // Priority 4: Link text as last resort
  const link = card.querySelector('a[href*="/jobs/view/"]');
  if (link) {
    const text = link.textContent?.trim();
    if (text && text.length > 0) {
      console.log('[extractTitle] Found from link text');
      return text;
    }
  }
  
  console.warn('[extractTitle] No title found');
  return 'Unknown';
}

/**
 * Extract company name with robust fallbacks
 * @param {Element} card - The job card element
 * @param {Object} jsonLd - Optional JSON-LD data
 * @param {string} title - The job title (for sanity check)
 * @returns {string}
 */
export function extractCompany(card, jsonLd = null, title = '') {
  // Priority 1: JSON-LD
  if (jsonLd && jsonLd.hiringOrganization) {
    const orgName = jsonLd.hiringOrganization.name || 
                    (typeof jsonLd.hiringOrganization === 'string' ? jsonLd.hiringOrganization : null);
    if (orgName) {
      const company = orgName.trim();
      // Sanity check: ensure it's not the title
      if (company !== title && company.length > 0 && company.length < 100) {
        console.log('[extractCompany] Found from JSON-LD');
        return company;
      }
    }
  }
  
  // Priority 2: Company-specific selectors
  const companySelectors = [
    'a.job-search-card__subtitle-link',
    '.job-search-card__subtitle-link',
    'a[data-tracking-control-name="job-card-company"]',
    '.job-card-container__company-name',
    'h4.base-search-card__subtitle a',
    'h4.base-search-card__subtitle',
    '.base-search-card__subtitle'
  ];
  
  const falsePositives = new Set([
    'Page', 'View', 'Apply', 'Save', 'Share', 'More', 'Less', 'Show', 'Hide',
    'LinkedIn', 'Jobs', 'Search', 'Filter', 'Sort', 'Results', 'Next', 'Previous',
    'Today', 'Yesterday', 'Remote', 'On-site', 'Hybrid', 'Full-time', 'Part-time',
    'Contract', 'Internship', 'Temporary', 'Permanent'
  ]);
  
  const isValidCompany = (text) => {
    if (!text || text.length < 2 || text.length > 100) return false;
    if (falsePositives.has(text.trim())) return false;
    if (text.match(/^(Page|View|Apply|Save|Share|More|Less|\d+)$/i)) return false;
    if (text.match(/^(the|and|or|but|for|with|from|this|that|these|those)$/i)) return false;
    if (!/^[A-Z]/.test(text.trim())) return false;
    // Sanity check: not the same as title
    if (title && text.trim().toLowerCase() === title.trim().toLowerCase()) return false;
    return true;
  };
  
  for (const selector of companySelectors) {
    const element = card.querySelector(selector);
    if (element) {
      const text = element.textContent?.trim();
      if (isValidCompany(text)) {
        console.log(`[extractCompany] Found from selector: ${selector}`);
        return text;
      }
    }
  }
  
  // Priority 3: Company links
  const companyLinks = card.querySelectorAll('a[href*="/company/"]');
  for (const link of companyLinks) {
    const text = link.textContent?.trim();
    if (isValidCompany(text)) {
      console.log('[extractCompany] Found from company link');
      return text;
    }
  }
  
  // Priority 4: Meta tags (if available)
  if (card.ownerDocument) {
    const metaCompany = card.ownerDocument.querySelector('meta[property="og:site_name"], meta[name="company"]');
    if (metaCompany) {
      const text = metaCompany.getAttribute('content') || metaCompany.getAttribute('value');
      if (isValidCompany(text)) {
        console.log('[extractCompany] Found from meta tag');
        return text;
      }
    }
  }
  
  // Priority 5: Pattern matching in card text
  const cardText = card.textContent || '';
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
        console.log('[extractCompany] Found from pattern matching');
        return candidate;
      }
    }
  }
  
  console.warn('[extractCompany] No company found');
  return 'Unknown';
}

/**
 * Extract date posted with ISO date format
 * @param {Element} card - The job card element
 * @param {Object} jsonLd - Optional JSON-LD data
 * @returns {string|null} ISO date (YYYY-MM-DD) or null if unknown
 */
export function extractDatePosted(card, jsonLd = null) {
  // Priority 1: JSON-LD
  if (jsonLd && jsonLd.datePosted) {
    try {
      const date = new Date(jsonLd.datePosted);
      if (!isNaN(date.getTime())) {
        const isoDate = date.toISOString().split('T')[0];
        console.log('[extractDatePosted] Found from JSON-LD:', isoDate);
        return isoDate;
      }
    } catch (e) {
      // Invalid date, continue
    }
  }
  
  // Priority 2: time[datetime] elements
  const timeElements = card.querySelectorAll('time[datetime]');
  for (const timeEl of timeElements) {
    const datetime = timeEl.getAttribute('datetime');
    if (datetime) {
      try {
        const date = new Date(datetime);
        if (!isNaN(date.getTime())) {
          const isoDate = date.toISOString().split('T')[0];
          console.log('[extractDatePosted] Found from time[datetime]:', isoDate);
          return isoDate;
        }
      } catch (e) {
        // Invalid date, continue
      }
    }
  }
  
  // Priority 3: Meta tags
  if (card.ownerDocument) {
    const metaDate = card.ownerDocument.querySelector(
      'meta[property="article:published_time"], meta[name="date"], meta[property="og:updated_time"]'
    );
    if (metaDate) {
      const dateStr = metaDate.getAttribute('content') || metaDate.getAttribute('value');
      if (dateStr) {
        try {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            const isoDate = date.toISOString().split('T')[0];
            console.log('[extractDatePosted] Found from meta tag:', isoDate);
            return isoDate;
          }
        } catch (e) {
          // Invalid date, continue
        }
      }
    }
  }
  
  // Priority 4: Text pattern matching
  const dateSelectors = [
    'span.white-space-pre',
    '.white-space-pre',
    '.job-search-card__listdate',
    '.job-search-card__listdate--new',
    '.job-card-container__listed-date',
    'span[data-testid="job-posted-date"]',
    '.job-search-card__metadata-item',
    '.base-search-card__metadata-item'
  ];
  
  const datePatterns = [
    /(?:reposted|posted)\s+(\d+\s+(?:day|week|month|hour|minute)s?\s+ago)/i,
    /(?:reposted|posted)\s+(today|yesterday|just\s+now)/i,
    /(\d+\s+(?:day|week|month|hour|minute)s?\s+ago)/i,
    /(today|yesterday|just\s+now)/i
  ];
  
  for (const selector of dateSelectors) {
    const element = card.querySelector(selector);
    if (element) {
      const text = element.textContent?.trim();
      if (text) {
        // Try to parse relative dates
        const now = new Date();
        let date = null;
        
        if (text.toLowerCase().includes('today') || text.toLowerCase().includes('just now')) {
          date = now;
        } else if (text.toLowerCase().includes('yesterday')) {
          date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else {
          // Try to extract "X days/weeks/months ago"
          for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
              const matchText = match[1] || match[0];
              const daysMatch = matchText.match(/(\d+)\s+days?\s+ago/i);
              const weeksMatch = matchText.match(/(\d+)\s+weeks?\s+ago/i);
              const monthsMatch = matchText.match(/(\d+)\s+months?\s+ago/i);
              
              if (daysMatch) {
                date = new Date(now.getTime() - parseInt(daysMatch[1]) * 24 * 60 * 60 * 1000);
              } else if (weeksMatch) {
                date = new Date(now.getTime() - parseInt(weeksMatch[1]) * 7 * 24 * 60 * 60 * 1000);
              } else if (monthsMatch) {
                date = new Date(now.getTime() - parseInt(monthsMatch[1]) * 30 * 24 * 60 * 60 * 1000);
              }
              break;
            }
          }
        }
        
        if (date && !isNaN(date.getTime())) {
          const isoDate = date.toISOString().split('T')[0];
          console.log('[extractDatePosted] Found from text pattern:', isoDate);
          return isoDate;
        }
      }
    }
  }
  
  console.warn('[extractDatePosted] No date found');
  return null;
}

/**
 * Extract job description with robust fallbacks
 * @param {Document} doc - The document
 * @param {Object} jsonLd - Optional JSON-LD data
 * @returns {string|null}
 */
export function extractDescription(doc, jsonLd = null) {
  // Priority 1: JSON-LD
  if (jsonLd && jsonLd.description) {
    let desc = jsonLd.description;
    // Handle HTML in description
    if (typeof desc === 'string') {
      // Remove HTML tags if present
      const tempDiv = doc.createElement('div');
      tempDiv.innerHTML = desc;
      desc = tempDiv.textContent || tempDiv.innerText || desc;
      desc = desc.trim();
      if (desc.length > 50) {
        console.log('[extractDescription] Found from JSON-LD');
        return desc;
      }
    }
  }
  
  // Priority 2: Meta tags
  const metaDesc = doc.querySelector('meta[name="description"], meta[property="og:description"]');
  if (metaDesc) {
    const desc = metaDesc.getAttribute('content') || metaDesc.getAttribute('value');
    if (desc && desc.trim().length > 50) {
      console.log('[extractDescription] Found from meta tag');
      return desc.trim();
    }
  }
  
  // Priority 3: Use shared description extractor
  try {
    // Try to import the shared extractor if available
    if (typeof window !== 'undefined' && window.chrome && chrome.runtime) {
      // This will be handled by the calling code
      return null; // Signal to use DOM-based extraction
    }
  } catch (e) {
    // Not in extension context, continue
  }
  
  // Priority 4: Common description containers
  const descSelectors = [
    'article.jobs-description__container',
    '.jobs-description__text',
    '.jobs-description-content__text',
    '[data-test-description]',
    '.jobs-box__html-content',
    '[data-test-id="job-details-description"]'
  ];
  
  for (const selector of descSelectors) {
    const element = doc.querySelector(selector);
    if (element) {
      const text = element.textContent?.trim() || element.innerText?.trim();
      if (text && text.length > 50) {
        console.log(`[extractDescription] Found from selector: ${selector}`);
        return text;
      }
    }
  }
  
  // Priority 5: Fallback to main/article body text
  const main = doc.querySelector('main, article, [role="main"]');
  if (main) {
    const text = main.textContent?.trim() || main.innerText?.trim();
    if (text && text.length > 200) {
      // Limit to reasonable length
      const limited = text.substring(0, 5000);
      console.log('[extractDescription] Found from main/article body');
      return limited;
    }
  }
  
  console.warn('[extractDescription] No description found');
  return null;
}


