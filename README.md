# JobScout - LinkedIn Job Monitor Chrome Extension

JobScout is a Chrome Extension (Manifest V3) that helps you monitor LinkedIn Jobs, collect new roles automatically, and match them with your resumes using NLP-based similarity scoring.

## Features

- **Hourly Scanning**: Automatically scans LinkedIn job searches at configurable intervals
- **Multiple Search URLs**: Add 3-10 LinkedIn job search URLs to monitor with optional location and keyword labels
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

## Usage

### Initial Setup

1. **Right-click the JobScout extension icon** and select **Options** (or click the extension icon and then "Open Options")

2. **Add Search URLs**:
   - Go to LinkedIn Jobs and perform a search
   - Copy the URL from your browser's address bar
   - Paste it into the "Search URLs" tab in JobScout options
   - (Optional) Add a location label to help identify this search
   - (Optional) Add a keyword to categorize this search
   - Click "Add URL"
   - Location and keyword fields auto-save as you type
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

## 🔍 Matching Engine (How JobScout picks the best resume)

JobScout uses a **hybrid matcher** to compare each Job Description (JD) with your uploaded resumes:

### Must-Have Filter
Pulls out hard requirements (skills, language, location, clearance). If a resume misses any must-have, its score is capped (≤0.35).

### Sparse Match
**BM25/TF-IDF** for exact terminology overlap. This catches specific technical terms, tools, and skills mentioned in both the job description and your resume.

### Dense Match
**Semantic similarity** with compact ONNX sentence embeddings run in your browser. This understands meaning beyond exact word matches - e.g., "React" and "React.js" are recognized as similar.

### Section Weights
Different parts of your resume are weighted differently:
- **Experience** (0.45) - Most important, with recency boost:
  - Recent roles (≤2 years): 1.0x multiplier
  - Mid-career (2-5 years): 0.7x multiplier
  - Older experience (>5 years): 0.4x multiplier
- **Skills** (0.25) - Technical competencies
- **Projects** (0.15) - Portfolio work
- **Education/Location** (0.15) - Background info

### (Optional) Reranker
A small cross-encoder polishes the top results for extra precision. Enable in Options if you need the highest accuracy (note: uses more compute).

### Final Score
The hybrid score combines:
- 35% Dense (semantic) similarity
- 25% Sparse (BM25) similarity
- 40% Section-aware weighted score

Final score is normalized to 0–1 and color-coded:

- **≥ 0.70** Excellent (green) - Very similar content
- **0.50–0.69** Good (teal) - Strong overlap
- **0.30–0.49** Moderate (amber) - Relevant but not perfect
- **0.10–0.29** Weak (orange) - Some common terms
- **< 0.10** Very poor (red) - Different fields/skills

### Understanding Match Results

Click **"Why?"** next to any score to see:
- **Matched Keywords**: Top 10 terms that appeared in both JD and resume
- **Missing Must-Haves**: Required skills/requirements not found in your resume
- **Most Similar Content**: Top 2-3 sentences from your resume that best match the job description

### Privacy

All parsing, embeddings, and scoring happen **locally in your browser**. No external servers. Your resume data never leaves your device.

### Performance Tips

- **Keep 3–5 resumes uploaded** for best results
- **Enable the reranker only if you need extra precision** (it's slower)
- **Scores are cached per job**; re-runs only update new/changed items
- **Embeddings are pre-computed** when you upload resumes for faster matching

### Dev Notes

- Uses **onnxruntime-web** for in-browser inference
- **BM25** via a lightweight JS implementation
- Model files are lazy-loaded and cached; see `/vendor/onnx/README.md` for setup instructions
- Falls back to TF-IDF-based pseudo-embeddings if ONNX models aren't available

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
- PDF: PDF.js library is included in the extension for PDF parsing support
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
- **PDF Parsing**: PDF.js library is included for PDF resume parsing support
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

## Contributing

If you find JobScout useful and would like to support its development, consider:

- ⭐ Starring the repository
- 🐛 Reporting bugs or suggesting features
- 💡 Contributing code improvements
- ☕ [Buy me a coffee](https://www.paypal.com/paypalme/rashidisayev) - Support the developer

Your support helps maintain and improve this project!

## License

This project is provided as-is for personal use. Please ensure compliance with LinkedIn's Terms of Service when using this extension.

---

**Developed by Rashid Isayev** | [Email](mailto:rashidisayev@gmail.com) | [Support via PayPal](https://www.paypal.com/paypalme/rashidisayev)

