// Connection Outreach Content Script for LinkedIn
// Runs on LinkedIn search results pages to send connection requests

const TARGET_TITLES = [
  'vp of operations',
  'vice president of operations', 
  'director of operations',
  'director of technology',
  'director of infrastructure',
  'director of platform',
  'head of operations',
  'cto',
  'chief technology officer',
  'data center manager',
  'head of data center',
  'recruiter',
  'technical recruiter',
  'talent partner',
  'talent acquisition',
  'director',
  'head of',
  'manager',
  'operations'
];

/**
 * Check if a title matches any of the target titles
 */
function matchesTargetTitle(title) {
  if (!title) return false;
  const lowerTitle = title.toLowerCase();
  return TARGET_TITLES.some(target => lowerTitle.includes(target));
}

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min = 1500, max = 4000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simulate a real click on an element
 */
function simulateClick(element) {
  if (!element) return;
  
  // Try multiple methods
  // 1. Native click
  element.click();
  
  // 2. Dispatch mouse events
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    }));
  });
}

/**
 * Get all profile cards from the search results
 */
function getProfileCards() {
  let cards = document.querySelectorAll('div[role="listitem"]');
  
  if (cards.length > 0) {
    console.log(`[ConnectionOutreach] Found ${cards.length} cards using div[role="listitem"]`);
    return Array.from(cards);
  }
  
  // Fallback
  const profileLinks = document.querySelectorAll('a[href*="/in/"][data-view-name="search-result-lockup-title"]');
  if (profileLinks.length > 0) {
    const containers = [];
    profileLinks.forEach(link => {
      let container = link.closest('div[role="listitem"]') || 
                      link.closest('[componentkey]');
      if (container && !containers.includes(container)) {
        containers.push(container);
      }
    });
    console.log(`[ConnectionOutreach] Found ${containers.length} cards via profile links`);
    return containers;
  }
  
  console.log('[ConnectionOutreach] No profile cards found');
  return [];
}

/**
 * Find the Connect link/button in a card
 */
function findConnectButton(card) {
  // Method 1: aria-label containing "Invite" and "connect"
  const connectLinks = card.querySelectorAll('a[aria-label*="Invite"][aria-label*="connect"]');
  if (connectLinks.length > 0) {
    return connectLinks[0];
  }
  
  // Method 2: href containing "search-custom-invite"
  const inviteLinks = card.querySelectorAll('a[href*="search-custom-invite"]');
  if (inviteLinks.length > 0) {
    return inviteLinks[0];
  }
  
  // Method 3: span with "Connect" text
  const spans = card.querySelectorAll('span');
  for (const span of spans) {
    const text = span.textContent?.trim();
    if (text === 'Connect') {
      const parentLink = span.closest('a') || span.closest('button');
      if (parentLink) {
        return parentLink;
      }
    }
  }
  
  // Method 4: buttons
  const buttons = card.querySelectorAll('button');
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if (text === 'connect') {
      return btn;
    }
  }
  
  return null;
}

/**
 * Extract profile data from a search result card
 */
function extractProfileData(card) {
  try {
    const profileLink = card.querySelector('a[href*="/in/"]');
    const profileUrl = profileLink?.href?.split('?')[0] || '';
    
    const nameLink = card.querySelector('a[data-view-name="search-result-lockup-title"]') ||
                     card.querySelector('a[href*="/in/"]');
    let profileName = nameLink?.textContent?.trim() || 'Unknown';
    profileName = profileName.split('\n')[0].trim().replace(/\s+/g, ' ');
    
    let title = '';
    const paragraphs = card.querySelectorAll('p');
    for (const p of paragraphs) {
      const text = p.textContent?.trim() || '';
      if (text.length > 10 && 
          !text.includes(profileName) && 
          !text.startsWith('Past:') &&
          !text.includes('mutual connection')) {
        title = text;
        break;
      }
    }
    
    const connectButton = findConnectButton(card);
    
    const cardText = card.textContent?.toLowerCase() || '';
    const isPending = cardText.includes('pending');
    const isConnected = cardText.includes('1st degree') || cardText.includes('• 1st');
    
    console.log(`[ConnectionOutreach] Profile: "${profileName}", HasConnect: ${!!connectButton}, Connected: ${isConnected}`);
    
    return {
      profileUrl,
      profileName,
      title,
      company: '',
      connectButton,
      isPending,
      isConnected,
      cardElement: card
    };
  } catch (error) {
    console.error('[ConnectionOutreach] Error extracting profile:', error);
    return null;
  }
}

