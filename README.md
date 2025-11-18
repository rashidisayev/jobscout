# JobScout - LinkedIn Job Monitor Chrome Extension

JobScout is a Chrome Extension (Manifest V3) that helps you monitor LinkedIn Jobs, collect new roles automatically, and match them with your resumes using NLP-based similarity scoring.

## Features

- **Hourly Scanning**: Automatically scans LinkedIn job searches at configurable intervals
- **Multiple Search URLs**: Add 3-10 LinkedIn job search URLs to monitor
- **Resume Matching**: Upload up to 5 resumes and get automatic matching scores for each job
- **NLP-Based Scoring**: Uses TF-IDF and cosine similarity to match job descriptions with resumes
- **Local Storage**: All data stored locally in your browser - no external servers
- **CSV Export**: Export all collected jobs with matching scores
- **Privacy-Focused**: Respects LinkedIn's Terms of Service, requires you to be logged in

## Installation

### Step 1: Download the Extension

1. Download or clone this repository to your computer
2. Make sure all files are in the `jobscout` folder

### Step 2: Load in Chrome

1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `jobscout` folder
6. The extension should now appear in your extensions list

### Step 3: Set Up Icon Assets (Optional)

The extension requires icon files. You can create simple icons or use placeholder images:

- `assets/icon16.png` (16x16 pixels)
- `assets/icon48.png` (48x48 pixels)
- `assets/icon128.png` (128x128 pixels)

You can create these using any image editor, or use online tools like [Favicon Generator](https://www.favicon-generator.org/).

### Step 4: Install PDF.js (Optional, for PDF resume parsing)

For PDF resume parsing support:

1. **Download PDF.js**:
   - Visit https://mozilla.github.io/pdf.js/
   - Download the latest version or use npm: `npm install pdfjs-dist`

2. **Copy Required Files** to `vendor/pdfjs/`:
   - `pdf.mjs` (main PDF.js ES module) - from `build/pdf.mjs` or `legacy/build/pdf.min.mjs` (rename to `pdf.mjs`)
   - `pdf.worker.mjs` (worker file) - from `build/pdf.worker.mjs` or `legacy/build/pdf.worker.min.mjs` (rename to `pdf.worker.mjs`)
   - Source map files (`.map`) are optional

3. **File Structure**:
   ```
   vendor/pdfjs/
   ├── pdf.mjs
   ├── pdf.worker.mjs
   └── *.map (optional)
   ```

4. **Note**: The extension will work without PDF.js, but PDF resume parsing will not be available. TXT and DOCX files will still work.

See `vendor/pdfjs/README.md` for detailed instructions.

## Usage

### Initial Setup

1. **Right-click the JobScout extension icon** and select **Options** (or click the extension icon and then "Open Options")

2. **Add Search URLs**:
   - Go to LinkedIn Jobs and perform a search
   - Copy the URL from your browser's address bar
   - Paste it into the "Search URLs" tab in JobScout options
   - Click "Add URL"
   - Repeat for up to 10 different searches

3. **Upload Resumes**:
   - Go to the "Resumes" tab
   - Click "Upload Resume" for each slot (up to 5)
   - Supported formats: PDF, DOCX, TXT
   - The extension will parse and store the text content

4. **Configure Settings**:
   - Set your preferred scan interval (default: 60 minutes)
   - Toggle "Only show new roles since last scan"
   - Click "Save Settings"

### Using the Extension

- **Popup**: Click the extension icon to see:
  - Number of new jobs since last scan
  - Total jobs collected
  - Last scan time
  - Quick "Scan Now" button
  - Pause/Resume scanning toggle

- **Manual Scan**: Click "Scan Now" in the popup to immediately scan all configured search URLs

- **View Results**: 
  - Go to Options → Results tab
  - Filter and sort jobs by date, score, or company
  - Click "View" to open job listings in LinkedIn
  - See which resume matches best and the similarity score

- **Export Data**: Click "Export CSV" in the Results tab to download all jobs as a CSV file

## How It Works

1. **Scanning Process**:
   - The extension opens a hidden tab (or reuses an existing LinkedIn tab)
   - Navigates to each configured search URL
   - Scrolls to load more jobs (limited to avoid infinite scrolling)
   - Extracts job information: title, company, location, date, link
   - For each job, fetches the full job description
   - Stores results locally with timestamps

2. **Resume Matching**:
   - Uses TF-IDF (Term Frequency-Inverse Document Frequency) to analyze text
   - Calculates cosine similarity between job descriptions and resume text
   - Returns a score from 0-1 (0% to 100% match)
   - Identifies top matching keywords

3. **Deduplication**:
   - Each job is assigned a unique ID based on its URL
   - Duplicate jobs are automatically filtered out
   - Only new jobs since the last scan are shown (if enabled)

## Privacy & Terms of Service

**Important**: JobScout is designed to respect LinkedIn's Terms of Service:

- ✅ **No credential bypassing**: You must be logged into LinkedIn
- ✅ **User-initiated**: Only runs when you install and configure it
- ✅ **Rate-limited**: Includes random delays between actions (1.5-3.5 seconds)
- ✅ **Local-only**: All data stored in your browser, no external servers
- ✅ **No automation of login**: Requires manual login to LinkedIn

**Disclaimer**: This tool is for personal use only. You are responsible for ensuring your use complies with LinkedIn's Terms of Service. The extension does not bypass any authentication or access controls - it only works when you are already logged into LinkedIn.

## File Structure

```
jobsearch/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker for alarms and scanning
├── content.js             # Content script for LinkedIn scraping
├── popup.html/js          # Extension popup UI
├── options.html/js/css    # Options page for configuration
├── scripts/
│   ├── nlp.js            # NLP matching utilities
│   ├── parser.js         # Resume file parsing
│   ├── storage.js        # Storage helpers
│   └── export.js         # CSV export utility
├── assets/               # Extension icons
├── vendor/
│   └── pdfjs/           # PDF.js library (optional)
└── README.md            # This file
```

## Troubleshooting

### Extension not loading
- Make sure all files are in the correct folders
- Check the browser console for errors (chrome://extensions → JobScout → "Inspect views: service worker")
- Verify manifest.json is valid JSON

### Scanning not working
- Make sure you're logged into LinkedIn
- Check that search URLs are valid LinkedIn Jobs URLs
- Verify the extension has the necessary permissions
- Check the browser console for errors

### Resume parsing issues
- PDF: Install PDF.js for better support (see Installation step 4)
- DOCX: For better DOCX parsing, you can include JSZip library in options.html
- TXT: Should work without any additional setup

### Jobs not appearing
- Make sure "Only new roles" is disabled if you want to see all jobs
- Check that scanning is enabled (not paused)
- Verify search URLs are still valid
- LinkedIn may have changed their page structure - the extension may need updates

## Limitations

- **LinkedIn DOM Changes**: LinkedIn may update their website structure, which could break scraping. The extension uses common selectors, but may need updates if LinkedIn changes significantly.
- **Rate Limiting**: The extension includes delays, but LinkedIn may still rate-limit if you scan too frequently. Adjust scan interval if needed.
- **PDF Parsing**: Requires PDF.js library for full support (see Installation)
- **DOCX Parsing**: Basic support included; for better results, include JSZip library
- **Browser Only**: This extension only works in Chrome/Chromium browsers

## Development

To modify or extend the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the JobScout extension card
4. Test your changes

## Support

For issues, questions, or contributions, please refer to the project repository.

## License

This project is provided as-is for personal use. Please ensure compliance with LinkedIn's Terms of Service when using this extension.

