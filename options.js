// Options page script for JobScout

import { getJobById, archiveOldJobs } from './scripts/storage.js';
import { sanitizeHtml } from './scripts/utils.js';
import { 
  MAX_SEARCH_URLS, 
  SCAN_INTERVAL, 
  PAGINATION,
  RESUME as RESUME_CONFIG,
  ARCHIVAL
} from './scripts/config.js';

const RESULTS_PER_PAGE = PAGINATION.RESULTS_PER_PAGE;

let modal = null;
let modalTitle = null;
let modalMeta = null;
let modalBody = null;
let activeJobId = null;
let currentPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
  modal = document.getElementById('job-modal');
  modalTitle = document.getElementById('modal-title');
  modalMeta = document.getElementById('modal-meta');
  modalBody = document.getElementById('modal-body');
  initializeTabs();
  await loadSearchUrls();
  await loadResumes();
  await loadGoogleSheetUrl();
  await loadGoogleSheetStatsUrl();
  await loadSettings();
  await loadResults();
  await updateLiveScanStatus();
  
  // Update last update time every minute
  setInterval(async () => {
    const settings = await chrome.storage.local.get(['lastScanTime']);
    updateLastUpdateTime(settings.lastScanTime);
  }, 60000); // Update every minute
  
  // Event listeners
  document.getElementById('addSearchUrl').addEventListener('click', addSearchUrl);
  // Allow Enter key to submit from any of the input fields
  ['newSearchUrl', 'newSearchLocation', 'newSearchKeyword'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addSearchUrl();
    });
  });
  
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('exportCsv').addEventListener('click', exportCsv);
  document.getElementById('openStatistics').addEventListener('click', openStatisticsSheet);
  document.getElementById('clearAllJobs').addEventListener('click', clearAllJobs);
  document.getElementById('scanTabNow').addEventListener('click', scanTabNow);
  document.getElementById('saveGoogleSheetUrl').addEventListener('click', saveGoogleSheetUrl);
  document.getElementById('saveGoogleSheetStatsUrl').addEventListener('click', saveGoogleSheetStatsUrl);
  document.getElementById('testGoogleSheetUrl').addEventListener('click', testGoogleSheetConnection);
  document.getElementById('showAppsScriptHelp').addEventListener('click', showAppsScriptHelp);
  document.getElementById('sortBy').addEventListener('change', () => {
    currentPage = 1;
    loadResults();
  });
  document.getElementById('filterText').addEventListener('input', () => {
    currentPage = 1;
    loadResults();
  });
  
  // Listen for storage changes to update live status and last update time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    // Update last update time if lastScanTime changed
    if (changes.lastScanTime) {
      updateLastUpdateTime(changes.lastScanTime.newValue);
    }
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

// Helper function to normalize search URL format (support both old string and new object format)
function normalizeSearchUrl(item) {
  if (typeof item === 'string') {
    return { url: item, location: '', keyword: '' };
  }
  return {
    url: item.url || '',
    location: item.location || '',
    keyword: item.keyword || ''
  };
}

// Debounce function for autosave
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Autosave function for search URL fields
const autosaveSearchUrl = debounce(async (index, url, location, keyword) => {
  const settings = await chrome.storage.local.get(['searchUrls']);
  const urls = settings.searchUrls || [];
  
  if (index >= 0 && index < urls.length) {
    urls[index] = { url: url.trim(), location: location.trim(), keyword: keyword.trim() };
    await chrome.storage.local.set({ searchUrls: urls });
  }
}, 500); // Save 500ms after user stops typing

// Search URLs management
async function loadSearchUrls() {
  const settings = await chrome.storage.local.get(['searchUrls']);
  let urls = settings.searchUrls || [];
  
  // Migrate old string format to new object format
  const needsMigration = urls.some(item => typeof item === 'string');
  if (needsMigration) {
    urls = urls.map(normalizeSearchUrl);
    await chrome.storage.local.set({ searchUrls: urls });
  }
  
  const listDiv = document.getElementById('searchUrlsList');
  
  if (urls.length === 0) {
    listDiv.innerHTML = '<div class="empty-state"><p>No search URLs added yet.</p></div>';
    return;
  }
  
  // Clear existing content
  listDiv.innerHTML = '';
  
  // Create list items with editable fields
  urls.forEach((item, index) => {
    const normalized = normalizeSearchUrl(item);
    const listItem = document.createElement('div');
    listItem.className = 'list-item';
    listItem.style.display = 'flex';
    listItem.style.flexDirection = 'row';
    listItem.style.alignItems = 'center';
    listItem.style.gap = '10px';
    listItem.style.padding = '15px';
    listItem.style.border = '1px solid #ddd';
    listItem.style.borderRadius = '4px';
    listItem.style.marginBottom = '10px';
    listItem.style.flexWrap = 'wrap';
    
    // URL display (read-only, but styled nicely)
    const urlDiv = document.createElement('div');
    urlDiv.style.fontWeight = 'bold';
    urlDiv.style.wordBreak = 'break-all';
    urlDiv.style.flex = '1';
    urlDiv.style.minWidth = '200px';
    urlDiv.textContent = normalized.url;
    urlDiv.title = normalized.url;
    
    // Container for labels
    const labelsContainer = document.createElement('div');
    labelsContainer.style.display = 'flex';
    labelsContainer.style.gap = '8px';
    labelsContainer.style.alignItems = 'center';
    labelsContainer.style.flexShrink = '0';
    
    // Location label (green) - only show if location exists
    if (normalized.location && normalized.location.trim()) {
      const locationLabel = document.createElement('span');
      locationLabel.textContent = normalized.location;
      locationLabel.style.display = 'inline-block';
      locationLabel.style.padding = '4px 8px';
      locationLabel.style.borderRadius = '12px';
      locationLabel.style.fontSize = '12px';
      locationLabel.style.fontWeight = '500';
      locationLabel.style.backgroundColor = '#4CAF50'; // Green
      locationLabel.style.color = 'white';
      locationLabel.style.whiteSpace = 'nowrap';
      labelsContainer.appendChild(locationLabel);
    }
    
    // Keyword label (yellow) - only show if keyword exists
    if (normalized.keyword && normalized.keyword.trim()) {
      const keywordLabel = document.createElement('span');
      keywordLabel.textContent = normalized.keyword;
      keywordLabel.style.display = 'inline-block';
      keywordLabel.style.padding = '4px 8px';
      keywordLabel.style.borderRadius = '12px';
      keywordLabel.style.fontSize = '12px';
      keywordLabel.style.fontWeight = '500';
      keywordLabel.style.backgroundColor = '#FFC107'; // Yellow
      keywordLabel.style.color = '#333';
      keywordLabel.style.whiteSpace = 'nowrap';
      labelsContainer.appendChild(keywordLabel);
    }
    
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.style.flexShrink = '0';
    removeBtn.addEventListener('click', () => removeSearchUrl(index));
    
    listItem.appendChild(urlDiv);
    if (labelsContainer.children.length > 0) {
      listItem.appendChild(labelsContainer);
    }
    listItem.appendChild(removeBtn);
    listDiv.appendChild(listItem);
  });
}

