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
 * Get all profile cards from the search results
 * Based on actual LinkedIn HTML: div[role="listitem"] inside the main content
 */
function getProfileCards() {
  // The profile cards are divs with role="listitem"
  let cards = document.querySelectorAll('div[role="listitem"]');
  
  if (cards.length > 0) {
    console.log(`[ConnectionOutreach] Found ${cards.length} cards using div[role="listitem"]`);
    return Array.from(cards);
  }
  
  // Fallback: look for containers with profile links
  const profileLinks = document.querySelectorAll('a[href*="/in/"][data-view-name="search-result-lockup-title"]');
  if (profileLinks.length > 0) {
    // Get the parent containers
    const containers = [];
    profileLinks.forEach(link => {
      // Go up to find a reasonable container
      let container = link.closest('div[role="listitem"]') || 
                      link.closest('[componentkey]') ||
                      link.parentElement?.parentElement?.parentElement?.parentElement;
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
 * LinkedIn uses <a> tags with aria-label="Invite X to connect"
 */
function findConnectButton(card) {
  // Method 1: Look for <a> with aria-label containing "Invite" and "connect"
  const connectLinks = card.querySelectorAll('a[aria-label*="Invite"][aria-label*="connect"]');
  if (connectLinks.length > 0) {
    console.log('[ConnectionOutreach] Found Connect link via aria-label');
    return connectLinks[0];
  }
  
  // Method 2: Look for <a> with href containing "search-custom-invite"
  const inviteLinks = card.querySelectorAll('a[href*="search-custom-invite"]');
  if (inviteLinks.length > 0) {
    console.log('[ConnectionOutreach] Found Connect link via href');
    return inviteLinks[0];
  }
  
  // Method 3: Look for element containing "Connect" text within the card actions area
  const allLinks = card.querySelectorAll('a');
  for (const link of allLinks) {
    const text = link.textContent?.trim().toLowerCase() || '';
    if (text === 'connect') {
      console.log('[ConnectionOutreach] Found Connect link via text content');
      return link;
    }
  }
  
  // Method 4: Look for buttons as fallback
  const buttons = card.querySelectorAll('button');
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    if (text === 'connect' || ariaLabel.includes('connect')) {
      console.log('[ConnectionOutreach] Found Connect button');
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
    // Profile URL - look for link with /in/ in href
    const profileLink = card.querySelector('a[href*="/in/"]');
    const profileUrl = profileLink?.href?.split('?')[0] || '';
    
    // Name - look for the title link
    const nameLink = card.querySelector('a[data-view-name="search-result-lockup-title"]') ||
                     card.querySelector('a[href*="/in/"]');
    let profileName = nameLink?.textContent?.trim() || 'Unknown';
    // Clean up the name (remove extra whitespace, degree indicators, etc.)
    profileName = profileName.split('\n')[0].trim().replace(/\s+/g, ' ');
    
    // Title/headline - usually in a paragraph after the name
    // Look for the primary subtitle or job title paragraph
    let title = '';
    const paragraphs = card.querySelectorAll('p');
    for (const p of paragraphs) {
      const text = p.textContent?.trim() || '';
      // Skip very short text, name duplicates, and location-only text
      if (text.length > 10 && 
          !text.includes(profileName) && 
          !text.startsWith('Past:') &&
          !text.includes('mutual connection')) {
        // This is likely the job title
        title = text;
        break;
      }
    }
    
    // Alternative: look for specific class patterns
    if (!title) {
      const subtitleEl = card.querySelector('.entity-result__primary-subtitle') ||
                         card.querySelector('p._02249ad5');
      if (subtitleEl) {
        title = subtitleEl.textContent?.trim() || '';
      }
    }
    
    // Find connect button/link
    const connectButton = findConnectButton(card);
    
    // Check connection status
    const cardText = card.textContent?.toLowerCase() || '';
    const isPending = cardText.includes('pending');
    const isConnected = cardText.includes('1st degree') || cardText.includes('• 1st');
    const isFollowing = cardText.includes('following');
    
    // Check if there's already a "Message" button instead of Connect (means already connected)
    const hasMessageBtn = card.querySelector('a[href*="/messaging/"]') || 
                          card.textContent?.toLowerCase().includes('message');
    
    console.log(`[ConnectionOutreach] Profile: "${profileName}", Title: "${title.substring(0, 50)}...", HasConnect: ${!!connectButton}, Connected: ${isConnected}`);
    
    return {
      profileUrl,
      profileName,
      title,
      company: '',
      connectButton,
      isPending,
      isConnected: isConnected || hasMessageBtn,
      isFollowing,
      cardElement: card
    };
  } catch (error) {
    console.error('[ConnectionOutreach] Error extracting profile data:', error);
    return null;
  }
}

/**
 * Click the Connect link/button and handle the modal
 */
async function sendConnectionRequest(connectElement, profileName) {
  try {
    console.log(`[ConnectionOutreach] Attempting to connect with ${profileName}...`);
    
    // Scroll element into view
    connectElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(500, 1000);
    
    // Click the Connect link/button
    console.log('[ConnectionOutreach] Clicking Connect element...');
    connectElement.click();
    await randomDelay(1500, 2500);
    
    // Look for the modal that appears
    let modal = document.querySelector('.artdeco-modal') ||
                document.querySelector('[role="dialog"]') ||
                document.querySelector('.send-invite') ||
                document.querySelector('[data-test-modal]');
    
    // Wait a bit more if no modal
    if (!modal) {
      await randomDelay(1000, 1500);
      modal = document.querySelector('.artdeco-modal') ||
              document.querySelector('[role="dialog"]');
    }
    
    if (!modal) {
      // Check if invite was sent directly (some profiles allow this)
      console.log('[ConnectionOutreach] No modal appeared - checking if direct invite was sent');
      
      // Look for success message or toast
      const successToast = document.querySelector('.artdeco-toast-item--visible');
      if (successToast?.textContent?.toLowerCase().includes('sent')) {
        return { success: true, reason: 'Direct invite sent (no modal)' };
      }
      
      return { success: true, reason: 'Direct connect attempted (no modal verification)' };
    }
    
    console.log('[ConnectionOutreach] Modal appeared, looking for Send without a note button...');
    
    // Log all buttons in modal for debugging
    const allModalButtons = modal.querySelectorAll('button');
    console.log(`[ConnectionOutreach] Found ${allModalButtons.length} buttons in modal`);
    
    // First, specifically look for "Send without a note" button
    for (const btn of allModalButtons) {
      const text = btn.textContent?.trim() || '';
      const textLower = text.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      
      console.log(`[ConnectionOutreach] Modal button: "${text}"`);
      
      // Specifically match "Send without a note"
      if (textLower.includes('send without') || textLower === 'send without a note') {
        console.log('[ConnectionOutreach] Found "Send without a note" button, clicking...');
        btn.click();
        await randomDelay(1000, 1500);
        return { success: true, reason: 'Invite sent (without note)' };
      }
    }
    
    // Second pass: look for any "Send" button that's not "Add a note"
    for (const btn of allModalButtons) {
      const text = btn.textContent?.trim().toLowerCase() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      
      // Skip "Add a note" button
      if (text.includes('add') || ariaLabel.includes('add')) {
        continue;
      }
      
      // Match various "Send" patterns
      if (text === 'send' || text === 'send now' || text.startsWith('send')) {
        console.log('[ConnectionOutreach] Found Send button, clicking...');
        btn.click();
        await randomDelay(1000, 1500);
        return { success: true, reason: 'Invite sent via modal' };
      }
    }
    
    // Third: Try secondary/tertiary button (often "Send without a note" is styled differently)
    const secondaryBtn = modal.querySelector('button.artdeco-button--secondary') ||
                         modal.querySelector('button.artdeco-button--tertiary') ||
                         modal.querySelector('button.artdeco-button--muted');
    if (secondaryBtn) {
      const text = secondaryBtn.textContent?.trim().toLowerCase() || '';
      console.log(`[ConnectionOutreach] Secondary button text: "${text}"`);
      if (text.includes('send') && !text.includes('add')) {
        console.log('[ConnectionOutreach] Clicking secondary Send button...');
        secondaryBtn.click();
        await randomDelay(1000, 1500);
        return { success: true, reason: 'Invite sent via secondary button' };
      }
    }
    
    // Fourth: Try primary button as last resort
    const primaryBtn = modal.querySelector('button.artdeco-button--primary');
    if (primaryBtn) {
      const text = primaryBtn.textContent?.trim().toLowerCase() || '';
      console.log(`[ConnectionOutreach] Primary button text: "${text}"`);
      // Only click if it's actually a send button
      if (text.includes('send') && !text.includes('add')) {
        primaryBtn.click();
        await randomDelay(1000, 1500);
        return { success: true, reason: 'Invite sent via primary button' };
      }
    }
    
    // Close modal if we couldn't send
    console.log('[ConnectionOutreach] Could not find Send button, closing modal');
    const closeBtn = modal.querySelector('button[aria-label="Dismiss"]') ||
                     modal.querySelector('button.artdeco-modal__dismiss') ||
                     modal.querySelector('[data-test-modal-close-btn]') ||
                     modal.querySelector('button[aria-label="Cancel"]');
    if (closeBtn) {
      closeBtn.click();
      await randomDelay(300, 600);
    } else {
      // Try pressing Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
      await randomDelay(300, 600);
    }
    
    return { success: false, reason: 'Could not find Send button in modal' };
    
  } catch (error) {
    console.error('[ConnectionOutreach] Error sending request:', error);
    return { success: false, reason: error.message };
  }
}

/**
 * Check for LinkedIn rate limit warnings
 */
function detectRateLimit() {
  const pageText = document.body?.textContent?.toLowerCase() || '';
  const warningIndicators = [
    'you\'ve reached the weekly invitation limit',
    'too many pending invitations',
    'invitation limit',
    'slow down',
    'unusual activity',
    'verify your identity',
    'security check'
  ];
  
  return warningIndicators.some(indicator => pageText.includes(indicator));
}

/**
 * Shuffle array randomly
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
 * Main function to process profiles on the page
 */
async function processOutreachPage(options = {}) {
  const { maxInvites = 5, sentProfileUrls = [] } = options;
  const results = [];
  
  console.log('[ConnectionOutreach] ========================================');
  console.log('[ConnectionOutreach] Starting page processing');
  console.log('[ConnectionOutreach] Max invites:', maxInvites);
  console.log('[ConnectionOutreach] Already sent to:', sentProfileUrls.length, 'profiles');
  
  // Check for rate limits first
  if (detectRateLimit()) {
    console.warn('[ConnectionOutreach] Rate limit detected!');
    return {
      success: false,
      error: 'RATE_LIMIT',
      message: 'LinkedIn rate limit or warning detected',
      results: []
    };
  }
  
  // Get profile cards
  const cards = getProfileCards();
  console.log(`[ConnectionOutreach] Found ${cards.length} total profile cards`);
  
  if (cards.length === 0) {
    // Debug: log the page structure
    console.log('[ConnectionOutreach] DEBUG: Page HTML sample:', document.body?.innerHTML?.substring(0, 2000));
    return {
      success: true,
      sentCount: 0,
      results: [{
        profileUrl: '',
        profileName: 'SYSTEM',
        title: '',
        company: '',
        outcome: 'error',
        reason: 'No profile cards found on page - check console for debug info'
      }]
    };
  }
  
  // Shuffle for randomization
  const shuffledCards = shuffleArray(cards);
  
  let sentCount = 0;
  const sentUrls = new Set(sentProfileUrls.map(url => url.toLowerCase()));
  let processedCount = 0;
  
  for (const card of shuffledCards) {
    if (sentCount >= maxInvites) {
      console.log('[ConnectionOutreach] Reached max invites for this run');
      break;
    }
    
    processedCount++;
    
    // Check rate limit periodically
    if (processedCount % 5 === 0 && detectRateLimit()) {
      console.warn('[ConnectionOutreach] Rate limit detected mid-processing!');
      return {
        success: false,
        error: 'RATE_LIMIT',
        message: 'LinkedIn rate limit detected',
        results
      };
    }
    
    const profile = extractProfileData(card);
    if (!profile) {
      console.log('[ConnectionOutreach] Could not extract profile data from card');
      continue;
    }
    
    const logEntry = {
      profileUrl: profile.profileUrl,
      profileName: profile.profileName,
      title: profile.title,
      company: profile.company,
      timestamp: Date.now()
    };
    
    // Skip if already sent
    if (profile.profileUrl && sentUrls.has(profile.profileUrl.toLowerCase())) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'Already sent invite';
      results.push(logEntry);
      continue;
    }
    
    // Skip if connected or pending
    if (profile.isConnected) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'Already connected';
      results.push(logEntry);
      continue;
    }
    
    if (profile.isPending) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'Pending invitation';
      results.push(logEntry);
      continue;
    }
    
    // Skip if no connect button
    if (!profile.connectButton) {
      logEntry.outcome = 'skipped';
      logEntry.reason = 'No connect button found';
      results.push(logEntry);
      continue;
    }
    
    // For now, we're not filtering by title to test the connection flow
    // Uncomment this to enable title filtering:
    // if (!matchesTargetTitle(profile.title)) {
    //   logEntry.outcome = 'skipped';
    //   logEntry.reason = 'Title does not match targets';
    //   results.push(logEntry);
    //   continue;
    // }
    
    // Add random delay before action
    console.log(`[ConnectionOutreach] Will connect with: ${profile.profileName}`);
    await randomDelay(2000, 4000);
    
    // Try to send connection request
    const sendResult = await sendConnectionRequest(profile.connectButton, profile.profileName);
    
    if (sendResult.success) {
      logEntry.outcome = 'sent';
      logEntry.reason = sendResult.reason;
      sentCount++;
      if (profile.profileUrl) {
        sentUrls.add(profile.profileUrl.toLowerCase());
      }
      console.log(`[ConnectionOutreach] SUCCESS: ${profile.profileName} - ${sendResult.reason}`);
    } else {
      logEntry.outcome = 'error';
      logEntry.reason = sendResult.reason;
      console.warn(`[ConnectionOutreach] FAILED: ${profile.profileName} - ${sendResult.reason}`);
    }
    
    results.push(logEntry);
    
    // Random delay between invites
    await randomDelay(3000, 6000);
  }
  
  console.log('[ConnectionOutreach] ========================================');
  console.log('[ConnectionOutreach] Processing complete');
  console.log('[ConnectionOutreach] Sent:', sentCount);
  console.log('[ConnectionOutreach] Total results:', results.length);
  
  return {
    success: true,
    sentCount,
    results
  };
}

/**
 * Scroll to load more results
 */
async function scrollToLoadMore() {
  console.log('[ConnectionOutreach] Scrolling to load more results...');
  const scrollHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  let currentScroll = 0;
  
  while (currentScroll < scrollHeight - viewportHeight) {
    currentScroll += viewportHeight * 0.8;
    window.scrollTo({ top: currentScroll, behavior: 'smooth' });
    await randomDelay(800, 1500);
  }
  
  // Scroll back to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await randomDelay(500, 1000);
  console.log('[ConnectionOutreach] Scrolling complete');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ConnectionOutreach] Received message:', message.action);
  
  if (message.action === 'processOutreach') {
    (async () => {
      try {
        // Optionally scroll to load more results
        if (message.scrollFirst) {
          await scrollToLoadMore();
        }
        
        const result = await processOutreachPage({
          maxInvites: message.maxInvites || 5,
          sentProfileUrls: message.sentProfileUrls || []
        });
        
        console.log('[ConnectionOutreach] Sending response:', JSON.stringify(result).substring(0, 500));
        sendResponse(result);
      } catch (error) {
        console.error('[ConnectionOutreach] Error:', error);
        sendResponse({
          success: false,
          error: 'SCRIPT_ERROR',
          message: error.message,
          results: []
        });
      }
    })();
    
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'checkOutreachPage') {
    const cards = getProfileCards();
    sendResponse({
      isValidPage: cards.length > 0,
      profileCount: cards.length
    });
    return true;
  }
});

