// Options page script for JobScout

import { getJobById } from './scripts/storage.js';
import { sanitizeHtml } from './scripts/utils.js';

const DESCRIPTION_SELECTORS = [
  'article.jobs-description__container',
  'div.description',
  '[data-test-description]',
  '.jobs-description__text',
  '.jobs-description-content__text',
  '.jobs-box__html-content',
  '[data-test-id="job-details-description"]',
  '.jobs-description__text-container'
];

let modal = null;
let modalTitle = null;
let modalMeta = null;
let modalBody = null;
let modalViewBtn = null;
let modalFetchBtn = null;
let activeJobId = null;

document.addEventListener('DOMContentLoaded', async () => {
  modal = document.getElementById('job-modal');
  modalTitle = document.getElementById('modal-title');
  modalMeta = document.getElementById('modal-meta');
  modalBody = document.getElementById('modal-body');
  modalViewBtn = document.getElementById('modal-view');
  modalFetchBtn = document.getElementById('modal-fetch');
  
  initializeTabs();
  await loadSearchUrls();
  await loadResumes();
  await loadSettings();
  await loadResults();
  await updateLiveScanStatus();
  
  // Event listeners
  document.getElementById('addSearchUrl').addEventListener('click', addSearchUrl);
  document.getElementById('newSearchUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addSearchUrl();
  });
  
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('clearAllJobs').addEventListener('click', clearAllJobs);
  document.getElementById('sortBy').addEventListener('change', loadResults);
  document.getElementById('filterText').addEventListener('input', loadResults);
  
  // Listen for storage changes to update live status
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const runStateKeys = ['scanRunStatus', 'scanPagesProcessed', 'scanJobsScanned', 'scanNewJobs'];
      const hasRunStateChange = runStateKeys.some(key => changes[key]);
      
      if (hasRunStateChange) {
        updateLiveScanStatus();
      }
      
      // Update results if jobs changed
      if (changes.jobs) {
        loadResults();
      }
    }
  });
  
  // Update live status periodically
  setInterval(updateLiveScanStatus, 2000); // Every 2 seconds
  
  const closeBtn = document.getElementById('modal-close');
  if (closeBtn && modal) {
    closeBtn.onclick = () => hideModal();
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideModal();
      }
    });
  }
  
  if (modalFetchBtn) {
    modalFetchBtn.addEventListener('click', async () => {
      if (activeJobId) {
        await fetchDescriptionForJob(activeJobId);
      }
    });
  }
});

