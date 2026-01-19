# Job Exclusions System Guide

## Overview
The "Not Valid" feature allows users to permanently hide jobs they're not interested in. Excluded jobs will never appear again in future scans or when reloading the extension.

## How It Works

### 1. Exclusion Storage
- Excluded jobs are stored in `chrome.storage.local` under the key `excludedJobs`
- Each job is identified by a unique key (see below)
- Exclusions persist across browser sessions and extension restarts

### 2. Job Unique Key Generation
The system uses the following priority to generate a unique key:

1. **Primary**: Job URL (most stable identifier)
   - Example: `url:https://www.linkedin.com/jobs/view/12345678`
   - URL is normalized (removes query params, trailing slashes)

2. **Fallback**: Composite key from job attributes
   - Format: `composite:company|title|location|datePosted`
   - Example: `composite:google|software engineer|san francisco|2 days ago`
   - All values are lowercased and trimmed

### 3. Filtering Points
Exclusions are applied at three points:

1. **During Job Scanning** (`background.js`)
   - Excluded jobs are filtered out immediately after scraping
   - Never stored or processed, saving memory and compute

2. **At Render Time** (`options.js`)
   - Jobs are filtered before display in the Results tab
   - Ensures excluded jobs don't appear even if they were somehow stored

3. **On User Action**
   - When marking a job as "Not Valid", it's immediately removed from:
     - Active jobs list
     - UI (with fade-out animation)

### 4. User Interface
- **Split-button Dropdown**: Each job card has a grouped action control
  - Primary button: "Apply" (opens job in new tab)
  - Dropdown menu with additional actions:
    - Apply
    - Why? (if match explanation available)
    - Save to Sheet
    - **Not Valid** (marks and excludes job)

- **Confirmation Dialog**: Before excluding, users must confirm:
  ```
  Mark "[Job Title]" as not valid?
  
  This job will be hidden forever and won't appear in future scans.
  ```

- **Visual Feedback**:
  - Toast notification: "Job marked as not valid and excluded"
  - Smooth fade-out animation when card is removed
  - Empty state message if all jobs are excluded

## Developer Commands

### Clear All Exclusions
To clear all excluded jobs (useful for testing or debugging):

```javascript
// Option 1: Using the storage module
import('./scripts/storage.js').then(m => m.clearExcludedJobs()).then(count => {
  console.log(`Cleared ${count} excluded jobs`);
});

// Option 2: Direct storage access
chrome.storage.local.set({ excludedJobs: [] }, () => {
  console.log('All exclusions cleared');
});
```

### View Current Exclusions
```javascript
chrome.storage.local.get(['excludedJobs'], (result) => {
  console.log('Excluded jobs:', result.excludedJobs);
  console.log('Total excluded:', (result.excludedJobs || []).length);
});
```

### Check if Specific Job is Excluded
```javascript
// In browser console on options page
import('./scripts/storage.js').then(async (m) => {
  const job = { 
    url: 'https://www.linkedin.com/jobs/view/12345678',
    title: 'Software Engineer',
    company: 'Google'
  };
  const isExcluded = await m.isJobExcluded(job);
  console.log('Is excluded:', isExcluded);
  const jobKey = m.getJobKey(job);
  console.log('Job key:', jobKey);
});
```

### Remove Specific Job from Exclusion List
```javascript
import('./scripts/storage.js').then(async (m) => {
  const job = { 
    url: 'https://www.linkedin.com/jobs/view/12345678'
  };
  await m.unexcludeJob(job);
  console.log('Job removed from exclusion list');
});
```

## Edge Cases Handled

1. **Jobs Without URLs**
   - System falls back to composite key based on company + title + location + date
   - Ensures even incomplete job data can be excluded

2. **Extension Restarts**
   - Exclusions are persisted in `chrome.storage.local`
   - Automatically loaded and applied on every render and scan

3. **Duplicate Jobs**
   - If the same job appears multiple times, marking one as "Not Valid" excludes all instances
   - URL-based matching ensures consistency

4. **Empty Results**
   - If all jobs on a page are excluded, displays friendly message:
     "No jobs to display. All jobs have been filtered."

5. **Concurrent Scans**
   - Exclusion list is checked at the start of each scan
   - New exclusions are immediately effective for ongoing scans

## Data Integrity

### Storage Format
```javascript
{
  "excludedJobs": [
    "url:https://www.linkedin.com/jobs/view/12345678",
    "url:https://www.linkedin.com/jobs/view/87654321",
    "composite:company|title|location|date"
  ]
}
```

### Performance Considerations
- Uses Set data structure for O(1) lookups
- Array storage in chrome.storage.local (Sets aren't serializable)
- Minimal memory footprint (only stores keys, not full job objects)

### Storage Limits
- Chrome storage.local limit: 10MB
- Estimated capacity: ~200,000 excluded job keys
- No automatic cleanup (users must manually clear if needed)

## Testing Checklist

- [x] Exclude a job → verify it disappears from UI
- [x] Restart extension → verify excluded job doesn't reappear
- [x] Run new scan → verify excluded job isn't re-added
- [x] Exclude multiple jobs → verify all are filtered
- [x] Test with job without URL → verify composite key works
- [x] Test dropdown UI → verify all actions work correctly
- [x] Test confirmation dialog → verify it shows before excluding
- [x] Test toast notifications → verify feedback appears
- [x] Clear exclusions → verify jobs reappear

## Future Enhancements

Potential improvements for future versions:

1. **Exclusion Management UI**
   - Add a "Manage Exclusions" section in Settings
   - List all excluded jobs with ability to un-exclude

2. **Bulk Operations**
   - "Exclude all from company X"
   - "Exclude all with score < Y"

3. **Temporary Exclusions**
   - Option to exclude for X days only
   - Auto-expire old exclusions

4. **Export/Import**
   - Export exclusion list for backup
   - Share exclusions across devices

5. **Smart Exclusions**
   - Auto-exclude based on patterns
   - "Never show me jobs like this"

## Troubleshooting

### Jobs Reappearing After Exclusion
1. Check if job URL changed (LinkedIn sometimes updates job URLs)
2. Verify exclusions are stored: run `chrome.storage.local.get(['excludedJobs'])`
3. Check browser console for errors during filtering

### Exclusions Not Working During Scan
1. Verify background.js is filtering correctly (check console logs)
2. Look for errors in service worker console
3. Ensure storage.js module is being imported correctly

### Performance Issues
1. If you have >10,000 exclusions, consider clearing old ones
2. Check memory usage in Chrome Task Manager
3. Run `clearExcludedJobs()` to reset