async function addSearchUrl() {
  const urlInput = document.getElementById('newSearchUrl');
  const locationInput = document.getElementById('newSearchLocation');
  const keywordInput = document.getElementById('newSearchKeyword');
  
  const url = urlInput.value.trim();
  const location = locationInput.value.trim();
  const keyword = keywordInput.value.trim();
  
  if (!url) {
    alert('Please enter a valid URL');
    return;
  }
  
  if (!url.startsWith('https://www.linkedin.com/jobs/')) {
    alert('Please enter a valid LinkedIn Jobs URL');
    return;
  }
  
  const settings = await chrome.storage.local.get(['searchUrls']);
  let urls = settings.searchUrls || [];
  
  // Normalize existing URLs to object format
  urls = urls.map(normalizeSearchUrl);
  
  if (urls.length >= MAX_SEARCH_URLS) {
    alert(`Maximum ${MAX_SEARCH_URLS} search URLs allowed`);
    return;
  }
  
  // Check if URL already exists
  if (urls.some(item => normalizeSearchUrl(item).url === url)) {
    alert('This URL is already added');
    return;
  }
  
  urls.push({ url, location, keyword });
  await chrome.storage.local.set({ searchUrls: urls });
  urlInput.value = '';
  locationInput.value = '';
  keywordInput.value = '';
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
  
  if (file.size > RESUME_CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) {
    alert(`File size must be less than ${RESUME_CONFIG.MAX_FILE_SIZE_MB}MB`);
    return;
  }
  
  // Show loading state
  const fileInput = event.target;
  const originalLabel = fileInput.nextElementSibling;
  if (originalLabel) {
    originalLabel.textContent = 'Parsing...';
    originalLabel.style.opacity = '0.6';
  }
  
  try {
    const parserModule = await import('./scripts/parser.js');
    const cvParserModule = await import('./scripts/cvParser.js');
    const text = await parserModule.parseResume(file);
    
    if (!text || text.trim().length === 0) {
      throw new Error('No text content extracted from the file. The file may be corrupted or in an unsupported format.');
    }
    
    if (text.trim().length < RESUME_CONFIG.MIN_TEXT_LENGTH) {
      throw new Error('Extracted text is too short. The file may not contain readable text or may be corrupted.');
    }
    
    // Parse CV sections
    const cvId = `cv-${file.name}-${Date.now()}`;
    const cvDoc = cvParserModule.createCvDoc(cvId, file.name, text);
    
    const settings = await chrome.storage.local.get(['resumes']);
    const resumes = settings.resumes || [];
    
    resumes[index] = {
      id: cvDoc.id,
      filename: file.name,
      size: file.size,
      text: text,
      sections: cvDoc.sections,
      wordCount: text.split(/\s+/).filter(word => word.length > 0).length,
      updatedAt: Date.now()
    };
    
    await chrome.storage.local.set({ resumes: resumes });
    await loadResumes();
    
    // Show success message
    if (originalLabel) {
      originalLabel.textContent = 'Resume uploaded!';
      originalLabel.style.color = '#28a745';
      setTimeout(() => {
        originalLabel.style.color = '';
      }, 2000);
    }
  } catch (error) {
    console.error('Error parsing resume:', error);
    
    // Reset label
    if (originalLabel) {
      originalLabel.textContent = 'Upload Resume';
      originalLabel.style.opacity = '1';
    }
    
    // Show detailed error message
    const errorMessage = error.message || 'Unknown error occurred';
    alert(`Error parsing resume: ${errorMessage}\n\nPlease ensure:\n- The file is a valid PDF, DOCX, or TXT file\n- The file is not corrupted\n- The file contains readable text\n- For PDFs: The file uses standard fonts or embedded fonts`);
  } finally {
    // Reset file input
    event.target.value = '';
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

// Google Sheets Integration
async function loadGoogleSheetUrl() {
  const settings = await chrome.storage.local.get(['googleSheetUrl']);
  const url = settings.googleSheetUrl || '';
  document.getElementById('googleSheetUrl').value = url;
  
  if (url) {
    updateGoogleSheetStatus('✓ Google Sheet connected', 'success');
  }
}

// Statistics Sheet URL (opens from Results tab)
async function loadGoogleSheetStatsUrl() {
  const settings = await chrome.storage.local.get(['googleSheetStatsUrl']);
  const url = settings.googleSheetStatsUrl || '';
  const input = document.getElementById('googleSheetStatsUrl');
  if (input) input.value = url;

  if (url) {
    updateGoogleSheetStatsStatus('✓ Statistics sheet URL saved', 'success');
  } else {
    updateGoogleSheetStatsStatus('', 'info');
  }
}

async function saveGoogleSheetUrl() {
  const input = document.getElementById('googleSheetUrl');
  const url = input.value.trim();
  
  if (!url) {
    updateGoogleSheetStatus('Please enter a Google Apps Script web app URL', 'error');
    return;
  }
  
  // Validate URL format
  if (!url.startsWith('https://script.google.com/macros/s/') || !url.includes('/exec')) {
    updateGoogleSheetStatus('Invalid URL format. Must be a Google Apps Script web app URL ending with /exec', 'error');
    return;
  }
  
  await chrome.storage.local.set({ googleSheetUrl: url });
  updateGoogleSheetStatus('✓ Google Sheet URL saved successfully', 'success');
}

async function saveGoogleSheetStatsUrl() {
  const input = document.getElementById('googleSheetStatsUrl');
  const url = (input?.value || '').trim();

  if (!url) {
    updateGoogleSheetStatsStatus('Please enter a Google Sheet URL', 'error');
    return;
  }

  if (!/^https?:\/\//i.test(url)) {
    updateGoogleSheetStatsStatus('Invalid URL. Must start with http:// or https://', 'error');
    return;
  }

  await chrome.storage.local.set({ googleSheetStatsUrl: url });
  updateGoogleSheetStatsStatus('✓ Statistics sheet URL saved successfully', 'success');
}

async function testGoogleSheetConnection() {
  const settings = await chrome.storage.local.get(['googleSheetUrl']);
  const url = settings.googleSheetUrl;
  
  if (!url) {
    updateGoogleSheetStatus('Please save a Google Sheet URL first', 'error');
    return;
  }
  
  updateGoogleSheetStatus('Testing connection...', 'info');
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'test'
      })
    });
    
    // With no-cors, we can't read the response, but if no error is thrown, it means the request went through
    updateGoogleSheetStatus('✓ Connection test sent successfully (check your Google Sheet for a test row)', 'success');
  } catch (error) {
    console.error('Connection test failed:', error);
    updateGoogleSheetStatus('✗ Connection test failed: ' + error.message, 'error');
  }
}

