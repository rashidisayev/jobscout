// Options page script for JobScout

document.addEventListener('DOMContentLoaded', async () => {
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
        return (b.matchScore || 0) - (a.matchScore || 0);
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
    <tbody>
      ${jobs.map(job => `
        <tr>
          <td>${escapeHtml(job.title || 'N/A')}</td>
          <td>${escapeHtml(job.company && job.company !== 'Unknown' ? job.company : 'N/A')}</td>
          <td>${escapeHtml(job.location && job.location !== 'Unknown' ? job.location : 'N/A')}</td>
          <td>${escapeHtml(job.datePosted && job.datePosted !== 'Unknown' ? job.datePosted : 'N/A')}</td>
          <td>${escapeHtml(job.bestResume || 'N/A')}</td>
          <td>
            ${job.matchScore !== undefined && job.matchScore !== null ? (() => {
              const score = job.matchScore;
              const scoreClass = getScoreClass(score);
              const scoreColor = getScoreColor(score);
              return `
                <span class="score-badge ${scoreClass}" 
                      data-score="${score}"
                      style="background-color: ${scoreColor.bg} !important; color: ${scoreColor.text} !important; border: none !important;">
                  ${(score * 100).toFixed(1)}
                </span>
              `;
            })() : 'N/A'}
          </td>
          <td>
            ${job.link ? `<a href="${job.link}" target="_blank" class="job-link">View</a>` : 'N/A'}
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;
  
  tableDiv.innerHTML = '';
  tableDiv.appendChild(table);
  
  // Add click handler for score help icon
  const helpIcon = document.getElementById('scoreHelpIcon');
  if (helpIcon) {
    helpIcon.addEventListener('click', showScoreInfoModal);
  }
}

function getScoreClass(score) {
  if (score >= 0.7) return 'score-excellent';
  if (score >= 0.5) return 'score-good';
  if (score >= 0.3) return 'score-moderate';
  if (score >= 0.1) return 'score-weak';
  return 'score-very-poor';
}

function getScoreColor(score) {
  if (score >= 0.7) {
    return { bg: '#28a745', text: 'white' }; // Green - Excellent match
  }
  if (score >= 0.5) {
    return { bg: '#20c997', text: 'white' }; // Teal - Good match
  }
  if (score >= 0.3) {
    return { bg: '#ffc107', text: '#333' }; // Yellow - Moderate match
  }
  if (score >= 0.1) {
    return { bg: '#fd7e14', text: 'white' }; // Orange - Weak match
  }
  return { bg: '#dc3545', text: 'white' }; // Red - Very poor match
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

