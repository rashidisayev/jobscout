# JobScout Quick Start Guide

## Installation (5 minutes)

1. **Load Extension in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select the `jobsearch` folder

2. **Create Icons** (Optional but recommended):
   - Open `create-icons.html` in your browser
   - Click "Generate Icons"
   - Right-click each icon and save to `assets/` folder with names:
     - `icon16.png` → `assets/icon16.png`
     - `icon48.png` → `assets/icon48.png`
     - `icon128.png` → `assets/icon128.png`
   - Or use any 16x16, 48x48, 128x128 PNG images

3. **First Time Setup**:
   - Right-click the JobScout icon → Options
   - Go to "Search URLs" tab
   - Go to LinkedIn Jobs, perform a search, copy the URL
   - Paste and click "Add URL"
   - Repeat for 3-10 searches

4. **Upload Resumes** (Optional):
   - Go to "Resumes" tab
   - Upload up to 5 resumes (PDF, DOCX, or TXT)
   - Wait for parsing to complete

5. **Configure Settings**:
   - Go to "Settings" tab
   - Set scan interval (default: 60 minutes)
   - Toggle "Only new roles" if desired
   - Click "Save Settings"

## First Scan

1. Click the JobScout extension icon
2. Click "Scan Now"
3. Wait for scan to complete (may take a few minutes)
4. Go to Options → Results tab to see collected jobs

## Using the Extension

- **Popup**: Quick stats and manual scan
- **Options → Results**: View, filter, sort, and export all jobs
- **Automatic Scanning**: Runs every hour (or your configured interval)

## Troubleshooting

**Extension icon is gray/not working**:
- Make sure you created the icon files (see step 2 above)
- Reload the extension in chrome://extensions

**Scan not finding jobs**:
- Make sure you're logged into LinkedIn
- Verify search URLs are valid
- Check browser console for errors

**Resume matching not working**:
- Make sure you uploaded resumes
- PDF parsing requires PDF.js (see README.md)
- Try TXT format for best compatibility

## Next Steps

- Read the full README.md for detailed information
- Check ICONS.md for icon creation tips
- Customize scan interval based on your needs

