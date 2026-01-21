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
function stripVerificationSuffix(title) {
  if (!title || typeof title !== 'string') return title;
  return title
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*(?:[•·\-—–|]\s*)?with\s+verification\s*$/i, '')
    .trim();
}

export function extractTitle(card, jsonLd = null) {
  // Priority 1: JSON-LD
  if (jsonLd && jsonLd.title) {
    console.log('[extractTitle] Found from JSON-LD');
    return stripVerificationSuffix(jsonLd.title.trim());
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
        return stripVerificationSuffix(text);
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
          return stripVerificationSuffix(text);
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
      return stripVerificationSuffix(text);
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
 * Extract date posted - returns human-readable format
 * @param {Element} card - The job card element
 * @param {Object} jsonLd - Optional JSON-LD data
 * @returns {string|null} Human-readable date or null if unknown
 */
export function extractDatePosted(card, jsonLd = null) {
  // Helper to convert datetime to human-readable
  const datetimeToReadable = (datetime) => {
    try {
      const date = new Date(datetime);
      if (isNaN(date.getTime())) return null;
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffMins < 60) return diffMins <= 1 ? 'Just now' : `${diffMins} minutes ago`;
      if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return '1 day ago';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
      }
      const months = Math.floor(diffDays / 30);
      return months === 1 ? '1 month ago' : `${months} months ago`;
    } catch (e) {
      return null;
    }
  };

  // Helper to clean date text
  const cleanDateText = (text) => {
    if (!text) return null;
    text = text.trim();
    // Remove leading separators (·, •, |, -, etc.) and whitespace
    text = text.replace(/^[\s·•|–—\-:,]+/g, '').trim();
    // Remove "Reposted" or "Posted" prefix
    text = text.replace(/^(reposted|posted)\s*/i, '').trim();
    // Remove any remaining leading separators after "Reposted/Posted"
    text = text.replace(/^[\s·•|–—\-:,]+/g, '').trim();
    // Extract the date pattern if text contains other content
    const dateMatch = text.match(/(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)/i);
    if (dateMatch) {
      return dateMatch[1].trim();
    }
    return null;
  };

  // Helper to check if text is a location (not a date)
  const isLocationText = (text) => {
    if (!text) return false;
    return text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|United Kingdom|Europe|Asia|Australia|Germany|France|Spain|Italy|New York|San Francisco|Los Angeles|Chicago|Boston|Seattle|Austin|Denver|Atlanta|London|Toronto|Vancouver|Sydney|Melbourne|Berlin|Vienna|Austria)/i) ||
           text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/) ||
           text.match(/^\d+\s*(applicants?|views?|applications?)$/i);
  };

  // Priority 1: JSON-LD - convert to human-readable format
  if (jsonLd && jsonLd.datePosted) {
    const readable = datetimeToReadable(jsonLd.datePosted);
    if (readable) {
      console.log('[extractDatePosted] Found from JSON-LD:', readable);
      return readable;
    }
  }
  
  // Priority 2: time[datetime] elements - most reliable
  const timeElementsWithDatetime = card.querySelectorAll('time[datetime]');
  for (const timeEl of timeElementsWithDatetime) {
    const datetime = timeEl.getAttribute('datetime');
    if (datetime) {
      const readable = datetimeToReadable(datetime);
      if (readable) {
        console.log('[extractDatePosted] Found from time[datetime]:', readable);
        return readable;
      }
    }
  }
  
  // Priority 3: time elements text content (even without datetime attribute)
  const allTimeElements = card.querySelectorAll('time');
  for (const timeEl of allTimeElements) {
    const text = timeEl.textContent?.trim();
    if (text) {
      const cleaned = cleanDateText(text);
      if (cleaned) {
        console.log('[extractDatePosted] Found from time element text:', cleaned);
        return cleaned;
      }
    }
  }
  
  // Priority 4: aria-label attributes (LinkedIn uses these for accessibility)
  const elementsWithAriaLabel = card.querySelectorAll('[aria-label]');
  for (const el of elementsWithAriaLabel) {
    const ariaLabel = el.getAttribute('aria-label') || '';
    if (ariaLabel.match(/\b(ago|posted|reposted|today|yesterday)\b/i)) {
      const cleaned = cleanDateText(ariaLabel);
      if (cleaned) {
        console.log('[extractDatePosted] Found from aria-label:', cleaned);
        return cleaned;
      }
    }
  }
  
  // Priority 5: List items in the card (LinkedIn often uses <li> for metadata)
  const listItems = card.querySelectorAll('li');
  for (const li of listItems) {
    const text = li.textContent?.trim();
    if (text && text.length < 150) {
      const cleaned = cleanDateText(text);
      if (cleaned) {
        console.log('[extractDatePosted] Found from li element:', cleaned);
        return cleaned;
      }
    }
  }
  
  // Priority 6: Comprehensive CSS selectors for date elements
  const dateSelectors = [
    // LinkedIn's current (2024-2026) job card date selectors
    '.tvm__text--low-emphasis',
    '[class*="tvm__text"]',
    '.job-details-jobs-unified-top-card__tertiary-description-container span',
    '[class*="tertiary-description"] span',
    '[class*="unified-top-card"] span',
    // Specific date-related selectors
    '[class*="listdate"]',
    '[class*="listed-date"]',
    '[class*="posted-date"]',
    '[class*="posted_date"]',
    '[class*="post-date"]',
    '[class*="date-posted"]',
    '[data-testid*="posted"]',
    '[data-testid*="date"]',
    '[data-test-id*="posted"]',
    '[data-test-id*="date"]',
    // LinkedIn-specific selectors
    '.job-search-card__listdate',
    '.job-search-card__listdate--new',
    '.job-card-container__listed-date',
    '.base-search-card__metadata-item',
    '.job-search-card__metadata-item',
    '.job-card-container__metadata-item',
    // Generic metadata
    '[class*="metadata"]',
    '[class*="footer"]',
    '[class*="info"]'
  ];
  
  for (const selector of dateSelectors) {
    try {
      const elements = card.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 200) {
          const cleaned = cleanDateText(text);
          if (cleaned) {
            console.log(`[extractDatePosted] Found from selector ${selector}:`, cleaned);
            return cleaned;
          }
        }
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }
  
  // Priority 7: Spans (LinkedIn uses many spans for text)
  const spans = card.querySelectorAll('span');
  for (const span of spans) {
    // Get direct text content (not including nested elements)
    const directText = Array.from(span.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .trim();
    
    if (directText && directText.length > 0 && directText.length < 80) {
      if (directText.match(/\b(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)\b/i)) {
        const cleaned = cleanDateText(directText);
        if (cleaned) {
          console.log('[extractDatePosted] Found from span direct text:', cleaned);
          return cleaned;
        }
      }
    }
    
    // Also check full text content for short spans
    const fullText = span.textContent?.trim();
    if (fullText && fullText.length > 0 && fullText.length < 100) {
      if (fullText.match(/\b(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)\b/i)) {
        const cleaned = cleanDateText(fullText);
        if (cleaned) {
          console.log('[extractDatePosted] Found from span text:', cleaned);
          return cleaned;
        }
      }
    }
  }
  
  // Priority 8: Search all text nodes in the card for date patterns
  const dateRegex = /\b(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)\b/i;
  const allElements = card.querySelectorAll('*');
  
  for (const el of allElements) {
    // Skip elements that are likely navigation/interactive
    if (['BUTTON', 'A', 'NAV', 'SCRIPT', 'STYLE', 'SVG', 'IMG'].includes(el.tagName)) continue;
    
    const text = el.textContent?.trim();
    if (!text || text.length === 0 || text.length > 150) continue;
    
    const match = text.match(dateRegex);
    if (match) {
      // Check if this element's text is mostly just the date (not a long description)
      if (text.length < 80) {
        const cleaned = cleanDateText(text);
        if (cleaned) {
          console.log('[extractDatePosted] Found from element text scan:', cleaned);
          return cleaned;
        }
      }
    }
  }
  
  // Priority 9: Check for "Reposted" or "Posted" text patterns anywhere
  const fullCardText = card.textContent || '';
  const repostedMatch = fullCardText.match(/(?:reposted|posted)\s*(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)/i);
  if (repostedMatch) {
    const cleaned = repostedMatch[1].trim();
    console.log('[extractDatePosted] Found from card text pattern:', cleaned);
    return cleaned;
  }
  
  // Priority 10: Direct date pattern in card text
  const directDateMatch = fullCardText.match(/\b(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago)\b/i);
  if (directDateMatch) {
    // Verify it's not part of job requirements like "3 years of experience"
    const matchedText = directDateMatch[1];
    if (!matchedText.match(/year/i)) {
      console.log('[extractDatePosted] Found from direct card text:', matchedText);
      return matchedText;
    }
  }
  
  // Debug: Log when extraction fails
  console.group('[extractDatePosted] No date found - Debug info:');
  
  const timeEls = card.querySelectorAll('time');
  console.log('Time elements found:', timeEls.length);
  if (timeEls.length > 0) {
    Array.from(timeEls).forEach((el, i) => {
      console.log(`  Time ${i}:`, {
        text: el.textContent?.trim(),
        datetime: el.getAttribute('datetime'),
        ariaLabel: el.getAttribute('aria-label'),
        class: el.className
      });
    });
  }
  
  const listEls = card.querySelectorAll('li');
  console.log('Li elements found:', listEls.length);
  if (listEls.length > 0) {
    Array.from(listEls).slice(0, 5).forEach((el, i) => {
      console.log(`  Li ${i}:`, el.textContent?.trim().substring(0, 100));
    });
  }
  
  // Log ALL text snippets from the card that contain date-like keywords
  const dateKeywords = ['ago', 'posted', 'reposted', 'today', 'yesterday', 'week', 'day', 'month', 'hour', 'minute'];
  const foundKeywords = [];
  
  Array.from(allElements).forEach(el => {
    const text = el.textContent?.trim() || '';
    if (text.length > 0 && text.length < 150) {
      for (const keyword of dateKeywords) {
        if (text.toLowerCase().includes(keyword)) {
          foundKeywords.push({
            keyword,
            text: text.substring(0, 100),
            tagName: el.tagName,
            className: el.className?.substring?.(0, 50) || ''
          });
          break;
        }
      }
    }
  });
  
  console.log('Elements with date keywords:', foundKeywords.slice(0, 10));
  console.log('Card text preview:', fullCardText.substring(0, 500));
  
  console.groupEnd();
  
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


