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
  // Priority 1: JSON-LD - convert to human-readable format
  if (jsonLd && jsonLd.datePosted) {
    try {
      const date = new Date(jsonLd.datePosted);
      if (!isNaN(date.getTime())) {
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        let readable;
        if (diffDays === 0) readable = 'Today';
        else if (diffDays === 1) readable = '1 day ago';
        else if (diffDays < 7) readable = `${diffDays} days ago`;
        else if (diffDays < 30) readable = `${Math.floor(diffDays / 7)} weeks ago`;
        else readable = `${Math.floor(diffDays / 30)} months ago`;
        console.log('[extractDatePosted] Found from JSON-LD:', readable);
        return readable;
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
          const now = new Date();
          const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
          let readable;
          if (diffDays === 0) readable = 'Today';
          else if (diffDays === 1) readable = '1 day ago';
          else if (diffDays < 7) readable = `${diffDays} days ago`;
          else if (diffDays < 30) readable = `${Math.floor(diffDays / 7)} weeks ago`;
          else readable = `${Math.floor(diffDays / 30)} months ago`;
          console.log('[extractDatePosted] Found from time[datetime]:', readable);
          return readable;
        }
      } catch (e) {
        // Invalid date, try getting text content
        const text = timeEl.textContent?.trim();
        if (text && text.length > 0 && text.length < 100) {
          console.log('[extractDatePosted] Found from time element text:', text);
          return text;
        }
      }
    } else {
      // No datetime attribute, try text content
      const text = timeEl.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        // Clean up "Reposted X ago" or "Posted X ago" format
        const cleaned = text.replace(/^(reposted|posted)\s+/i, '').trim();
        if (cleaned && cleaned.match(/\b(ago|today|yesterday|just now)\b/i)) {
          console.log('[extractDatePosted] Found from time element text:', cleaned);
          return cleaned;
        }
      }
    }
  }
  
  // Priority 3: Text pattern matching with comprehensive selectors
  const dateSelectors = [
    'time',
    'span.white-space-pre',
    '.white-space-pre',
    'span[class*="white-space-pre"]',
    '[class*="white-space-pre"]',
    '.job-search-card__listdate',
    '.job-search-card__listdate--new',
    '.job-card-container__listed-date',
    'span[data-testid="job-posted-date"]',
    'li[data-testid="job-posted-date"]',
    '[data-testid="job-posted-date"]',
    '[data-test-id="job-posted-date"]',
    '.job-search-card__metadata-item',
    '.base-search-card__metadata-item',
    '.job-card-container__metadata-item',
    '[class*="listdate"]',
    '[class*="listed-date"]',
    '[class*="posted-date"]',
    '[class*="metadata"]'
  ];
  
  const datePatterns = [
    /\b(\d+\s+(?:day|week|month|hour|minute)s?\s+ago)\b/i,
    /\b(today|yesterday|just\s+now)\b/i,
    /\b(reposted|posted)\s+(\d+\s+(?:day|week|month|hour|minute)s?\s+ago)\b/i,
    /\b(reposted|posted)\s+(today|yesterday|just\s+now)\b/i
  ];
  
  // Check all date-related elements
  for (const selector of dateSelectors) {
    const elements = card.querySelectorAll(selector);
    for (const element of elements) {
      let text = element.textContent?.trim() || '';
      if (!text || text.length === 0 || text.length > 100) continue;
      
      // Check if it looks like a date (contains date keywords)
      if (text.match(/\b(ago|day|days|week|weeks|month|months|hour|hours|minute|minutes|today|yesterday|just|now|posted|active|reposted)\b/i)) {
        // Exclude location patterns
        const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia)/i) ||
                          text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*[A-Z]{2}$/);
        
        if (!isLocation) {
          // Clean up "Reposted X ago" or "Posted X ago" format
          const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
          if (dateMatch && dateMatch[1]) {
            const cleaned = dateMatch[1].trim();
            if (cleaned.length > 0 && cleaned.length < 50) {
              console.log('[extractDatePosted] Found from pattern (cleaned):', cleaned);
              return cleaned;
            }
          } else if (text.match(/\b(ago|today|yesterday|just now)\b/i)) {
            // Direct date text without "posted"/"reposted" prefix
            console.log('[extractDatePosted] Found from pattern:', text);
            return text;
          }
        }
      }
    }
  }
  
  // Priority 4: Check parent/sibling elements of white-space-pre spans
  const whiteSpaceElements = card.querySelectorAll('span.white-space-pre, .white-space-pre, span[class*="white-space-pre"]');
  for (const el of whiteSpaceElements) {
    // Check parent element
    const parent = el.parentElement;
    if (parent) {
      const parentText = parent.textContent?.trim() || '';
      if (parentText && parentText.length > 0 && parentText.length < 100) {
        if (parentText.match(/\b(ago|today|yesterday|posted|reposted)\b/i)) {
          const isLocation = parentText.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia)/i);
          if (!isLocation) {
            const dateMatch = parentText.match(/(?:reposted|posted)\s+(.+)/i);
            if (dateMatch && dateMatch[1]) {
              const cleaned = dateMatch[1].trim();
              if (cleaned.length > 0 && cleaned.length < 50) {
                console.log('[extractDatePosted] Found from parent element:', cleaned);
                return cleaned;
              }
            }
          }
        }
      }
    }
    
    // Check next sibling
    const nextSibling = el.nextElementSibling;
    if (nextSibling) {
      const siblingText = nextSibling.textContent?.trim() || '';
      if (siblingText && siblingText.length > 0 && siblingText.length < 100) {
        if (siblingText.match(/\b(ago|today|yesterday|posted)\b/i)) {
          const isLocation = siblingText.match(/(Remote|On-site|Hybrid)/i);
          if (!isLocation) {
            console.log('[extractDatePosted] Found from next sibling:', siblingText);
            return siblingText;
          }
        }
      }
    }
  }
  
  // Priority 5: Last resort - scan ALL text in the card for date patterns
  const allElements = card.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.trim() || '';
    // Only check direct text content (not including children)
    if (!text || text.length === 0 || text.length > 200) continue;
    
    // Look for strong date patterns
    const datePatterns = [
      /\b(\d+\s+(?:second|minute|hour|day|week|month)s?\s+ago)\b/i,
      /\b(today|yesterday|just\s+now)\b/i
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        const candidate = match[1].trim();
        // Make sure it's not part of a longer sentence
        if (text.length < 100) {
          // Exclude location-like text
          const isLocation = text.match(/(Remote|On-site|Hybrid|United States|USA|Canada|UK|Europe|Asia|City|State|Country)/i);
          if (!isLocation) {
            // Clean up "Posted X ago" format
            const cleaned = text.replace(/^(reposted|posted)\s+/i, '').trim();
            if (cleaned.match(/\b(ago|today|yesterday)\b/i) && cleaned.length < 50) {
              console.log('[extractDatePosted] Found from last resort scan:', cleaned);
              return cleaned;
            }
          }
        }
      }
    }
  }
  
  // Debug: Log all potential date elements found
  console.group('[extractDatePosted] No date found - Debug info:');
  
  const timeEls = card.querySelectorAll('time');
  console.log('Time elements found:', timeEls.length);
  if (timeEls.length > 0) {
    Array.from(timeEls).forEach((el, i) => {
      console.log(`  Time ${i}:`, {
        text: el.textContent?.trim(),
        datetime: el.getAttribute('datetime'),
        class: el.className,
        innerHTML: el.innerHTML.substring(0, 100)
      });
    });
  }
  
  const whiteSpaceEls = card.querySelectorAll('span.white-space-pre, .white-space-pre, [class*="white-space"]');
  console.log('White-space elements found:', whiteSpaceEls.length);
  if (whiteSpaceEls.length > 0) {
    Array.from(whiteSpaceEls).slice(0, 5).forEach((el, i) => {
      console.log(`  WhiteSpace ${i}:`, el.textContent?.trim());
    });
  }
  
  const metadataEls = card.querySelectorAll('[class*="metadata"]');
  console.log('Metadata elements found:', metadataEls.length);
  if (metadataEls.length > 0) {
    Array.from(metadataEls).slice(0, 5).forEach((el, i) => {
      console.log(`  Metadata ${i}:`, {
        text: el.textContent?.trim(),
        class: el.className
      });
    });
  }
  
  // Log ALL text snippets from the card that contain date-like keywords
  console.log('Searching for date keywords in card...');
  const allTextElements = card.querySelectorAll('*');
  const dateKeywords = ['ago', 'posted', 'reposted', 'today', 'yesterday', 'week', 'day', 'month'];
  const foundKeywords = [];
  
  Array.from(allTextElements).forEach(el => {
    const text = el.textContent?.trim() || '';
    if (text.length > 0 && text.length < 150) {
      for (const keyword of dateKeywords) {
        if (text.toLowerCase().includes(keyword)) {
          foundKeywords.push({
            keyword,
            text,
            tagName: el.tagName,
            className: el.className
          });
          break; // Only add once per element
        }
      }
    }
  });
  
  console.log('Elements with date keywords:', foundKeywords.slice(0, 10));
  
  // Log the card's HTML structure (first 1000 chars)
  console.log('Card HTML preview:', card.innerHTML.substring(0, 1000));
  
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


