// Shared LinkedIn job description extraction logic
// Used by content.js, background.js, and options.js

// LinkedIn navigation/header keywords to exclude
const NAV_KEYWORDS = [
  'skip to search', 'skip to main content', 'keyboard shortcuts', 'close jump menu',
  'new feed updates', 'notifications', 'home', 'my network', 'jobs', 'messaging',
  'for business', 'advertise', 'me', 'search', 'sign in', 'join now', 'sign up',
  'linkedin', 'navigation', 'menu', 'header', 'footer', 'sidebar'
];

/**
 * Check if an element is likely a navigation element
 * @param {Element} element
 * @returns {boolean}
 */
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

/**
 * Remove dangerous nodes from a DOM element
 * @param {Element} root
 */
function removeDangerousNodes(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
}

/**
 * Extract job description content from a document
 * @param {Document} doc - The document to extract from
 * @returns {string} HTML content of the job description
 */
export function extractDescriptionContent(doc) {
  console.log('[extractDescriptionContent] ===== STARTING EXTRACTION =====');
  console.log('[extractDescriptionContent] doc:', doc);
  console.log('[extractDescriptionContent] doc.body exists:', !!doc.body);
  console.log('[extractDescriptionContent] doc.body text length:', doc.body?.textContent?.length || 0);
  console.log('[extractDescriptionContent] doc.URL:', doc.URL || doc.location?.href || 'unknown');
  console.log('[extractDescriptionContent] doc.querySelectorAll("article").length:', doc.querySelectorAll('article').length);
  console.log('[extractDescriptionContent] doc.querySelectorAll("div").length:', doc.querySelectorAll('div').length);
  
  // Strategy 1: Look for JSON-LD with JobPosting type
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    console.log('[extractDescriptionContent] Found JSON-LD scripts:', scripts.length);
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        let jobPosting = null;

        if (data['@type'] === 'JobPosting' || data['@type'] === 'http://schema.org/JobPosting') {
          jobPosting = data;
        } else if (Array.isArray(data['@graph'])) {
          jobPosting = data['@graph'].find(item =>
            item['@type'] === 'JobPosting' || item['@type'] === 'http://schema.org/JobPosting'
          );
        } else if (data.mainEntity && (data.mainEntity['@type'] === 'JobPosting' || data.mainEntity['@type'] === 'http://schema.org/JobPosting')) {
          jobPosting = data.mainEntity;
        }

        if (jobPosting && jobPosting.description) {
          const desc = jobPosting.description;
          // Basic check for length after stripping HTML to avoid short/irrelevant snippets
          const tempDiv = doc.createElement('div');
          tempDiv.innerHTML = desc;
          if ((tempDiv.textContent || tempDiv.innerText || '').trim().length > 100) {
            console.log('[extractDescriptionContent] Found from JSON-LD');
            return desc; // Return the original HTML from JSON-LD
          }
        }
      } catch (e) {
        // Invalid JSON, continue
      }
    }
  } catch (e) {
    console.warn('[extractDescriptionContent] Error parsing JSON-LD:', e);
  }
  
  // Strategy 1b: Look for embedded JSON data in script tags (fallback)
  const scripts = doc.querySelectorAll('script:not([src])');
  for (const script of scripts) {
    try {
      const text = script.textContent || '';
      if (text.includes('description') || text.includes('jobDescription') || text.includes('about')) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          const desc = data.description || data.jobDescription || data.about || 
                       data['@graph']?.find(item => item.description)?.description ||
                       data.mainEntity?.description;
          if (desc && typeof desc === 'string' && desc.length > 100) {
            console.log('[extractDescriptionContent] Found from embedded JSON');
            return `<p>${desc.replace(/\n/g, '</p><p>')}</p>`;
          }
        }
      }
    } catch (e) {
      // Not valid JSON, continue
    }
  }
  
  // Strategy 2: Meta tags
  try {
    const metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    if (metaDescription && metaDescription.length > 100) {
      console.log('[extractDescriptionContent] Found from meta[name="description"]');
      return `<p>${metaDescription}</p>`;
    }
    const ogDescription = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    if (ogDescription && ogDescription.length > 100) {
      console.log('[extractDescriptionContent] Found from meta[property="og:description"]');
      return `<p>${ogDescription}</p>`;
    }
  } catch (e) {
    console.warn('[extractDescriptionContent] Error parsing meta tags:', e);
  }
  
  // Strategy 2b: Look for data attributes
  const dataElements = doc.querySelectorAll('[data-description], [data-job-description], [data-content]');
  for (const el of dataElements) {
    const desc = el.getAttribute('data-description') || 
                 el.getAttribute('data-job-description') || 
                 el.getAttribute('data-content');
    if (desc && desc.length > 100) {
      console.log('[extractDescriptionContent] Found from data attribute');
      return desc;
    }
  }
  
  // Strategy 3: Search for "About the job" or similar headings
  const allHeadings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"], [class*="header"], span, div, p');
  
  for (const heading of allHeadings) {
    if (isNavigationElement(heading)) continue;
    
    const headingText = heading.textContent?.trim() || '';
    const headingLower = headingText.toLowerCase();
    
    if (NAV_KEYWORDS.some(kw => headingLower.includes(kw))) continue;
    
    const isAboutHeading = headingText.toLowerCase().includes('about') && 
                          (headingText.toLowerCase().includes('job') || 
                           headingText.toLowerCase().includes('position') ||
                           headingText.toLowerCase().includes('role') ||
                           headingText.length < 20);
    
    if (isAboutHeading || 
        headingText.match(/^about$/i) ||
        headingText.match(/job\s+description/i) ||
        headingText.match(/^description$/i) ||
        headingText.match(/overview/i)) {
      
      // Strategy 3a: Find parent container with substantial content
      let current = heading;
      let bestContainer = null;
      let bestTextLength = 0;
      
      for (let depth = 0; depth < 10 && current && current !== doc.body; depth++) {
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
                                text.toLowerCase().includes('experience') ||
                                text.toLowerCase().includes('skills') ||
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
        removeDangerousNodes(clone);
        const inner = clone.innerHTML?.trim() || '';
        
        const innerLower = inner.toLowerCase();
        const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
        if (inner.length > 100 && navCount < 3) {
          return inner;
        }
      }
      
      // Strategy 3b: Get following siblings
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
          if (siblingText.length > 50 && 
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
          removeDangerousNodes(clone);
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
  
  // Strategy 4: Try standard CSS selectors
  const selectors = [
    'article.jobs-description__container',
    'div.description',
    '[data-test-description]',
    '.jobs-description__text',
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '[data-test-id="job-details-description"]',
    '.jobs-description__text-container',
    'section[data-test-id="job-details-section"]',
    'div[data-test-id="job-details-section"]',
    'section.jobs-description__section',
    'div.jobs-description__section'
  ];
  
  console.log('[extractDescriptionContent] Trying CSS selectors, count:', selectors.length);
  for (const selector of selectors) {
    try {
      const element = doc.querySelector(selector);
      console.log(`[extractDescriptionContent] Selector "${selector}":`, element ? 'found' : 'not found');
      if (!element) continue;
      
      const clone = element.cloneNode(true);
      removeDangerousNodes(clone);
      let inner = clone.innerHTML?.trim() || '';
      if (!inner) {
        const text = clone.textContent?.trim();
        console.log(`[extractDescriptionContent] Selector "${selector}" text length:`, text?.length || 0);
        if (text && text.length > 50) {
          inner = `<p>${text}</p>`;
        }
      }
      console.log(`[extractDescriptionContent] Selector "${selector}" inner length:`, inner.length);
      if (inner.length > 100) {
        console.log(`[extractDescriptionContent] Found using selector: ${selector}`);
        return inner;
      }
    } catch (e) {
      console.error(`[extractDescriptionContent] Error with selector "${selector}":`, e);
      // Invalid selector, continue
    }
  }
  
  console.log('[extractDescriptionContent] No description found using any strategy.');
  console.log('[extractDescriptionContent] Final check - doc.body.innerHTML length:', doc.body?.innerHTML?.length || 0);
  console.log('[extractDescriptionContent] Returning empty string');
  
  // Return empty string (not null) to indicate no description found
  return '';
  
  // Strategy 5: Find largest text block
  const candidates = doc.querySelectorAll('div, section, article, main');
  let bestCandidate = null;
  let bestScore = 0;
  
  for (const candidate of candidates) {
    if (isNavigationElement(candidate)) continue;
    
    const text = candidate.textContent?.trim() || '';
    const textLower = text.toLowerCase();
    const navKeywordCount = NAV_KEYWORDS.filter(kw => textLower.includes(kw)).length;
    if (navKeywordCount > 3) continue;
    
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
    clone.querySelectorAll('nav, header, [class*="nav"], [class*="header"], [id*="nav"], [id*="header"]').forEach(node => node.remove());
    removeDangerousNodes(clone);
    const inner = clone.innerHTML?.trim() || '';
    
    const innerLower = inner.toLowerCase();
    const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
    if (inner.length > 100 && navCount < 3) {
      return inner;
    }
  }
  
  // Strategy 6: Look for description-related classes
  const descClasses = doc.querySelectorAll('[class*="description"], [class*="content"], [class*="body"], [class*="text"], [class*="detail"]');
  for (const el of descClasses) {
    if (isNavigationElement(el)) continue;
    
    const text = el.textContent?.trim() || '';
    const textLower = text.toLowerCase();
    if (NAV_KEYWORDS.some(kw => textLower.includes(kw)) && text.length < 200) continue;
    
    if (text.length > 300) {
      const clone = el.cloneNode(true);
      removeDangerousNodes(clone);
      const inner = clone.innerHTML?.trim() || '';
      
      const innerLower = inner.toLowerCase();
      const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
      if (inner.length > 100 && navCount < 3) {
        return inner;
      }
    }
  }
  
  return '';
}

/**
 * Extract metadata from job detail page
 * @param {Document} doc
 * @returns {{getTitle: function, getCompany: function, getLocation: function, getDate: function}}
 */
export function createMetadataExtractors(doc) {
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
      // Newer LinkedIn unified job details header
      '.job-details-jobs-unified-top-card__tertiary-description-container',
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis',
      '.job-details-jobs-unified-top-card__tertiary-description-container [class*="tvm__text"]',
      '[class*="unified-top-card"] [class*="tertiary-description"]',
      '[class*="unified-top-card"] .tvm__text--low-emphasis',
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
  
  const getTitle = () => {
    for (const selector of SELECTORS.jobDetailTitle) {
      const el = doc.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    const h1 = doc.querySelector('h1');
    return h1 ? h1.textContent?.trim() : null;
  };
  
  const getCompany = () => {
    const falsePositives = new Set(['Page', 'View', 'Apply', 'Save', 'Share', 'More', 'Less', 'LinkedIn', 'Jobs']);
    const isValidCompany = (text) => {
      if (!text || text.length < 2 || text.length > 50) return false;
      if (falsePositives.has(text.trim())) return false;
      if (text.match(/^(Page|View|Apply|Save|Share|More|Less|\d+)$/i)) return false;
      return /^[A-Z]/.test(text.trim());
    };
    
    for (const selector of SELECTORS.jobDetailCompany) {
      const el = doc.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        if (isValidCompany(text)) return text;
      }
    }
    
    const companyLinks = doc.querySelectorAll('a[href*="/company/"]');
    for (const link of companyLinks) {
      const text = link.textContent.trim();
      if (isValidCompany(text)) return text;
    }
    
    return null;
  };
  
  const getLocation = () => {
    for (const selector of SELECTORS.jobDetailLocation) {
      const el = doc.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }
    }
    return null;
  };
  
  const getDate = () => {
    const extractRelativeDate = (raw) => {
      if (!raw) return null;
      const text = String(raw)
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/^[\s·•|–—\-:,]+/g, '')
        .trim();
      const match = text.match(/(\d+\s*(?:second|minute|hour|day|week|month)s?\s*ago|today|yesterday|just\s*now)/i);
      return match ? match[1].trim() : null;
    };

    for (const selector of SELECTORS.jobDetailDate) {
      const el = doc.querySelector(selector);
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
            if (text) return text;
          }
        } else if (text) {
          const relative = extractRelativeDate(text);
          if (relative) return relative;
          const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
          if (dateMatch && dateMatch[1]) {
            const cleaned = extractRelativeDate(dateMatch[1]) || dateMatch[1].trim();
            return cleaned;
          }
          return text;
        }
      }
    }
    
    // Fallback: look for all time elements
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
          const text = el.textContent?.trim();
          if (text) {
            const relative = extractRelativeDate(text);
            if (relative) return relative;
            const dateMatch = text.match(/(?:reposted|posted)\s+(.+)/i);
            if (dateMatch && dateMatch[1]) {
              const cleaned = extractRelativeDate(dateMatch[1]) || dateMatch[1].trim();
              return cleaned;
            }
            return text;
          }
        }
      }
    }
    
    return null;
  };
  
  return { getTitle, getCompany, getLocation, getDate };
}


