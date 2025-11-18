// Resume parser for PDF, DOCX, and TXT files

/**
 * Parse a resume file and extract text content
 */
export async function parseResume(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  
  switch (extension) {
    case 'pdf':
      return await parsePDF(file);
    case 'docx':
      return await parseDOCX(file);
    case 'txt':
      return await parseTXT(file);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

/**
 * Parse PDF file using PDF.js
 */
async function parsePDF(file) {
  try {
    // Get the correct path for PDF.js in Chrome extension
    // Try both relative path and chrome.runtime.getURL
    let pdfjsPath = '../../vendor/pdfjs/pdf.mjs';
    
    // If we're in a Chrome extension context, use chrome.runtime.getURL
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      pdfjsPath = chrome.runtime.getURL('vendor/pdfjs/pdf.mjs');
    }
    
    // Load PDF.js ES module
    const pdfjsModule = await import(pdfjsPath);
    
    // PDF.js ES modules typically export as default or named exports
    const pdfjsLib = pdfjsModule.default || pdfjsModule;
    
    // Set worker if needed (for PDF.js to work properly)
    if (pdfjsLib.GlobalWorkerOptions && typeof chrome !== 'undefined' && chrome.runtime) {
      const workerPath = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    }
    
    const arrayBuffer = await file.arrayBuffer();
    
    // Create a custom StandardFontDataFactory that returns empty data
    // This works for text extraction since we don't need to render fonts
    class EmptyStandardFontDataFactory {
      constructor() {}
      async fetch({ filename }) {
        // Return empty ArrayBuffer for font files
        // This allows PDF.js to proceed with text extraction
        return new ArrayBuffer(0);
      }
    }
    
    // Configure PDF.js options for text extraction
    const pdfOptions = {
      data: arrayBuffer,
      // Provide a dummy URL (required by PDF.js but won't be used with custom factory)
      standardFontDataUrl: 'data:,', // Data URL that won't be fetched
      // Use our custom factory that returns empty data
      StandardFontDataFactory: EmptyStandardFontDataFactory,
      // Disable font face to avoid font loading issues for text extraction
      disableFontFace: true,
      // Ignore errors to continue extraction even if fonts fail
      stopAtErrors: false,
      // Verbosity level (0 = errors, 1 = warnings, 5 = infos)
      verbosity: 0
    };
    
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument(pdfOptions).promise;
    } catch (error) {
      // If custom factory doesn't work, try with CDN as fallback
      if (error.message && error.message.includes('standardFontDataUrl')) {
        console.warn('Custom font factory failed, trying CDN fallback');
        try {
          pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
            disableFontFace: true,
            stopAtErrors: false,
            verbosity: 0
          }).promise;
        } catch (cdnError) {
          console.error('Both custom factory and CDN failed:', cdnError);
          throw new Error(`Failed to parse PDF: ${error.message}. Please ensure the PDF uses embedded fonts or try a different PDF file.`);
        }
      } else {
        throw error;
      }
    }
    
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText.trim();
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error.message}. Please ensure PDF.js files (pdf.mjs and pdf.worker.mjs) are in vendor/pdfjs/ folder.`);
  }
}

/**
 * Parse DOCX file
 * Note: DOCX is a ZIP archive containing XML files
 * This is a simplified parser that extracts text from the raw file
 * For production use, consider including JSZip library
 */
async function parseDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  
  try {
    // Try to use JSZip if available (user would need to include it)
    if (typeof JSZip !== 'undefined') {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const documentXml = await zip.file('word/document.xml').async('string');
      const parser = new DOMParser();
      const doc = parser.parseFromString(documentXml, 'text/xml');
      const textNodes = doc.getElementsByTagName('w:t');
      let fullText = '';
      for (let i = 0; i < textNodes.length; i++) {
        fullText += textNodes[i].textContent + ' ';
      }
      return fullText.trim();
    }
  } catch (error) {
    console.warn('JSZip not available, using fallback parser');
  }
  
  // Fallback: Extract text from raw bytes (simplified)
  // This works for basic DOCX files but may miss some content
  const uint8Array = new Uint8Array(arrayBuffer);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8Array);
  
  // Try to extract text between common XML tags
  const textMatches = text.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  if (textMatches) {
    return textMatches
      .map(m => m.replace(/<[^>]+>/g, ''))
      .join(' ')
      .trim();
  }
  
  // Last resort: return readable text from the buffer
  return text.replace(/[^\x20-\x7E\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse TXT file
 */
async function parseTXT(file) {
  return await file.text();
}

// Note: For better DOCX parsing, you can include JSZip library:
// Download from https://stuk.github.io/jszip/ and include it in options.html
// The parser will automatically use it if available