// Tab switching
function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      
      // Update buttons
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update contents
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${targetTab}-tab`) {
          content.classList.add('active');
        }
      });
    });
  });
}

// Search URLs management
async function loadSearchUrls() {
  const settings = await chrome.storage.local.get(['searchUrls']);
  const urls = settings.searchUrls || [];
  const listDiv = document.getElementById('searchUrlsList');
  
  if (urls.length === 0) {
    listDiv.innerHTML = '<div class="empty-state"><p>No search URLs added yet.</p></div>';
    return;
  }
  
  listDiv.innerHTML = urls.map((url, index) => `
    <div class="list-item">
      <div class="list-item-content" title="${url}">${url}</div>
      <button class="btn btn-danger" onclick="removeSearchUrl(${index})">Remove</button>
    </div>
  `).join('');
}

async function addSearchUrl() {
  const input = document.getElementById('newSearchUrl');
  const url = input.value.trim();
  
  if (!url) {
    alert('Please enter a valid URL');
    return;
  }
  
  if (!url.startsWith('https://www.linkedin.com/jobs/')) {
    alert('Please enter a valid LinkedIn Jobs URL');
    return;
  }
  
  const settings = await chrome.storage.local.get(['searchUrls']);
  const urls = settings.searchUrls || [];
  
  if (urls.length >= 10) {
    alert('Maximum 10 search URLs allowed');
    return;
  }
  
  if (urls.includes(url)) {
    alert('This URL is already added');
    return;
  }
  
  urls.push(url);
  await chrome.storage.local.set({ searchUrls: urls });
  input.value = '';
  await loadSearchUrls();
}

async function removeSearchUrl(index) {
  const settings = await chrome.storage.local.get(['searchUrls']);
  const urls = settings.searchUrls || [];
  urls.splice(index, 1);
  await chrome.storage.local.set({ searchUrls: urls });
  await loadSearchUrls();
}

// Resume management
async function loadResumes() {
  const settings = await chrome.storage.local.get(['resumes']);
  const resumes = settings.resumes || [];
  const gridDiv = document.getElementById('resumesList');
  
  gridDiv.innerHTML = '';
  
  for (let i = 0; i < 5; i++) {
    const resume = resumes[i];
    const card = document.createElement('div');
    card.className = `resume-card ${resume ? 'has-resume' : ''}`;
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.docx,.txt';
    fileInput.id = `resume-${i}`;
    fileInput.addEventListener('change', (e) => handleResumeUpload(e, i));
    
    const label = document.createElement('label');
    label.htmlFor = `resume-${i}`;
    label.textContent = resume ? 'Replace Resume' : 'Upload Resume';
    
    card.appendChild(fileInput);
    card.appendChild(label);
    
    if (resume) {
      const info = document.createElement('div');
      info.className = 'resume-info';
      info.innerHTML = `
        <strong>${resume.filename}</strong>
        <span>${formatFileSize(resume.size)}</span>
        <span>${resume.wordCount} words</span>
        <span>Updated: ${formatDate(resume.updatedAt)}</span>
      `;
      card.appendChild(info);
      
      const actions = document.createElement('div');
      actions.className = 'resume-actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = () => deleteResume(i);
      actions.appendChild(deleteBtn);
      card.appendChild(actions);
    }
    
    gridDiv.appendChild(card);
  }
}

async function handleResumeUpload(event, index) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (file.size > 10 * 1024 * 1024) { // 10MB limit
    alert('File size must be less than 10MB');
    return;
  }
  
  try {
    const parserModule = await import('./scripts/parser.js');
    const text = await parserModule.parseResume(file);
    
    const settings = await chrome.storage.local.get(['resumes']);
    const resumes = settings.resumes || [];
    
    resumes[index] = {
      filename: file.name,
      size: file.size,
      text: text,
      wordCount: text.split(/\s+/).length,
      updatedAt: Date.now()
    };
    
    await chrome.storage.local.set({ resumes: resumes });
    await loadResumes();
  } catch (error) {
    console.error('Error parsing resume:', error);
    alert('Error parsing resume. Please try again.');
  }
}

async function deleteResume(index) {
  if (!confirm('Are you sure you want to delete this resume?')) return;
  
  const settings = await chrome.storage.local.get(['resumes']);
  const resumes = settings.resumes || [];
  resumes.splice(index, 1);
  await chrome.storage.local.set({ resumes: resumes });
  await loadResumes();
}

// Settings management
async function loadSettings() {
  const settings = await chrome.storage.local.get(['scanInterval', 'onlyNewRoles']);
  document.getElementById('scanInterval').value = settings.scanInterval || 60;
  document.getElementById('onlyNewRoles').checked = settings.onlyNewRoles !== false;
}

async function saveSettings() {
  const scanInterval = parseInt(document.getElementById('scanInterval').value);
  const onlyNewRoles = document.getElementById('onlyNewRoles').checked;
  
  if (scanInterval < 15 || scanInterval > 1440) {
    alert('Scan interval must be between 15 and 1440 minutes');
    return;
  }
  
  await chrome.storage.local.set({
    scanInterval: scanInterval,
    onlyNewRoles: onlyNewRoles
  });
  
  // Update alarm
  chrome.alarms.clear('scan');
  chrome.alarms.create('scan', { periodInMinutes: scanInterval });
  
  alert('Settings saved!');
}

// Results display
async function loadResults() {
  const settings = await chrome.storage.local.get(['jobs']);
  let jobs = settings.jobs || [];
  
  // Filter
  const filterText = document.getElementById('filterText').value.toLowerCase();
  if (filterText) {
    jobs = jobs.filter(job => 
      job.title?.toLowerCase().includes(filterText) ||
      job.company?.toLowerCase().includes(filterText) ||
      job.location?.toLowerCase().includes(filterText)
    );
  }
  
  // Sort
  const sortBy = document.getElementById('sortBy').value;
  jobs.sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return (b.foundAt || 0) - (a.foundAt || 0);
      case 'score':
        return ((b.matchScore ?? b.score) || 0) - ((a.matchScore ?? a.score) || 0);
      case 'company':
        return (a.company || '').localeCompare(b.company || '');
      default:
        return 0;
    }
  });
  
  displayResults(jobs);
}

function displayResults(jobs) {
  const tableDiv = document.getElementById('resultsTable');
  
  if (jobs.length === 0) {
    tableDiv.innerHTML = '<div class="empty-state"><p>No jobs found. Run a scan to collect jobs.</p></div>';
    return;
  }
  
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Title</th>
        <th>Company</th>
        <th>Location</th>
        <th>Date Posted</th>
        <th>Best Resume</th>
        <th>
          Score
          <span class="score-help-icon" id="scoreHelpIcon" title="Click for score information">?</span>
        </th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  
  jobs.forEach(job => {
    const row = document.createElement('tr');
    
    const titleCell = document.createElement('td');
    titleCell.textContent = job.title || 'N/A';
    
    const companyCell = document.createElement('td');
    companyCell.textContent = job.company && job.company !== 'Unknown' ? job.company : 'N/A';
    
    const locationCell = document.createElement('td');
    locationCell.textContent = job.location && job.location !== 'Unknown' ? job.location : 'N/A';
    
    const dateCell = document.createElement('td');
    dateCell.textContent = job.datePosted && job.datePosted !== 'Unknown' ? job.datePosted : 'N/A';
    
    const resumeCell = document.createElement('td');
    resumeCell.textContent = job.bestResume || 'N/A';
    
    const scoreCell = document.createElement('td');
    const scoreValue = job.matchScore ?? job.score;
    if (scoreValue !== undefined && scoreValue !== null) {
      const scorePercent = scoreValue * 100;
      const scoreClass = getScoreClass(scoreValue);
      const scoreColor = getScoreColor(scorePercent);
      const badge = document.createElement('span');
      badge.className = `score-badge ${scoreClass}`;
      badge.dataset.score = scoreValue;
      badge.textContent = scorePercent.toFixed(1);
      badge.style.backgroundColor = `${scoreColor.bg}`;
      badge.style.color = `${scoreColor.text}`;
      badge.style.border = 'none';
      scoreCell.appendChild(badge);
    } else {
      scoreCell.textContent = 'N/A';
    }
    
    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'job-actions';
    
    const descBtn = document.createElement('button');
    descBtn.textContent = 'See description';
    descBtn.className = 'btn btn-primary';
    if (job.id) {
      descBtn.addEventListener('click', () => onSeeDescription(job.id));
    } else {
      descBtn.disabled = true;
    }
    
    actions.append(descBtn);
    actionsCell.appendChild(actions);
    
    row.append(
      titleCell,
      companyCell,
      locationCell,
      dateCell,
      resumeCell,
      scoreCell,
      actionsCell
    );
    
    tbody.appendChild(row);
  });
  
  tableDiv.innerHTML = '';
  tableDiv.appendChild(table);
  
  const helpIcon = document.getElementById('scoreHelpIcon');
  if (helpIcon) {
    helpIcon.addEventListener('click', showScoreInfoModal);
  }
}

export async function onSeeDescription(jobId) {
  if (!jobId) return;
  activeJobId = jobId;
  const job = await getJobById(jobId);
  if (!job) {
    alert('Unable to load job details. Please refresh.');
    return;
  }
  populateModal(job);
  showModal();
}

function populateModal(job) {
  if (!modal || !modalTitle || !modalMeta || !modalBody) return;
  const title = job.title || 'Unknown title';
  const company = job.company && job.company !== 'Unknown' ? job.company : 'Unknown company';
  modalTitle.textContent = `${title} — ${company}`;
  
  const location = job.location && job.location !== 'Unknown' ? job.location : 'Unknown location';
  const date = job.datePosted && job.datePosted !== 'Unknown' ? job.datePosted : 'Unknown date';
  modalMeta.textContent = `${location} · Posted: ${date}`;
  
  if (job.descriptionHtml && job.descriptionHtml.trim().length > 0) {
    modalBody.innerHTML = job.descriptionHtml;
  } else {
    modalBody.innerHTML = '<em>No description captured.</em>';
  }
  
  // Set up Apply button
  if (modalViewBtn) {
    const jobUrl = job.url || job.link;
    if (jobUrl) {
      modalViewBtn.disabled = false;
      modalViewBtn.onclick = () => {
        window.open(jobUrl, '_blank');
      };
    } else {
      modalViewBtn.disabled = true;
      modalViewBtn.onclick = null;
    }
  }
  
  updateModalFetchState(job);
}

function updateModalFetchState(job) {
  if (!modalFetchBtn) return;
  const hasUrl = Boolean(job.url || job.link);
  const shouldShow = (!job.descriptionHtml || job.needsFetch) && hasUrl;
  modalFetchBtn.classList.toggle('hidden', !shouldShow);
  modalFetchBtn.disabled = !shouldShow;
}

function showModal() {
  if (!modal) return;
  modal.classList.remove('hidden');
}

function hideModal() {
  if (!modal) return;
  modal.classList.add('hidden');
  activeJobId = null;
}

async function fetchDescriptionForJob(jobId) {
  if (!jobId || !modalFetchBtn) return;
  const job = await getJobById(jobId);
  const targetUrl = job?.url || job?.link;
  if (!job || !targetUrl) {
    alert('Job URL missing, cannot fetch description.');
    return;
  }
  
  modalFetchBtn.disabled = true;
  modalFetchBtn.textContent = 'Opening page...';
  
  try {
    // Open the job page in a new tab
    const tab = await chrome.tabs.create({
      url: targetUrl,
      active: false
    });
    
    modalFetchBtn.textContent = 'Loading page...';
    
    // Wait for the tab to load completely
    await new Promise((resolve) => {
      const checkTab = async () => {
        try {
          const updatedTab = await chrome.tabs.get(tab.id);
          if (updatedTab.status === 'complete') {
            // Wait additional time for dynamic content to load
            setTimeout(resolve, 3000);
          } else {
            setTimeout(checkTab, 500);
          }
        } catch (error) {
          setTimeout(resolve, 3000);
        }
      };
      checkTab();
    });
    
    modalFetchBtn.textContent = 'Extracting description...';
    
    // Inject script to extract description from the live DOM
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDescriptionFromLivePage
    });
    
    if (!results || !results[0] || !results[0].result) {
      throw new Error('Failed to extract description from page');
    }
    
    const extracted = results[0].result;
    const descriptionHtml = extracted.descriptionHtml ? sanitizeHtml(extracted.descriptionHtml) : '';
    
    if (!descriptionHtml || descriptionHtml.length < 50) {
      throw new Error('No description found on page');
    }
    
    // Close the tab
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      // Tab might already be closed
    }
    
    // Update the job with the extracted description
    const payload = {
      ...job,
      url: targetUrl,
      link: targetUrl,
      descriptionHtml,
      needsFetch: false,
      scrapedAt: Date.now(),
      forceRescan: true
    };
    
    // Also update title, company, location, date if extracted
    if (extracted.extractors) {
      const title = extracted.extractors.getTitle?.();
      const company = extracted.extractors.getCompany?.();
      const location = extracted.extractors.getLocation?.();
      const date = extracted.extractors.getDate?.();
      
      if (title) payload.title = title;
      if (company) payload.company = company;
      if (location) payload.location = location;
      if (date) payload.datePosted = date;
    }
    
    await sendRuntimeMessage({
      action: 'jobResults',
      jobs: [payload],
      forceRescan: true
    });
    
    const updatedJob = await getJobById(jobId);
    if (updatedJob) {
      populateModal(updatedJob);
      modalFetchBtn.textContent = 'Description fetched!';
      setTimeout(() => {
        modalFetchBtn.textContent = 'Fetch description';
      }, 2000);
    }
  } catch (error) {
    console.error('Error fetching job description:', error);
    alert(`Unable to fetch the description: ${error.message}`);
    modalFetchBtn.textContent = 'Fetch description';
  } finally {
    modalFetchBtn.disabled = false;
  }
}

// Function to extract description from live page (runs in page context)
function extractDescriptionFromLivePage() {
  // LinkedIn navigation/header keywords to exclude
  const NAV_KEYWORDS = [
    'skip to search', 'skip to main content', 'keyboard shortcuts', 'close jump menu',
    'new feed updates', 'notifications', 'home', 'my network', 'jobs', 'messaging',
    'for business', 'advertise', 'me', 'search', 'sign in', 'join now', 'sign up',
    'linkedin', 'navigation', 'menu', 'header', 'footer', 'sidebar'
  ];
  
  function isNavigationElement(element) {
    if (!element) return false;
    
    // Check class names
    const classes = (element.className || '').toLowerCase();
    if (classes.includes('nav') || classes.includes('header') || 
        classes.includes('footer') || classes.includes('sidebar') ||
        classes.includes('global-nav') || classes.includes('top-bar') ||
        classes.includes('skip-link') || classes.includes('accessibility')) {
      return true;
    }
    
    // Check ID
    const id = (element.id || '').toLowerCase();
    if (id.includes('nav') || id.includes('header') || id.includes('footer') ||
        id.includes('skip') || id.includes('accessibility')) {
      return true;
    }
    
    // Check text content for navigation keywords
    const text = (element.textContent || '').toLowerCase().trim();
    if (text.length < 100) { // Short text is likely navigation
      for (const keyword of NAV_KEYWORDS) {
        if (text.includes(keyword)) {
          return true;
        }
      }
    }
    
    // Check if it's in a navigation container
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
  
  function extractDescriptionContent(doc) {
    // Find "About the job" heading and get everything under it
    const allHeadings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, span, div, p');
    
    for (const heading of allHeadings) {
      // Skip navigation elements
      if (isNavigationElement(heading)) continue;
      
      const headingText = heading.textContent?.trim() || '';
      
      // Skip if it contains navigation keywords
      const headingLower = headingText.toLowerCase();
      if (NAV_KEYWORDS.some(kw => headingLower.includes(kw))) continue;
      
      const isAboutHeading = headingText.toLowerCase().includes('about') && 
                            (headingText.toLowerCase().includes('job') || 
                             headingText.toLowerCase().includes('position') ||
                             headingText.toLowerCase().includes('role') ||
                             headingText.length < 20);
      
      if (isAboutHeading || 
          headingText.match(/^about$/i) ||
          headingText.match(/job\s+description/i)) {
        
        // Strategy 1: Find parent container with substantial content
        let current = heading;
        let bestContainer = null;
        let bestTextLength = 0;
        
        for (let depth = 0; depth < 10 && current && current !== document.body; depth++) {
          // Skip if parent is navigation
          if (isNavigationElement(current)) {
            current = current.parentElement;
            continue;
          }
          
          const text = current.textContent?.trim() || '';
          
          // Skip if text contains too many navigation keywords
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
          // Remove navigation elements from clone
          clone.querySelectorAll('nav, header, [class*="nav"], [class*="header"], [id*="nav"], [id*="header"]').forEach(node => node.remove());
          clone.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
          const inner = clone.innerHTML?.trim() || '';
          
          // Check if result contains too many navigation keywords
          const innerLower = inner.toLowerCase();
          const navCount = NAV_KEYWORDS.filter(kw => innerLower.includes(kw)).length;
          if (inner.length > 100 && navCount < 3) {
            return inner;
          }
        }
        
        // Strategy 2: Get ALL following siblings until next major heading
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
          // Stop at major headings (H1-H3) unless they're subsections
          if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
            const siblingText = sibling.textContent?.trim() || '';
            const siblingLower = siblingText.toLowerCase();
            // Skip if it's a navigation heading
            if (NAV_KEYWORDS.some(kw => siblingLower.includes(kw))) {
              break;
            }
            if (siblingText.length > 50 && 
                !siblingText.toLowerCase().includes('requirements') &&
                !siblingText.toLowerCase().includes('benefits') &&
                !siblingText.toLowerCase().includes('qualifications')) {
              break; // New major section
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
            clone.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
            parts.push(clone.outerHTML);
            collectedText += text + ' ';
          }
          sibling = sibling.nextElementSibling;
        }
        
        if (parts.length > 0 && collectedText.trim().length > 100) {
          // Final check: make sure collected text doesn't have too many nav keywords
          const collectedLower = collectedText.toLowerCase();
          const navCount = NAV_KEYWORDS.filter(kw => collectedLower.includes(kw)).length;
          if (navCount < 5) { // Allow some nav keywords but not too many
            return parts.join('');
          }
        }
      }
    }
    
    return '';
  }
  
  const rawHtml = extractDescriptionContent(document);
  
  // Extract metadata
  const SELECTORS = {
    jobDetailTitle: [
      '.jobs-details-top-card__job-title',
      'h1.jobs-details-top-card__job-title',
      'h1[data-test-id="job-title"]'
    ],
    jobDetailCompany: [
      '.jobs-details-top-card__company-name',
      'a.jobs-details-top-card__company-name',
      'a[data-tracking-control-name="job-details-company-name"]'
    ],
    jobDetailLocation: [
      '.jobs-details-top-card__bullet',
      '.jobs-details-top-card__primary-description-without-tagline',
      'span[data-testid="job-location"]'
    ],
    jobDetailDate: [
      '.jobs-details-top-card__job-insight',
      'span[data-testid="job-posted-date"]',
      'time[datetime]'
    ]
  };
  
  const getTitle = () => {
    for (const selector of SELECTORS.jobDetailTitle) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent?.trim() : null;
  };
  
  const getCompany = () => {
    for (const selector of SELECTORS.jobDetailCompany) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 50 && /^[A-Z]/.test(text)) {
          return text;
        }
      }
    }
    return null;
  };
  
  const getLocation = () => {
    for (const selector of SELECTORS.jobDetailLocation) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    return null;
  };
  
  const getDate = () => {
    for (const selector of SELECTORS.jobDetailDate) {
      const el = document.querySelector(selector);
      if (el) {
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
          } catch (e) {}
        }
        const text = el.textContent?.trim();
        if (text && text.match(/(\d+\s+(day|week|month)s?\s+ago|Today|Yesterday)/i)) {
          return text;
        }
      }
    }
    return null;
  };
  
  return {
    descriptionHtml: rawHtml,
    extractors: {
      getTitle,
      getCompany,
      getLocation,
      getDate
    }
  };
}

function extractDescriptionFromDocument(doc) {
  // Strategy 1: Look for embedded JSON data in script tags (LinkedIn often embeds data)
  const scripts = doc.querySelectorAll('script[type="application/ld+json"], script:not([src])');
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
  for (const el of dataElements) {
    const desc = el.getAttribute('data-description') || 
                 el.getAttribute('data-job-description') || 
                 el.getAttribute('data-content');
    if (desc && desc.length > 100) {
      return desc;
    }
  }
  
  // Strategy 3: Search for "About the job" or similar headings and get ALL following content
  const allHeadings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"], [class*="header"], span, div, p');
  let aboutHeadingFound = false;
  
  for (const heading of allHeadings) {
    const headingText = heading.textContent?.trim() || '';
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
      
      // Strategy 3a: Find the closest parent section/div that contains substantial content
      let current = heading;
      let bestContainer = null;
      let bestTextLength = 0;
      
      // Walk up the DOM tree to find the best container
      for (let depth = 0; depth < 10 && current && current !== doc.body; depth++) {
        const text = current.textContent?.trim() || '';
        
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
      
      if (bestContainer) {
        const clone = bestContainer.cloneNode(true);
        removeDangerousNodes(clone);
        const inner = clone.innerHTML?.trim() || '';
        if (inner.length > 100) {
          return inner;
        }
      }
      
      // Strategy 3b: Get ALL following siblings until we hit another major heading
      let sibling = heading.nextElementSibling;
      const parts = [];
      let collectedText = '';
      
      while (sibling && parts.length < 50) {
        const tag = sibling.tagName?.toUpperCase() || '';
        // Stop at major headings (but allow h4, h5, h6 which might be subsections)
        if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
          // Check if this is a new major section
          const siblingText = sibling.textContent?.trim() || '';
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
        if (text.length > 10) {
          const clone = sibling.cloneNode(true);
          removeDangerousNodes(clone);
          parts.push(clone.outerHTML);
          collectedText += text + ' ';
        }
        sibling = sibling.nextElementSibling;
      }
      
      if (parts.length > 0 && collectedText.trim().length > 100) {
        return parts.join('');
      }
      
      // Strategy 3c: Find the next section/div after the heading
      let nextSection = heading.nextElementSibling;
      while (nextSection && nextSection !== doc.body) {
        const tagName = nextSection.tagName?.toUpperCase() || '';
        if (tagName === 'SECTION' || tagName === 'DIV' || tagName === 'ARTICLE') {
          const text = nextSection.textContent?.trim() || '';
          if (text.length > 200) {
            const clone = nextSection.cloneNode(true);
            removeDangerousNodes(clone);
            const inner = clone.innerHTML?.trim() || '';
            if (inner.length > 100) {
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
  
  // Strategy 4: Try standard CSS selectors
  for (const selector of DESCRIPTION_SELECTORS) {
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
      if (inner.length > 100) return inner;
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
    const text = candidate.textContent?.trim() || '';
    // Score based on length and whether it contains job-related keywords
    if (text.length > 200) {
      const keywords = ['responsibilities', 'requirements', 'qualifications', 'experience', 
                        'skills', 'benefits', 'salary', 'location', 'remote', 'full-time'];
      const keywordCount = keywords.filter(kw => text.toLowerCase().includes(kw)).length;
      const score = text.length + (keywordCount * 100);
      
      if (score > bestScore && text.length > 300) {
        // Make sure it's not navigation or footer
        const classes = candidate.className || '';
        const id = candidate.id || '';
        if (!classes.includes('nav') && !classes.includes('footer') && 
            !classes.includes('header') && !id.includes('nav') && !id.includes('footer')) {
          bestCandidate = candidate;
          bestScore = score;
        }
      }
    }
  }
  
  if (bestCandidate) {
    const clone = bestCandidate.cloneNode(true);
    removeDangerousNodes(clone);
    const inner = clone.innerHTML?.trim() || '';
    if (inner.length > 100) {
      return inner;
    }
  }
  
  // Strategy 6: Look for any element with class containing "description", "content", "body", "text"
  const descClasses = doc.querySelectorAll('[class*="description"], [class*="content"], [class*="body"], [class*="text"], [class*="detail"]');
  for (const el of descClasses) {
    const text = el.textContent?.trim() || '';
    if (text.length > 300) {
      const clone = el.cloneNode(true);
      removeDangerousNodes(clone);
      const inner = clone.innerHTML?.trim() || '';
      if (inner.length > 100) {
        return inner;
      }
    }
  }
  
  return '';
}

function removeDangerousNodes(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
}

function getScoreClass(score) {
  if (score >= 0.7) return 'score-excellent';
  if (score >= 0.5) return 'score-good';
  if (score >= 0.3) return 'score-moderate';
  if (score >= 0.1) return 'score-weak';
  return 'score-very-poor';
}

function getScoreColor(scorePercent) {
  // scorePercent is 0-100 (percentage value)
  if (scorePercent >= 70) {
    return { bg: '#28a745', text: 'white' }; // Green - Excellent match (70-100)
  }
  if (scorePercent >= 50) {
    return { bg: '#20c997', text: 'white' }; // Teal - Good match (50-70)
  }
  if (scorePercent >= 30) {
    return { bg: '#ffc107', text: '#333' }; // Yellow - Moderate match (30-50)
  }
  if (scorePercent >= 10) {
    return { bg: '#fd7e14', text: 'white' }; // Orange - Weak match (10-30)
  }
  return { bg: '#dc3545', text: 'white' }; // Red - Very poor match (0-10)
}

function getScoreTooltip(score) {
  if (score >= 0.7) return '0.7 - 1.0: Excellent match (very similar content)';
  if (score >= 0.5) return '0.5 - 0.7: Good match (strong overlap)';
  if (score >= 0.3) return '0.3 - 0.5: Moderate match (relevant but not perfect)';
  if (score >= 0.1) return '0.1 - 0.3: Weak match (some common terms)';
  return '0.0 - 0.1: Very poor match (different fields/skills)';
}

function showScoreInfoModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'score-info-modal';
  modal.innerHTML = `
    <div class="score-info-modal-content">
      <div class="score-info-modal-header">
        <h3>Match Score Information</h3>
        <button class="score-info-modal-close" id="closeScoreModal">&times;</button>
      </div>
      <div class="score-info-modal-body">
        <div class="score-info-item">
          <span class="score-badge score-excellent">0.7 - 1.0</span>
          <span class="score-info-text">Excellent match (very similar content)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-good">0.5 - 0.7</span>
          <span class="score-info-text">Good match (strong overlap)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-moderate">0.3 - 0.5</span>
          <span class="score-info-text">Moderate match (relevant but not perfect)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-weak">0.1 - 0.3</span>
          <span class="score-info-text">Weak match (some common terms)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-very-poor">0.0 - 0.1</span>
          <span class="score-info-text">Very poor match (different fields/skills)</span>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close handlers
  const closeBtn = document.getElementById('closeScoreModal');
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
  
  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