/**
 * Wait for modal to appear and find the "Send without a note" button
 */
async function handleConnectionModal() {
  console.log('[ConnectionOutreach] Waiting for modal...');
  
  // Wait for modal to appear
  let modal = null;
  for (let i = 0; i < 10; i++) {
    await randomDelay(300, 500);
    
    // Try various modal selectors
    modal = document.querySelector('.artdeco-modal') ||
            document.querySelector('[role="dialog"]') ||
            document.querySelector('.send-invite') ||
            document.querySelector('[data-test-modal]');
    
    if (modal && modal.offsetParent !== null) { // Check if visible
      console.log('[ConnectionOutreach] Modal found!');
      break;
    }
  }
  
  if (!modal) {
    console.log('[ConnectionOutreach] No modal found after waiting');
    return { success: false, reason: 'No modal appeared' };
  }
  
  // Wait a bit for modal content to load
  await randomDelay(500, 800);
  
  // Debug: Log all buttons in modal
  const allButtons = modal.querySelectorAll('button');
  console.log(`[ConnectionOutreach] Modal has ${allButtons.length} buttons:`);
  allButtons.forEach((btn, i) => {
    console.log(`[ConnectionOutreach]   Button ${i}: "${btn.textContent?.trim()}" class="${btn.className}"`);
  });
  
  // Find "Send without a note" button - check ALL buttons on page (modal might be in different container)
  const allPageButtons = document.querySelectorAll('button');
  
  for (const btn of allPageButtons) {
    const text = btn.textContent?.trim() || '';
    const textLower = text.toLowerCase();
    
    // Look for "Send without a note" specifically
    if (textLower.includes('without') && textLower.includes('note')) {
      console.log(`[ConnectionOutreach] Found "Send without a note" button: "${text}"`);
      await randomDelay(300, 500);
      simulateClick(btn);
      await randomDelay(800, 1200);
      return { success: true, reason: 'Clicked "Send without a note"' };
    }
  }
  
  // Fallback: look for any "Send" button (not "Add a note")
  for (const btn of allPageButtons) {
    const text = btn.textContent?.trim() || '';
    const textLower = text.toLowerCase();
    
    if (textLower === 'send' || (textLower.startsWith('send') && !textLower.includes('add'))) {
      console.log(`[ConnectionOutreach] Found Send button: "${text}"`);
      await randomDelay(300, 500);
      simulateClick(btn);
      await randomDelay(800, 1200);
      return { success: true, reason: 'Clicked Send button' };
    }
  }
  
  // Try to close modal if we couldn't send
  const closeBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                   document.querySelector('.artdeco-modal__dismiss');
  if (closeBtn) {
    closeBtn.click();
    await randomDelay(300, 500);
  }
  
  return { success: false, reason: 'Could not find Send button in modal' };
}

/**
 * Send connection request to a profile
 */
async function sendConnectionRequest(connectElement, profileName) {
  try {
    console.log(`[ConnectionOutreach] ===== Connecting with ${profileName} =====`);
    
    // Scroll into view
    connectElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(500, 800);
    
    // Click the connect button/link
    console.log('[ConnectionOutreach] Clicking Connect...');
    simulateClick(connectElement);
    
    // Wait and handle modal
    await randomDelay(1500, 2500);
    
    // Check if modal appeared
    const result = await handleConnectionModal();
    
    if (result.success) {
      console.log(`[ConnectionOutreach] SUCCESS: ${result.reason}`);
      return result;
    }
    
    // Check for success indicators even if modal handling failed
    const toast = document.querySelector('.artdeco-toast-item--visible');
    if (toast?.textContent?.toLowerCase().includes('sent')) {
      return { success: true, reason: 'Invite sent (toast confirmed)' };
    }
    
    console.log(`[ConnectionOutreach] FAILED: ${result.reason}`);
    return result;
    
  } catch (error) {
    console.error('[ConnectionOutreach] Error:', error);
    return { success: false, reason: error.message };
  }
}

/**
 * Check for rate limits
 */
function detectRateLimit() {
  const pageText = document.body?.textContent?.toLowerCase() || '';
  const warnings = ['weekly invitation limit', 'too many pending', 'slow down', 'unusual activity'];
  return warnings.some(w => pageText.includes(w));
}

