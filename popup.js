// Popup script for JobScout

document.addEventListener('DOMContentLoaded', async () => {
  await updateStats();
  await updatePauseStatus();
  await updateRunStatus();
  
  // Scan now button
  document.getElementById('scanNow').addEventListener('click', async () => {
    const button = document.getElementById('scanNow');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Starting...';
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'scanNow' });
      if (response && response.success) {
        showToast('Scan started successfully', 'success');
        // Button state will be updated by status polling
      } else if (response && response.error) {
        showToast('Error: ' + response.error, 'error');
        button.disabled = false;
        button.textContent = originalText;
      }
    } catch (error) {
      console.error('Scan error:', error);
      showToast('Failed to start scan', 'error');
      button.disabled = false;
      button.textContent = originalText;
    }
  });
  
  // Toggle pause/resume button
  document.getElementById('togglePause').addEventListener('click', async () => {
    const button = document.getElementById('togglePause');
    button.disabled = true;
    
    try {
      const { isPaused = false } = await chrome.storage.local.get(['isPaused']);
      const newPausedState = !isPaused;
      
      // Update pause state
      await chrome.storage.local.set({ isPaused: newPausedState });
      
      // Notify background script of pause/resume
      chrome.runtime.sendMessage({ 
        action: newPausedState ? 'pauseScanning' : 'resumeScanning' 
      });
      
      showToast(newPausedState ? 'Scanning paused' : 'Scanning resumed', 'success');
      
      // Update UI
      await updatePauseStatus();
      
    } catch (error) {
      console.error('Toggle pause error:', error);
      showToast('Failed to toggle pause', 'error');
    } finally {
      button.disabled = false;
    }
  });
  
  // Open options
  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  
  // Listen for storage changes to update UI
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      const runStateKeys = ['scanRunStatus', 'scanPagesProcessed', 'scanJobsScanned', 'scanNewJobs'];
      const hasRunStateChange = runStateKeys.some(key => changes[key]);
      
      if (hasRunStateChange) {
        updateRunStatus();
      }
      
      // Update stats if jobs changed
      if (changes.jobs || changes.lastScanTime) {
        updateStats();
      }
      
      // Update pause status if changed
      if (changes.isPaused) {
        updatePauseStatus();
      }
    }
  });
  
  // Update stats periodically
  setInterval(updateStats, 30000); // Every 30 seconds
  // Update run status more frequently during scan
  setInterval(updateRunStatus, 2000); // Every 2 seconds
});

async function updateStats() {
  const settings = await chrome.storage.local.get([
    'jobs',
    'lastScanTime',
    'excludedJobs'
  ]);
  
  const allJobs = settings.jobs || [];
  const excludedCount = (settings.excludedJobs || []).length;
  const lastScanTime = settings.lastScanTime;
  
  // Filter out excluded jobs and 0% scores from count
  const validJobs = allJobs.filter(job => {
    if (job.excluded) return false;
    const score = job.matchScore ?? job.score ?? 0;
    if (score === 0 && 'bestResume' in job) return false;
    return true;
  });
  
  // Count new jobs since last scan
  const newJobsCount = lastScanTime
    ? validJobs.filter(job => (job.foundAt || job.scrapedAt || 0) > lastScanTime).length
    : validJobs.length;
  
  document.getElementById('newJobsCount').textContent = newJobsCount;
  document.getElementById('totalJobsCount').textContent = validJobs.length;
  
  // Format last scan time
  if (lastScanTime) {
    const date = new Date(lastScanTime);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    let timeStr;
    if (diffMins < 1) {
      timeStr = 'Just now';
    } else if (diffMins < 60) {
      timeStr = `${diffMins}m ago`;
    } else if (diffMins < 24 * 60) {
      const diffHours = Math.floor(diffMins / 60);
      timeStr = `${diffHours}h ago`;
    } else {
      const diffDays = Math.floor(diffMins / (60 * 24));
      timeStr = `${diffDays}d ago`;
    }
    
    document.getElementById('lastScanTime').textContent = timeStr;
  } else {
    document.getElementById('lastScanTime').textContent = 'Never';
  }
}

async function updatePauseStatus() {
  const settings = await chrome.storage.local.get(['isPaused', 'scanRunStatus']);
  const isPaused = settings.isPaused === true;
  const isScanning = settings.scanRunStatus === 'scanning';
  
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const toggleBtn = document.getElementById('togglePause');
  
  if (isScanning) {
    // Currently scanning
    statusIndicator.className = 'status-indicator scanning';
    statusText.textContent = 'Scanning in Progress';
    toggleBtn.textContent = 'Pause';
    toggleBtn.className = 'btn btn-secondary';
  } else if (isPaused) {
    // Paused
    statusIndicator.className = 'status-indicator paused';
    statusText.textContent = 'Scanning Paused';
    toggleBtn.textContent = 'Resume';
    toggleBtn.className = 'btn btn-primary';
  } else {
    // Active (ready to scan)
    statusIndicator.className = 'status-indicator active';
    statusText.textContent = 'Scanning Active';
    toggleBtn.textContent = 'Pause';
    toggleBtn.className = 'btn btn-secondary';
  }
}

async function updateRunStatus() {
  const runState = await chrome.storage.local.get([
    'scanRunStatus',
    'scanPagesProcessed',
    'scanJobsScanned',
    'scanNewJobs'
  ]);
  
  const status = runState.scanRunStatus || 'idle';
  const scanStatusDiv = document.getElementById('scanStatus');
  const scanNowBtn = document.getElementById('scanNow');
  
  if (status === 'scanning') {
    scanStatusDiv.classList.remove('hidden');
    document.getElementById('pagesProcessed').textContent = runState.scanPagesProcessed || 0;
    document.getElementById('jobsScanned').textContent = runState.scanJobsScanned || 0;
    document.getElementById('newJobsRun').textContent = runState.scanNewJobs || 0;
    
    scanNowBtn.disabled = true;
    scanNowBtn.textContent = 'Scanning...';
    
    // Also update pause status when scanning
    await updatePauseStatus();
  } else {
    scanStatusDiv.classList.add('hidden');
    scanNowBtn.disabled = false;
    scanNowBtn.textContent = 'Scan Now';
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
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}