function updateGoogleSheetStatus(message, type) {
  const statusDiv = document.getElementById('googleSheetStatus');
  statusDiv.textContent = message;
  
  // Remove old color classes
  statusDiv.style.color = '';
  
  if (type === 'success') {
    statusDiv.style.color = '#28a745';
  } else if (type === 'error') {
    statusDiv.style.color = '#dc3545';
  } else if (type === 'info') {
    statusDiv.style.color = '#0077b5';
  }
}

function updateGoogleSheetStatsStatus(message, type) {
  const statusDiv = document.getElementById('googleSheetStatsStatus');
  if (!statusDiv) return;

  statusDiv.textContent = message;
  statusDiv.style.color = '';

  if (!message) return;

  if (type === 'success') {
    statusDiv.style.color = '#28a745';
  } else if (type === 'error') {
    statusDiv.style.color = '#dc3545';
  } else if (type === 'info') {
    statusDiv.style.color = '#0077b5';
  }
}

async function openStatisticsSheet() {
  const settings = await chrome.storage.local.get(['googleSheetStatsUrl']);
  const url = settings.googleSheetStatsUrl;

  if (!url) {
    showToast('Please save your Statistics Sheet URL in Settings first', 'error');
    return;
  }

  try {
    window.open(url, '_blank');
  } catch (error) {
    console.error('Failed to open statistics sheet:', error);
    showToast('Failed to open Statistics sheet: ' + (error?.message || 'Unknown error'), 'error');
  }
}

