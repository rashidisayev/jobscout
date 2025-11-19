// Resume parser for PDF, DOCX, and TXT files

/**
 * Parse a resume file and extract text content
 */
export async function parseResume(file) {
  if (!file || !file.name) {
    throw new Error('Invalid file: file name is missing');
  }
  
  const extension = file.name.split('.').pop().toLowerCase();
  
  if (!extension) {
    throw new Error('File has no extension. Please ensure the file has a .pdf, .docx, or .txt extension.');
  }
  
  switch (extension) {
    case 'pdf':
      return await parsePDF(file);
    case 'docx':
      return await parseDOCX(file);
    case 'txt':
      return await parseTXT(file);
    default:
      throw new Error(`Unsupported file type: .${extension}. Supported formats: PDF (.pdf), DOCX (.docx), and TXT (.txt)`);
  }
}

/**
 * Parse PDF file using PDF.js
 */
async function parsePDF(file) {
  try {
    // Get the correct path for PDF.js in Chrome extension
    let pdfjsPath;
    
    // If we're in a Chrome extension context, use chrome.runtime.getURL
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      pdfjsPath = chrome.runtime.getURL('vendor/pdfjs/pdf.mjs');
    } else {
      // Fallback to relative path
      pdfjsPath = './vendor/pdfjs/pdf.mjs';
    }
    
    // Load PDF.js ES module
    let pdfjsModule;
    try {
      pdfjsModule = await import(pdfjsPath);
    } catch (importError) {
      console.error('Failed to import PDF.js from:', pdfjsPath, importError);
      // Try alternative path
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        pdfjsPath = chrome.runtime.getURL('vendor/pdfjs/pdf.mjs');
        try {
          pdfjsModule = await import(pdfjsPath);
        } catch (retryError) {
          throw new Error(`Failed to load PDF.js library. Please ensure vendor/pdfjs/pdf.mjs exists. Error: ${retryError.message}`);
        }
      } else {
        throw new Error(`Failed to load PDF.js library. Error: ${importError.message}`);
      }
    }
    
    // PDF.js ES modules typically export as default or named exports
    const pdfjsLib = pdfjsModule.default || pdfjsModule;
    
    if (!pdfjsLib || !pdfjsLib.getDocument) {
      throw new Error('PDF.js library loaded but getDocument method not found. The library may be corrupted.');
    }
    
    // Set worker if needed (for PDF.js to work properly)
    if (pdfjsLib.GlobalWorkerOptions && typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        const workerPath = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
      } catch (workerError) {
        console.warn('Failed to set PDF.js worker path:', workerError);
        // Continue without worker - text extraction might still work
      }
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
    // Try multiple approaches to handle different PDF.js versions
    let pdf;
    let lastError = null;
    
    // Strategy 1: Use custom factory without standardFontDataUrl (for newer PDF.js versions)
    try {
      const pdfOptions1 = {
        data: arrayBuffer,
        StandardFontDataFactory: EmptyStandardFontDataFactory,
        disableFontFace: true,
        stopAtErrors: false,
        verbosity: 0
      };
      pdf = await pdfjsLib.getDocument(pdfOptions1).promise;
    } catch (error1) {
      lastError = error1;
      console.warn('Strategy 1 (custom factory) failed, trying strategy 2:', error1.message);
      
      // Strategy 2: Use custom factory with empty string URL
      try {
        const pdfOptions2 = {
          data: arrayBuffer,
          standardFontDataUrl: '',
          StandardFontDataFactory: EmptyStandardFontDataFactory,
          disableFontFace: true,
          stopAtErrors: false,
          verbosity: 0
        };
        pdf = await pdfjsLib.getDocument(pdfOptions2).promise;
      } catch (error2) {
        lastError = error2;
        console.warn('Strategy 2 (empty URL) failed, trying strategy 3:', error2.message);
        
        // Strategy 3: Try without custom factory (let PDF.js handle fonts)
        try {
          const pdfOptions3 = {
            data: arrayBuffer,
            disableFontFace: true,
            stopAtErrors: false,
            verbosity: 0
          };
          pdf = await pdfjsLib.getDocument(pdfOptions3).promise;
        } catch (error3) {
          lastError = error3;
          console.warn('Strategy 3 (no factory) failed, trying strategy 4:', error3.message);
          
          // Strategy 4: Minimal options (most compatible)
          try {
            pdf = await pdfjsLib.getDocument({
              data: arrayBuffer,
              stopAtErrors: false,
              verbosity: 0
            }).promise;
          } catch (error4) {
            lastError = error4;
            console.error('All PDF parsing strategies failed');
            throw new Error(`Failed to parse PDF: ${error4.message}. The PDF file may be corrupted or use unsupported features.`);
          }
        }
      }
    }
    
    if (!pdf || !pdf.numPages) {
      throw new Error('PDF document loaded but has no pages. The file may be corrupted.');
    }
    
    let fullText = '';
    
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          if (!textContent || !textContent.items || textContent.items.length === 0) {
            console.warn(`Page ${i} has no extractable text`);
            continue;
          }
          
          const pageText = textContent.items
            .map(item => item.str || '')
            .filter(str => str.length > 0)
            .join(' ');
          fullText += pageText + '\n';
        } catch (pageError) {
          console.warn(`Error extracting text from page ${i}:`, pageError);
          // Continue with other pages
        }
      }
    } catch (extractionError) {
      console.error('Error during text extraction:', extractionError);
      throw new Error(`Failed to extract text from PDF: ${extractionError.message}`);
    }
    
    const trimmedText = fullText.trim();
    if (trimmedText.length === 0) {
      throw new Error('No text content could be extracted from the PDF. The PDF may contain only images or use unsupported fonts.');
    }
    
    return trimmedText;
  } catch (error) {
    console.error('PDF parsing error:', error);
    
    // Provide more helpful error messages
    if (error.message.includes('Failed to load PDF.js')) {
      throw error; // Re-throw library loading errors as-is
    } else if (error.message.includes('No text content')) {
      throw error; // Re-throw empty content errors as-is
    } else {
      throw new Error(`Failed to parse PDF: ${error.message}. Please ensure:\n- The PDF file is not corrupted\n- The PDF contains readable text (not just images)\n- PDF.js library files are properly installed`);
    }
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
      try {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const documentXml = await zip.file('word/document.xml').async('string');
        if (!documentXml) {
          throw new Error('DOCX file does not contain word/document.xml');
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');
        const textNodes = doc.getElementsByTagName('w:t');
        let fullText = '';
        for (let i = 0; i < textNodes.length; i++) {
          const text = textNodes[i].textContent || '';
          if (text.trim().length > 0) {
            fullText += text + ' ';
          }
        }
        const trimmedText = fullText.trim();
        if (trimmedText.length === 0) {
          throw new Error('No text content found in DOCX file');
        }
        return trimmedText;
      } catch (jszipError) {
        console.warn('JSZip parsing failed:', jszipError);
        throw new Error(`Failed to parse DOCX with JSZip: ${jszipError.message}. Please ensure JSZip library is included or try using PDF format.`);
      }
    }
  } catch (error) {
    if (error.message && error.message.includes('JSZip')) {
      throw error; // Re-throw JSZip errors
    }
    console.warn('JSZip not available, using fallback parser');
  }
  
  // Fallback: Extract text from raw bytes (simplified)
  // This works for basic DOCX files but may miss some content
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8Array);
    
    // Try to extract text between common XML tags
    const textMatches = text.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    if (textMatches && textMatches.length > 0) {
      const extracted = textMatches
        .map(m => m.replace(/<[^>]+>/g, ''))
        .filter(t => t.trim().length > 0)
        .join(' ')
        .trim();
      if (extracted.length > 0) {
        return extracted;
      }
    }
    
    // Last resort: return readable text from the buffer
    const readableText = text.replace(/[^\x20-\x7E\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    if (readableText.length === 0) {
      throw new Error('No readable text found in DOCX file. The file may be corrupted or in an unsupported format.');
    }
    return readableText;
  } catch (error) {
    throw new Error(`Failed to parse DOCX file: ${error.message}. For better DOCX support, please include JSZip library or convert to PDF format.`);
  }
}

/**
 * Parse TXT file
 */
async function parseTXT(file) {
  try {
    const text = await file.text();
    if (!text || text.trim().length === 0) {
      throw new Error('TXT file is empty or contains no readable text');
    }
    return text.trim();
  } catch (error) {
    console.error('TXT parsing error:', error);
    throw new Error(`Failed to parse TXT file: ${error.message}. The file may be corrupted or in an unsupported encoding.`);
  }
}

// Note: For better DOCX parsing, you can include JSZip library:
// Download from https://stuk.github.io/jszip/ and include it in options.html
// The parser will automatically use it if available

