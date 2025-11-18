// Popup script for JobScout

document.addEventListener('DOMContentLoaded', async () => {
  await updateStats();
  await updateScanningStatus();
  await updateRunStatus();
  
  // Scan now button
  document.getElementById('scanNow').addEventListener('click', async () => {
    const button = document.getElementById('scanNow');
    button.disabled = true;
    button.textContent = 'Scanning...';
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'scanNow' });
      if (response && response.success) {
        // Don't re-enable immediately - let the status update handle it
      } else {
        button.disabled = false;
        button.textContent = 'Scan Now';
      }
    } catch (error) {
      console.error('Scan error:', error);
      button.disabled = false;
      button.textContent = 'Scan Now';
    }
  });
  
  // Toggle scanning button
  document.getElementById('toggleScanning').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ action: 'toggleScanning' });
    if (response) {
      await updateScanningStatus();
    }
  });
  
  // Open options
  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  
  // Listen for storage changes to update live status
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
    'lastSeenJobIds'
  ]);
  
  const allJobs = settings.jobs || [];
  const lastScanTime = settings.lastScanTime;
  
  // Count new jobs since last scan
  const newJobsCount = lastScanTime
    ? allJobs.filter(job => job.foundAt > lastScanTime).length
    : allJobs.length;
  
  document.getElementById('newJobsCount').textContent = newJobsCount;
  document.getElementById('totalJobsCount').textContent = allJobs.length;
  
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
    } else {
      const diffHours = Math.floor(diffMins / 60);
      timeStr = `${diffHours}h ago`;
    }
    
    document.getElementById('lastScanTime').textContent = timeStr;
  } else {
    document.getElementById('lastScanTime').textContent = 'Never';
  }
}

async function updateScanningStatus() {
  const settings = await chrome.storage.local.get(['scanningEnabled']);
  const enabled = settings.scanningEnabled !== false;
  
  const statusDiv = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleScanning');
  const scanNowBtn = document.getElementById('scanNow');
  
  if (enabled) {
    statusDiv.textContent = 'Scanning enabled';
    statusDiv.className = 'status active';
    toggleBtn.textContent = 'Pause';
    toggleBtn.className = 'btn-secondary';
  } else {
    statusDiv.textContent = 'Scanning paused';
    statusDiv.className = 'status paused';
    toggleBtn.textContent = 'Resume';
    toggleBtn.className = 'btn-primary';
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
    scanStatusDiv.style.display = 'block';
    document.getElementById('scanStatusText').textContent = 'Scanning...';
    document.getElementById('pagesProcessed').textContent = runState.scanPagesProcessed || 0;
    document.getElementById('jobsScanned').textContent = runState.scanJobsScanned || 0;
    document.getElementById('newJobsRun').textContent = runState.scanNewJobs || 0;
    
    scanNowBtn.disabled = true;
    scanNowBtn.textContent = 'Scanning...';
  } else {
    scanStatusDiv.style.display = 'none';
    scanNowBtn.disabled = false;
    scanNowBtn.textContent = 'Scan Now';
  }
}