function showAppsScriptHelp(e) {
  e.preventDefault();
  
  const helpModal = document.createElement('div');
  helpModal.className = 'score-info-modal';
  helpModal.style.zIndex = '10001';
  
  helpModal.innerHTML = `
    <div class="score-info-modal-content" style="max-width: 700px;">
      <div class="score-info-modal-header">
        <h3>How to Set Up Google Sheets Integration</h3>
        <button class="score-info-modal-close" id="closeHelpModal">×</button>
      </div>
      <div class="score-info-modal-body" style="text-align: left; line-height: 1.6;">
        <h4 style="margin-top: 0;">Step 1: Create Your Tracking Sheet</h4>
        <ol style="margin-left: 20px;">
          <li>Create a new Google Sheet</li>
          <li>Add these column headers in Row 1: <code>Position</code>, <code>Application Status</code>, <code>Company</code>, <code>Applied on</code>, <code>Job Description</code></li>
        </ol>
        
        <h4>Step 2: Create Apps Script</h4>
        <ol style="margin-left: 20px;">
          <li>In your sheet, go to <strong>Extensions → Apps Script</strong></li>
          <li>Delete any existing code</li>
          <li>Copy and paste this code:
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; margin: 10px 0;">function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = JSON.parse(e.postData.contents);
    
    if (data.action === 'test') {
      sheet.appendRow(['TEST', 'TEST', 'TEST', new Date().toLocaleDateString('en-GB'), 'TEST']);
      return ContentService.createTextOutput(JSON.stringify({success: true}));
    }
    
    // Check for duplicates (optional)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const urlColumn = 5; // Job Description column
      const urls = sheet.getRange(2, urlColumn, lastRow - 1, 1).getValues();
      for (let i = 0; i < urls.length; i++) {
        if (urls[i][0] === data.jobUrl) {
          return ContentService.createTextOutput(JSON.stringify({
            success: false, 
            error: 'duplicate'
          }));
        }
      }
    }
    
    sheet.appendRow([
      data.position,
      data.status,
      data.company,
      data.appliedOn,
      data.jobUrl
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({success: true}));
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, 
      error: error.toString()
    }));
  }
}</pre>
          </li>
          <li>Click <strong>Save</strong> (disk icon)</li>
        </ol>
        
        <h4>Step 3: Deploy as Web App</h4>
        <ol style="margin-left: 20px;">
          <li>Click <strong>Deploy → New deployment</strong></li>
          <li>Click the gear icon ⚙️ and select <strong>Web app</strong></li>
          <li>Set "Execute as" to <strong>Me</strong></li>
          <li>Set "Who has access" to <strong>Anyone</strong></li>
          <li>Click <strong>Deploy</strong></li>
          <li>Copy the <strong>Web app URL</strong> (it ends with /exec)</li>
          <li>Paste it in the field above and click Save</li>
        </ol>
        
        <p style="background: #fff3cd; padding: 10px; border-radius: 4px; margin-top: 15px;">
          <strong>Note:</strong> You may need to authorize the script on first deployment. Follow the prompts to grant permissions.
        </p>
        
        <h4>Troubleshooting</h4>
        <ul style="margin-left: 20px; line-height: 1.8;">
          <li><strong>Error: "Cannot read properties of undefined"</strong>
            <ul style="margin-left: 20px;">
              <li>Make sure you deployed as <strong>Web app</strong>, not as API</li>
              <li>Verify "Execute as" is set to <strong>Me</strong></li>
              <li>Check "Who has access" is set to <strong>Anyone</strong></li>
              <li>Try creating a <strong>new deployment</strong> if the old one doesn't work</li>
            </ul>
          </li>
          <li><strong>Test Connection fails</strong>
            <ul style="margin-left: 20px;">
              <li>Check the URL ends with <code>/exec</code> (not <code>/dev</code>)</li>
              <li>Make sure you copied the <strong>Web app URL</strong>, not the Script URL</li>
              <li>Try opening the URL in your browser - you should see a JSON response</li>
            </ul>
          </li>
          <li><strong>No data appearing in sheet</strong>
            <ul style="margin-left: 20px;">
              <li>Check the Apps Script logs: <strong>Executions</strong> tab in Apps Script</li>
              <li>Make sure column headers match exactly: Position, Application Status, Company, Applied on, Job Description</li>
              <li>Verify the script has permission to access your sheet</li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  `;
  
  document.body.appendChild(helpModal);
  
  const closeBtn = document.getElementById('closeHelpModal');
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(helpModal);
  });
  
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      document.body.removeChild(helpModal);
    }
  });
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
  
  if (scanInterval < SCAN_INTERVAL.MIN || scanInterval > SCAN_INTERVAL.MAX) {
    alert(`Scan interval must be between ${SCAN_INTERVAL.MIN} and ${SCAN_INTERVAL.MAX} minutes`);
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
  // Archive old jobs periodically (every 20 loads)
  const { archiveLoadCounter = 0 } = await chrome.storage.local.get(['archiveLoadCounter']);
  if (archiveLoadCounter >= 20) {
    await archiveOldJobsIfNeeded();
    await chrome.storage.local.set({ archiveLoadCounter: 0 });
  } else {
    await chrome.storage.local.set({ archiveLoadCounter: archiveLoadCounter + 1 });
  }
  
  const settings = await chrome.storage.local.get(['jobs', 'lastScanTime']);
  let jobs = settings.jobs || [];
  
  // Update last update time display
  updateLastUpdateTime(settings.lastScanTime);
  
  // Filter out excluded jobs (low scores, etc.)
  jobs = jobs.filter(job => !job.excluded);
  
  // Filter out jobs with 0% scores (these are irrelevant matches)
  // Only filter if job has a bestResume field (meaning matching was attempted)
  jobs = jobs.filter(job => {
    const score = job.matchScore ?? job.score ?? 0;
    // If score is exactly 0 and we attempted matching (bestResume field exists, even if null)
    // This means the job was matched but got 0% - exclude it
    if (score === 0 && 'bestResume' in job) {
      return false; // Exclude 0% matches
    }
    return true;
  });
  
  // Filter by text search
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
  
  const totalJobs = jobs.length;
  
  if (totalJobs === 0) {
    currentPage = 1;
    updateResultsSummary(0, 0, 0);
    updatePaginationControls(1, 0);
    displayResults([]);
    return;
  }
  
  const totalPages = Math.max(1, Math.ceil(totalJobs / RESULTS_PER_PAGE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (currentPage - 1) * RESULTS_PER_PAGE;
  const paginatedJobs = jobs.slice(startIndex, startIndex + RESULTS_PER_PAGE);
  
  displayResults(paginatedJobs);
  updateResultsSummary(startIndex + 1, Math.min(startIndex + paginatedJobs.length, totalJobs), totalJobs);
  updatePaginationControls(totalPages, totalJobs);
}

function updateLastUpdateTime(lastScanTime) {
  const lastUpdateElement = document.getElementById('lastUpdateTime');
  if (!lastUpdateElement) return;
  
  if (!lastScanTime) {
    lastUpdateElement.textContent = 'Never updated';
    return;
  }
  
  const now = Date.now();
  const diff = now - lastScanTime;
  const diffSeconds = Math.floor(diff / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  let timeText;
  if (diffSeconds < 60) {
    timeText = 'Just now';
  } else if (diffMinutes < 60) {
    timeText = `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    timeText = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    timeText = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    // For older dates, show the actual date
    const date = new Date(lastScanTime);
    timeText = `Last updated: ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  
  lastUpdateElement.textContent = `Last updated: ${timeText}`;
}

function displayResults(jobs) {
  const tableDiv = document.getElementById('resultsTable');
  
  if (jobs.length === 0) {
    tableDiv.innerHTML = '<div class="empty-state"><p>No jobs found. Run a scan to collect jobs.</p></div>';
    return;
  }
  
  // Wrapper that contains score help + cards list (Hiring.cafe-style)
  const wrapper = document.createElement('div');
  wrapper.className = 'job-cards-wrapper';

  const scoreHeader = document.createElement('div');
  scoreHeader.className = 'job-cards-header';
  scoreHeader.innerHTML = `
    <span class="job-cards-header-label">Jobs</span>
    <span class="job-cards-header-score">
      Score
      <span class="score-help-icon" id="scoreHelpIcon" title="Click for score information">?</span>
    </span>
  `;

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'job-cards';

  jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card';

    const title = deduplicateTitle(job.title) || 'N/A';
    const company = job.company && job.company !== 'Unknown' ? job.company : 'N/A';
    const location = job.location && job.location !== 'Unknown' ? job.location : 'N/A';

    // Header: title + company/location
    const header = document.createElement('div');
    header.className = 'job-card-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'job-card-title';
    titleEl.textContent = title;

    const companyEl = document.createElement('div');
    companyEl.className = 'job-card-company';
    companyEl.textContent = `${company} • ${location}`;

    header.appendChild(titleEl);
    header.appendChild(companyEl);

    // Meta row: date posted + best resume badge + main score badge
    const metaRow = document.createElement('div');
    metaRow.className = 'job-card-meta';

    const dateEl = document.createElement('span');
    dateEl.className = 'job-card-date';
    if (job.datePosted && job.datePosted !== 'Unknown' && job.datePosted !== null && job.datePosted.trim() !== '') {
      dateEl.textContent = `Posted: ${job.datePosted}`;
    } else {
      dateEl.textContent = 'Posted: Unknown';
    }

    const resumeMeta = document.createElement('span');
    resumeMeta.className = 'job-card-resume';

    const bestMatch = job.bestMatch || (job.bestResume ? { cvName: job.bestResume, score: job.matchScore ?? job.score } : null);
    if (bestMatch) {
      const resumeContainer = document.createElement('div');
      resumeContainer.className = 'job-card-resume-pill';

      const resumeName = document.createElement('span');
      resumeName.textContent = bestMatch.cvName || job.bestResume || 'N/A';
      resumeContainer.appendChild(resumeName);
      
      // Score badge
      const scoreValue = bestMatch.score ?? job.matchScore ?? job.score;
      if (scoreValue !== undefined && scoreValue !== null) {
        const scorePercent = scoreValue * 100;
        const scoreColor = getScoreColor(scorePercent);
        const badge = document.createElement('span');
        badge.className = 'score-badge';
        badge.textContent = scorePercent.toFixed(0) + '%';
        badge.style.backgroundColor = scoreColor.bg;
        badge.style.color = scoreColor.text;
        resumeContainer.appendChild(badge);
      }
      
      resumeMeta.appendChild(resumeContainer);
    }

    const scoreCell = document.createElement('span');
    scoreCell.className = 'job-card-score';
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
      scoreCell.appendChild(badge);
    }

    metaRow.appendChild(dateEl);
    if (resumeMeta.children.length > 0) {
      metaRow.appendChild(resumeMeta);
    }
    metaRow.appendChild(scoreCell);

    // Footer: search labels + actions
    const footer = document.createElement('div');
    footer.className = 'job-card-footer';

    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'job-card-labels';

    // Location label (green) from the saved search URL
    if (job.searchLocationLabel && String(job.searchLocationLabel).trim()) {
      const locationLabel = document.createElement('span');
      locationLabel.textContent = job.searchLocationLabel;
      locationLabel.className = 'job-pill job-pill-location';
      labelsContainer.appendChild(locationLabel);
    }
    
    // Keyword label (yellow) from the saved search URL
    if (job.searchKeywordLabel && String(job.searchKeywordLabel).trim()) {
      const keywordLabel = document.createElement('span');
      keywordLabel.textContent = job.searchKeywordLabel;
      keywordLabel.className = 'job-pill job-pill-keyword';
      labelsContainer.appendChild(keywordLabel);
    }

    const actions = document.createElement('div');
    actions.className = 'job-actions';

    // Add "Apply" button to open job URL
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.className = 'btn btn-primary';
    applyBtn.style.fontSize = '12px';
    const jobUrl = job.url || job.link;
    if (jobUrl) {
      applyBtn.addEventListener('click', () => {
        window.open(jobUrl, '_blank');
      });
    } else {
      applyBtn.disabled = true;
    }
    actions.append(applyBtn);
    
    // Add "Why?" button if we have match explanation
    if (bestMatch && bestMatch.explanation) {
      const whyBtn = document.createElement('button');
      whyBtn.textContent = 'Why?';
      whyBtn.className = 'btn btn-secondary';
      whyBtn.style.fontSize = '12px';
      whyBtn.addEventListener('click', () => showMatchExplanation(job, bestMatch));
      actions.append(whyBtn);
    }
    
    // Add "Save" button to save to Google Sheets
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn btn-secondary';
    saveBtn.style.fontSize = '12px';
    saveBtn.addEventListener('click', async () => {
      await saveJobToSheet(job, saveBtn);
    });
    actions.append(saveBtn);
    
    footer.appendChild(labelsContainer);
    footer.appendChild(actions);

    card.appendChild(header);
    card.appendChild(metaRow);
    card.appendChild(footer);

    cardsContainer.appendChild(card);
  });
  
  tableDiv.innerHTML = '';
  wrapper.appendChild(scoreHeader);
  wrapper.appendChild(cardsContainer);
  tableDiv.appendChild(wrapper);
  
  const helpIcon = document.getElementById('scoreHelpIcon');
  if (helpIcon) {
    helpIcon.addEventListener('click', showScoreInfoModal);
  }
}

function updateResultsSummary(start, end, total) {
  const summaryEl = document.getElementById('resultsSummary');
  if (!summaryEl) return;
  
  if (total === 0) {
    summaryEl.textContent = 'No jobs to display';
    return;
  }
  
  summaryEl.textContent = `Showing ${start}-${end} of ${total} jobs`;
}

function updatePaginationControls(totalPages, totalJobs) {
  const paginationDiv = document.getElementById('paginationControls');
  if (!paginationDiv) return;
  
  if (totalJobs <= RESULTS_PER_PAGE) {
    paginationDiv.innerHTML = '';
    paginationDiv.classList.add('hidden');
    return;
  }
  
  paginationDiv.classList.remove('hidden');
  paginationDiv.innerHTML = '';
  
  const prevBtn = document.createElement('button');
  prevBtn.textContent = 'Previous';
  prevBtn.className = 'btn btn-secondary';
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadResults();
    }
  });
  
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.className = 'btn btn-secondary';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadResults();
    }
  });
  
  const info = document.createElement('span');
  info.className = 'pagination-info';
  info.textContent = `Page ${currentPage} of ${totalPages}`;
  
  paginationDiv.append(prevBtn, info, nextBtn);
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
  const title = deduplicateTitle(job.title) || 'Unknown title';
  const company = job.company && job.company !== 'Unknown' ? job.company : 'Unknown company';
  modalTitle.textContent = `${title} — ${company}`;
  
  const location = job.location && job.location !== 'Unknown' ? job.location : 'Unknown location';
  const date = (job.datePosted && job.datePosted !== 'Unknown' && job.datePosted.trim() !== '') ? job.datePosted : 'Unknown';
  modalMeta.textContent = `${location} · Posted: ${date}`;
  
  if (job.descriptionHtml && job.descriptionHtml.trim().length > 0) {
    modalBody.innerHTML = job.descriptionHtml;
  } else {
    modalBody.innerHTML = '<em>No description captured.</em>';
  }
}