// Log when script loads and do initial diagnostics
console.log('[ConnectionOutreach] ========================================');
console.log('[ConnectionOutreach] Content script loaded');
console.log('[ConnectionOutreach] URL:', window.location.href);

// Run diagnostics after page settles
setTimeout(() => {
  console.log('[ConnectionOutreach] Running initial diagnostics...');
  const cards = getProfileCards();
  console.log('[ConnectionOutreach] Initial card count:', cards.length);
  
  if (cards.length > 0) {
    console.log('[ConnectionOutreach] First card sample:');
    const firstProfile = extractProfileData(cards[0]);
    if (firstProfile) {
      console.log('[ConnectionOutreach] - Name:', firstProfile.profileName);
      console.log('[ConnectionOutreach] - Title:', firstProfile.title);
      console.log('[ConnectionOutreach] - URL:', firstProfile.profileUrl);
      console.log('[ConnectionOutreach] - Has Connect:', !!firstProfile.connectButton);
    }
  } else {
    // Log some debug info about the page structure
    const listItems = document.querySelectorAll('[role="listitem"]');
    console.log('[ConnectionOutreach] Found [role="listitem"] elements:', listItems.length);
    
    const profileLinks = document.querySelectorAll('a[href*="/in/"]');
    console.log('[ConnectionOutreach] Found profile links (a[href*="/in/"]):', profileLinks.length);
    
    const connectElements = document.querySelectorAll('a[aria-label*="connect"], button[aria-label*="connect"]');
    console.log('[ConnectionOutreach] Found connect elements:', connectElements.length);
  }
  console.log('[ConnectionOutreach] ========================================');
}, 3000);
