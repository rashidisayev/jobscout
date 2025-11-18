# PDF.js Setup for JobScout

## Installing PDF.js

1. **Download PDF.js**:
   - Go to https://mozilla.github.io/pdf.js/
   - Download the latest version
   - Or use npm: `npm install pdfjs-dist`

2. **Required Files**:
   Place the following files in this directory (`vendor/pdfjs/`):
   
   - `pdf.mjs` - Main PDF.js ES module
   - `pdf.worker.mjs` - Worker file (required for PDF parsing)
   - `*.map` files (optional, for debugging)

3. **File Locations**:
   - If downloaded from Mozilla: Look in the `build/` or `legacy/build/` folder
   - If using npm: Files are in `node_modules/pdfjs-dist/build/`
     - Copy `pdf.mjs` (or `pdf.min.mjs`) → `pdf.mjs`
     - Copy `pdf.worker.mjs` (or `pdf.worker.min.mjs`) → `pdf.worker.mjs`

## Alternative: Using Legacy Build

If you have the legacy build with `pdf.min.js`:
1. Rename `pdf.min.js` to `pdf.mjs`
2. The extension will attempt to use it, but ES modules are preferred

## Verification

After placing the files, the extension should be able to parse PDF resumes. If you encounter errors:
- Check the browser console for import errors
- Verify file names match exactly: `pdf.mjs` and `pdf.worker.mjs`
- Ensure files are in `vendor/pdfjs/` directory