// CSV Export
async function exportCsv() {
  const exportModule = await import('./scripts/export.js');
  const settings = await chrome.storage.local.get(['jobs']);
  const jobs = settings.jobs || [];
  
  if (jobs.length === 0) {
    alert('No jobs to export');
    return;
  }
  
  exportModule.exportToCsv(jobs);
}

// Clear all jobs
async function clearAllJobs() {
  const settings = await chrome.storage.local.get(['jobs']);
  const jobs = settings.jobs || [];
  
  if (jobs.length === 0) {
    alert('No jobs to clear');
    return;
  }
  
  // Confirm before clearing
  const confirmed = confirm(`Are you sure you want to delete all ${jobs.length} jobs? This action cannot be undone.`);
  
  if (!confirmed) {
    return;
  }
  
  try {
    // Clear jobs and reset last seen job IDs
    await chrome.storage.local.set({
      jobs: [],
      lastSeenJobIds: []
    });
    
    // Reload results to show empty state
    await loadResults();
    
    alert('All jobs have been cleared successfully.');
  } catch (error) {
    console.error('Error clearing jobs:', error);
    alert('Error clearing jobs. Please try again.');
  }
}

// Utility functions
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Update live scanning status
async function updateLiveScanStatus() {
  const runState = await chrome.storage.local.get([
    'scanRunStatus',
    'scanPagesProcessed',
    'scanJobsScanned',
    'scanNewJobs'
  ]);
  
  const status = runState.scanRunStatus || 'idle';
  const liveStatusDiv = document.getElementById('liveScanStatus');
  
  if (status === 'scanning') {
    liveStatusDiv.style.display = 'block';
    document.getElementById('liveStatusText').textContent = 'Scanning...';
    document.getElementById('livePagesProcessed').textContent = runState.scanPagesProcessed || 0;
    document.getElementById('liveJobsScanned').textContent = runState.scanJobsScanned || 0;
    document.getElementById('liveNewJobs').textContent = runState.scanNewJobs || 0;
  } else {
    liveStatusDiv.style.display = 'none';
  }
}

// Make functions available globally for onclick handlers
window.removeSearchUrl = removeSearchUrl;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