// Removed updateModalFetchState function

function showModal() {
  if (!modal) return;
  modal.classList.remove('hidden');
}

function hideModal() {
  if (!modal) return;
  modal.classList.add('hidden');
  activeJobId = null;
}

// Removed fetchDescriptionForJob function and related helper functions
// Removed extractDescriptionFromLivePage function
// Removed extractDescriptionFromDocument function

function removeDangerousNodes(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
}

// Save job to Google Sheets
async function saveJobToSheet(job, buttonElement) {
  const settings = await chrome.storage.local.get(['googleSheetUrl']);
  const webAppUrl = settings.googleSheetUrl;
  
  if (!webAppUrl) {
    showToast('Please configure Google Sheet URL in the Resumes tab first', 'error');
    return;
  }
  
  // Show loading state
  const originalText = buttonElement.textContent;
  buttonElement.textContent = 'Saving...';
  buttonElement.disabled = true;
  
  try {
    // Prepare data from the job card (no need to open new tab)
    const title = deduplicateTitle(job.title) || 'N/A';
    const company = job.company && job.company !== 'Unknown' ? job.company : 'N/A';
    const location = job.location && job.location !== 'Unknown' ? job.location : '';
    const jobUrl = job.url || job.link;
    const currentDate = new Date().toLocaleDateString('en-GB'); // dd.mm.yyyy format
    
    // Add location to company name if available
    const companyWithLocation = location ? `${company} (${location})` : company;
    
    const data = {
      position: title,
      status: 'Applied',
      company: companyWithLocation,
      appliedOn: currentDate,
      jobUrl: jobUrl || 'N/A'
    };
    
    // Send POST request to Google Apps Script
    console.log('Sending job to Google Sheet:', data);
    
    try {
      const response = await fetch(webAppUrl, {
        method: 'POST',
        mode: 'no-cors', // Required for Apps Script
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      // With no-cors mode, we can't read the response, but if no error is thrown,
      // it means the request was sent successfully
      console.log('Request sent successfully');
      buttonElement.textContent = '✓ Saved';
      buttonElement.style.backgroundColor = '#28a745';
      buttonElement.style.color = 'white';
      
      showToast(`✓ Saved: ${title} at ${company}`, 'success');
      
      // Keep the button in saved state (don't reset it)
      // This helps users track which jobs they've already saved
      setTimeout(() => {
        buttonElement.disabled = false; // Re-enable in case they want to save again
      }, 1000);
      
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
      throw fetchError; // Re-throw to be caught by outer catch
    }
    
  } catch (error) {
    console.error('Error saving to Google Sheet:', error);
    showToast('Error saving to Google Sheet: ' + error.message, 'error');
    
    // Reset button
    buttonElement.textContent = originalText;
    buttonElement.disabled = false;
  }
}

// Show toast notification
function showToast(message, type = 'info') {
  // Remove existing toast if any
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  
  if (type === 'success') {
    toast.style.backgroundColor = '#28a745';
  } else if (type === 'error') {
    toast.style.backgroundColor = '#dc3545';
  } else {
    toast.style.backgroundColor = '#0077b5';
  }
  
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
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
  // Get colors from the same function used in results page
  const excellentColor = getScoreColor(75); // Use 75% as representative for 70-100% range
  const goodColor = getScoreColor(60); // Use 60% as representative for 50-70% range
  const moderateColor = getScoreColor(40); // Use 40% as representative for 30-50% range
  const weakColor = getScoreColor(20); // Use 20% as representative for 10-30% range
  const veryPoorColor = getScoreColor(5); // Use 5% as representative for 0-10% range
  
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
          <span class="score-badge score-excellent" style="background-color: ${excellentColor.bg}; color: ${excellentColor.text}; padding: 4px 8px; border-radius: 4px; font-weight: bold;">0.7 - 1.0</span>
          <span class="score-info-text">Excellent match (very similar content)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-good" style="background-color: ${goodColor.bg}; color: ${goodColor.text}; padding: 4px 8px; border-radius: 4px; font-weight: bold;">0.5 - 0.7</span>
          <span class="score-info-text">Good match (strong overlap)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-moderate" style="background-color: ${moderateColor.bg}; color: ${moderateColor.text}; padding: 4px 8px; border-radius: 4px; font-weight: bold;">0.3 - 0.5</span>
          <span class="score-info-text">Moderate match (relevant but not perfect)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-weak" style="background-color: ${weakColor.bg}; color: ${weakColor.text}; padding: 4px 8px; border-radius: 4px; font-weight: bold;">0.1 - 0.3</span>
          <span class="score-info-text">Weak match (some common terms)</span>
        </div>
        <div class="score-info-item">
          <span class="score-badge score-very-poor" style="background-color: ${veryPoorColor.bg}; color: ${veryPoorColor.text}; padding: 4px 8px; border-radius: 4px; font-weight: bold;">0.0 - 0.1</span>
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

function showMatchExplanation(job, match) {
  const explanation = match.explanation || {};
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'score-info-modal';
  modal.style.zIndex = '10001';
  
  const matchedKeywords = explanation.matchedKeywords || [];
  const missingMustHaves = explanation.missingMustHaves || [];
  const topSentences = explanation.topSentences || [];
  
  modal.innerHTML = `
    <div class="score-info-modal-content" style="max-width: 600px;">
      <div class="score-info-modal-header">
        <h3>Why ${match.cvName || 'this resume'}?</h3>
        <button class="score-info-modal-close" id="closeWhyModal">&times;</button>
      </div>
      <div class="score-info-modal-body" style="text-align: left;">
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 8px; color: #333;">Matched Keywords</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${matchedKeywords.length > 0 
              ? matchedKeywords.map(kw => `<span style="background: #e3f2fd; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${kw}</span>`).join('')
              : '<span style="color: #666;">No significant keywords matched</span>'
            }
          </div>
        </div>
        
        ${missingMustHaves.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 8px; color: #d32f2f;">Missing Must-Haves</h4>
          <ul style="margin: 0; padding-left: 20px; color: #d32f2f;">
            ${missingMustHaves.map(req => `<li>${req}</li>`).join('')}
          </ul>
        </div>
        ` : `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 8px; color: #2e7d32;">✓ All Must-Haves Satisfied</h4>
        </div>
        `}
        
        ${topSentences.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h4 style="margin-bottom: 8px; color: #333;">Most Similar Content</h4>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${topSentences.map((sent, idx) => `
              <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; border-left: 3px solid #2196f3;">
                <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Relevance: ${(sent.score * 100).toFixed(0)}%</div>
                <div style="font-size: 13px; color: #333;">${sent.text}</div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
          <strong>Job:</strong> ${deduplicateTitle(job.title) || 'N/A'} at ${job.company || 'N/A'}<br>
          <strong>Score:</strong> ${((match.score || 0) * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close handlers
  const closeBtn = document.getElementById('closeWhyModal');
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
// Scan tab now
async function scanTabNow() {
  try {
    // Check if there are any search URLs configured
    const { searchUrls = [] } = await chrome.storage.local.get(['searchUrls']);
    
    if (searchUrls.length === 0) {
      alert('Please add at least one search URL in the "Search URLs" tab before scanning.');
      return;
    }
    
    // Show loading state
    const button = document.getElementById('scanTabNow');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Scanning...';
    
    // Send message to background script to start scan
    chrome.runtime.sendMessage({ action: 'scanNow' }, (response) => {
      button.disabled = false;
      button.textContent = originalText;
      
      if (chrome.runtime.lastError) {
        console.error('Error starting scan:', chrome.runtime.lastError);
        alert('Error starting scan: ' + chrome.runtime.lastError.message);
        return;
      }
      
      if (response && response.success) {
        // Reload results after a short delay to allow scan to start
        setTimeout(() => {
          loadResults();
        }, 2000);
      } else if (response && response.error) {
        alert('Error starting scan: ' + response.error);
      }
    });
  } catch (error) {
    console.error('Error initiating scan:', error);
    alert('Error initiating scan. Please try again.');
    const button = document.getElementById('scanTabNow');
    if (button) {
      button.disabled = false;
      button.textContent = 'Scan Tab Now';
    }
  }
}

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

// Archive old jobs (called automatically on loadResults or can be called manually)
async function archiveOldJobsIfNeeded() {
  try {
    const result = await archiveOldJobs(ARCHIVAL.DAYS_TO_ARCHIVE);
    if (result.archived > 0) {
      console.log(`Archived ${result.archived} old jobs, ${result.remaining} remaining`);
    }
  } catch (error) {
    console.error('Error archiving old jobs:', error);
  }
}

// Utility functions
function deduplicateTitle(title) {
  if (!title || typeof title !== 'string') return title;
  
  // If title ends with "with verification", always strip it.
  // LinkedIn sometimes appends this suffix; we don't want it in the saved/display title.
  title = title
    // Remove zero-width chars that can break suffix matching.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Remove an optional separator + the suffix (case-insensitive).
    .replace(/\s*(?:[•·\-—–|]\s*)?with\s+verification\s*$/i, '')
    .trim();
  
  // First, normalize spaces and handle cases where duplicates have no space between them
  // Add space before capital letters that follow closing parentheses/brackets (common pattern)
  let normalized = title.trim()
    .replace(/([)\]}])([A-Z])/g, '$1 $2') // Add space after )]}] before capital letter
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
    .trim();
  
  // Remove duplicate consecutive words first
  const words = normalized.split(/\s+/);
  const deduplicated = [];
  
  for (let i = 0; i < words.length; i++) {
    // Check if current word is the same as the previous one
    if (i === 0 || words[i] !== words[i - 1]) {
      deduplicated.push(words[i]);
    }
  }
  
  let result = deduplicated.join(' ');
  
  // Check for full phrase repetition - most common case
  // Check if the entire string is duplicated (split in half)
  const totalLength = result.length;
  if (totalLength >= 4 && totalLength % 2 === 0) {
    const midPoint = totalLength / 2;
    const firstHalf = result.substring(0, midPoint).trim();
    const secondHalf = result.substring(midPoint).trim();
    
    // Check exact match
    if (firstHalf === secondHalf && firstHalf.length > 0) {
      return firstHalf;
    }
    
    // Check with potential space differences
    if (firstHalf.replace(/\s+/g, ' ') === secondHalf.replace(/\s+/g, ' ') && firstHalf.length > 0) {
      return firstHalf;
    }
  }
  
  // Check word-by-word for duplication (handles cases where spacing might differ)
  const wordsArray = result.split(/\s+/);
  const totalWords = wordsArray.length;
  
  // Check if the title is exactly duplicated word-wise (split in half)
  if (totalWords >= 2 && totalWords % 2 === 0) {
    const midPoint = totalWords / 2;
    const firstHalf = wordsArray.slice(0, midPoint).join(' ');
    const secondHalf = wordsArray.slice(midPoint).join(' ');
    
    if (firstHalf === secondHalf && firstHalf.length > 0) {
      return firstHalf;
    }
  }
  
  // Check for partial phrase repetition at the end
  // Look for patterns where a phrase at the beginning repeats at the end
  if (wordsArray.length > 2) {
    // Try different phrase lengths (from 2 words to half the title)
    const maxPhraseLength = Math.floor(wordsArray.length / 2);
    
    for (let phraseLength = maxPhraseLength; phraseLength >= 2; phraseLength--) {
      const startPhrase = wordsArray.slice(0, phraseLength).join(' ');
      const endPhrase = wordsArray.slice(-phraseLength).join(' ');
      
      if (startPhrase === endPhrase && startPhrase.length > 0) {
        // Remove the duplicate at the end
        return wordsArray.slice(0, -phraseLength).join(' ');
      }
    }
  }
  
  // Also check for repetition with separators (like "Title - Title")
  // Split by common separators and check if parts repeat
  const separatorPattern = /\s*[—–-]\s*/;
  if (separatorPattern.test(result)) {
    const parts = result.split(separatorPattern);
    if (parts.length >= 2) {
      // Check if any part is repeated
      const uniqueParts = [];
      for (const part of parts) {
        const trimmedPart = part.trim();
        if (trimmedPart && !uniqueParts.includes(trimmedPart)) {
          uniqueParts.push(trimmedPart);
        }
      }
      
      // If we removed duplicates, reconstruct
      if (uniqueParts.length < parts.length) {
        return uniqueParts.join(' — ');
      }
    }
  }
  
  const finalResult = result.trim();

  return finalResult;
}

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

// Note: removeSearchUrl is now handled via event listeners, no need to expose globally

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

