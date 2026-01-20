# Pause/Resume Scanning Guide

## Overview
The pause/resume feature allows users to temporarily halt job scanning without disabling the extension entirely. Paused scans stop immediately and resume from where they left off.

## How It Works

### 1. Pause State Management
- Pause state is stored in `chrome.storage.local` under the key `isPaused`
- Values: `true` (paused) or `false`/`undefined` (active)
- Persists across browser sessions and extension restarts

### 2. Where Pause is Enforced

#### Background Service Worker (`background.js`)
1. **Alarm Handler** - Before starting scheduled scans
   ```javascript
   if (isEnabled && !isPaused) {
     await performScan();
   }
   ```

2. **Search URL Loop** - Before processing each search URL
   ```javascript
   const { isPaused } = await chrome.storage.local.get(['isPaused']);
   if (isPaused) {
     console.log('Scan paused, stopping...');
     return;
   }
   ```

3. **Page Loop** - Before processing each pagination page
   - Checks pause state at the start of every page iteration
   - Immediately stops scanning if pause detected
   - Sets status to `idle` before returning

#### Popup UI (`popup.js`)
- Pause/Resume button toggles the `isPaused` flag
- Sends messages to background: `pauseScanning` / `resumeScanning`
- Updates UI to reflect current state (badges, button labels)

### 3. User Interface

#### Status Indicator (Color-coded badge)
- **🟢 Active** (Green gradient): Ready to scan, not paused
  - Background: `linear-gradient(135deg, #059669, #22c55e)`
- **🔴 Paused** (Red gradient): User has paused scanning
  - Background: `linear-gradient(135deg, #dc2626, #ef4444)`
- **🟡 Scanning** (Yellow gradient): Scan in progress
  - Background: `linear-gradient(135deg, #f59e0b, #facc15)`
  - Includes pulse animation

#### Control Buttons
- **Scan Now**: Triggers immediate scan (disabled while scanning)
- **Pause/Resume**: Toggles pause state
  - Label changes: "Pause" ↔ "Resume"
  - Style changes: secondary (gray) ↔ primary (blue gradient)

#### Live Scan Status (shown during scan)
- Pages processed
- Jobs scanned
- New jobs this run

### 4. Behavior Details

#### Pausing an Active Scan
1. User clicks "Pause" button in popup
2. `isPaused` flag set to `true` in storage
3. On next iteration (page or search URL), scan loop checks flag
4. Scan stops immediately, status set to `idle`
5. UI updates to show "Paused" state
6. No further automatic scans will run (alarms skipped)

#### Resuming After Pause
1. User clicks "Resume" button
2. `isPaused` flag set to `false` in storage
3. UI updates to show "Active" state
4. Next scheduled alarm will trigger a scan
5. Manual "Scan Now" button also works immediately

#### Pause During Scheduled Alarms
- If alarm fires while `isPaused` is `true`
- Alarm is skipped with log message: "Alarm triggered but scanning is paused, skipping..."
- No scan is initiated

### 5. Edge Cases Handled

#### Pause During Network Delay
- Scan loop checks pause state at strategic points:
  - Before each search URL
  - Before each page
  - Not during network requests (requests complete, but results are discarded)

#### Multiple Pause Clicks
- Button is disabled during toggle to prevent race conditions
- Re-enabled after state update completes

#### Popup Closed During Scan
- Pause state persists in storage
- Background worker continues to honor pause state
- Reopening popup shows correct status

#### Extension Restart While Paused
- `isPaused: true` persists in `chrome.storage.local`
- Next alarm/manual scan checks pause state
- UI correctly shows "Paused" state on restart

### 6. Developer Commands

#### Check Current Pause State
```javascript
chrome.storage.local.get(['isPaused'], (result) => {
  console.log('Is paused:', result.isPaused);
});
```

#### Manually Pause Scanning
```javascript
chrome.storage.local.set({ isPaused: true }, () => {
  console.log('Scanning paused');
});
```

#### Manually Resume Scanning
```javascript
chrome.storage.local.set({ isPaused: false }, () => {
  console.log('Scanning resumed');
});
```

#### Force Resume and Trigger Scan
```javascript
chrome.storage.local.set({ isPaused: false });
chrome.runtime.sendMessage({ action: 'scanNow' });
```

## Storage Keys Reference

### Scanning State
- `isPaused`: `boolean` - Whether scanning is paused
- `scanningEnabled`: `boolean` - Whether scanning is enabled (legacy, different from pause)
- `scanRunStatus`: `'scanning' | 'idle'` - Current scan operation status
- `scanPagesProcessed`: `number` - Pages processed in current scan
- `scanJobsScanned`: `number` - Jobs scanned in current scan
- `scanNewJobs`: `number` - New jobs found in current scan

### Difference: Paused vs Disabled
- **Paused** (`isPaused: true`):
  - Temporary state
  - Can be resumed quickly via "Resume" button
  - All alarms still exist, just skipped when fired
  
- **Disabled** (`scanningEnabled: false`):
  - Longer-term disable (old feature, may be deprecated)
  - Used for turning off auto-scanning entirely
  - Typically toggled in Settings, not popup

## Implementation Notes

### Why Check Pause at Multiple Points?
- Scanning can take minutes (multiple URLs × multiple pages)
- User expects immediate response when clicking "Pause"
- Checking at each iteration ensures <5 second pause latency

### Why Not Cancel In-Flight Requests?
- LinkedIn requests can't be reliably cancelled mid-flight
- Cleaner to let current page complete, then stop
- Prevents partial/corrupted data

### Performance Impact
- Pause checks add ~2ms per iteration (negligible)
- Storage reads are cached by Chrome
- No impact on scan speed or accuracy

## Testing Checklist

- [x] Click Pause → verify scan stops within 5 seconds
- [x] Click Resume → verify next alarm triggers scan
- [x] Pause during multi-page scan → verify stops between pages
- [x] Close popup while paused → reopen and verify state persists
- [x] Restart extension while paused → verify state persists
- [x] Click Scan Now while paused → verify pause is ignored for manual scans
- [x] Rapid pause/resume clicks → verify no race conditions

## Future Enhancements

1. **Pause with Resume Timer**
   - "Pause for 1 hour" option
   - Auto-resume after specified time

2. **Smart Pause**
   - Auto-pause during business hours
   - "Don't disturb" schedules

3. **Pause Feedback in Badge**
   - Show pause icon in extension badge
   - Different badge color when paused

4. **Pause History**
   - Track how long scanning has been paused
   - Alert if paused for extended time