/**
 * Shuffle array
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Main processing function
 */
async function processOutreachPage(options = {}) {
  const { maxInvites = 5, sentProfileUrls = [] } = options;
  const results = [];
  
  console.log('[ConnectionOutreach] ========================================');
  console.log('[ConnectionOutreach] Processing page');
  console.log('[ConnectionOutreach] Max invites:', maxInvites);
  
  if (detectRateLimit()) {
    return { success: false, error: 'RATE_LIMIT', message: 'Rate limit detected', results: [] };
  }
  
  const cards = getProfileCards();
  console.log(`[ConnectionOutreach] Found ${cards.length} profile cards`);
  
  if (cards.length === 0) {
    return { success: true, sentCount: 0, results: [{ outcome: 'error', reason: 'No profiles found' }] };
  }
  
  const shuffledCards = shuffleArray(cards);
  let sentCount = 0;
  const sentUrls = new Set(sentProfileUrls.map(url => url.toLowerCase()));
  
  for (const card of shuffledCards) {
    if (sentCount >= maxInvites) {
      console.log('[ConnectionOutreach] Reached max invites for this page');
      break;
    }
    
    const profile = extractProfileData(card);
    if (!profile) continue;
    
    const logEntry = {
      profileUrl: profile.profileUrl,
      profileName: profile.profileName,
      title: profile.title,
      timestamp: Date.now()
    };
    
    // Skip checks
    if (profile.profileUrl && sentUrls.has(profile.profileUrl.toLowerCase())) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'Already sent';
      results.push(logEntry);
      continue;
    }
    
    if (profile.isConnected) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'Already connected';
      results.push(logEntry);
      continue;
    }
    
    if (profile.isPending) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'Pending';
      results.push(logEntry);
      continue;
    }
    
    if (!profile.connectButton) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'No connect button';
      results.push(logEntry);
      continue;
    }
    
    // Send connection request
    await randomDelay(1500, 3000);
    const sendResult = await sendConnectionRequest(profile.connectButton, profile.profileName);
    
    if (sendResult.success) {
      logEntry.outcome = 'sent';
      logEntry.reason = sendResult.reason;
      sentCount++;
      if (profile.profileUrl) {
        sentUrls.add(profile.profileUrl.toLowerCase());
      }
    } else {
      logEntry.outcome = 'error';
      logEntry.reason = sendResult.reason;
    }
    
    results.push(logEntry);
    
    // Delay between profiles
    await randomDelay(2000, 4000);
  }
  
  console.log('[ConnectionOutreach] ========================================');
  console.log('[ConnectionOutreach] Page complete. Sent:', sentCount);
  
  return { success: true, sentCount, results };
}

/**
 * Scroll page to load content
 */
async function scrollToLoadMore() {
  console.log('[ConnectionOutreach] Scrolling...');
  const viewportHeight = window.innerHeight;
  let currentScroll = 0;
  
  for (let i = 0; i < 3; i++) {
    currentScroll += viewportHeight * 0.7;
    window.scrollTo({ top: currentScroll, behavior: 'smooth' });
    await randomDelay(600, 1000);
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await randomDelay(500, 800);
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ConnectionOutreach] Message received:', message.action);
  
  if (message.action === 'processOutreach') {
    (async () => {
      try {
        if (message.scrollFirst) {
          await scrollToLoadMore();
        }
        
        const result = await processOutreachPage({
          maxInvites: message.maxInvites || 5,
          sentProfileUrls: message.sentProfileUrls || []
        });
        
        sendResponse(result);
      } catch (error) {
        console.error('[ConnectionOutreach] Error:', error);
        sendResponse({ success: false, error: 'SCRIPT_ERROR', message: error.message, results: [] });
      }
    })();
    
    return true;
  }
  
  if (message.action === 'checkOutreachPage') {
    const cards = getProfileCards();
    sendResponse({ isValidPage: cards.length > 0, profileCount: cards.length });
    return true;
  }
});

// Initial log
console.log('[ConnectionOutreach] Content script loaded on:', window.location.href);

// Diagnostic after page loads
setTimeout(() => {
  const cards = getProfileCards();
  console.log('[ConnectionOutreach] Initial diagnostics - Cards found:', cards.length);
}, 2000);
