// CV Section Parser - Extracts structured sections from resume text

/**
 * @typedef {Object} CvSections
 * @property {string} experience
 * @property {string} skills
 * @property {string} [projects]
 * @property {string} [education]
 * @property {string} [location]
 */

/**
 * @typedef {Object} CvDoc
 * @property {string} id
 * @property {string} name
 * @property {string} text
 * @property {CvSections} sections
 * @property {Float32Array} [embedding]
 * @property {any} [tfidf]
 * @property {number} updatedAt
 */

// Section heading patterns (multilingual support)
const SECTION_PATTERNS = {
  experience: [
    /^(experience|work experience|employment|berufserfahrung|erfahrung|work history|career|professional experience)/i,
    /^(employment history|work|positions|jobs)/i
  ],
  skills: [
    /^(skills|technical skills|competencies|qualifications|fähigkeiten|kompetenzen|expertise|proficiencies)/i,
    /^(technologies|tools|software|programming languages|tech stack)/i
  ],
  projects: [
    /^(projects|portfolio|notable projects|projekte|selected projects|key projects)/i
  ],
  education: [
    /^(education|academic|bildung|ausbildung|qualifications|degrees|university|college)/i,
    /^(certifications|certificates|zertifikate|training)/i
  ],
  location: [
    /^(location|address|current location|wohnort|residence|based in)/i
  ]
};

/**
 * Extract sections from CV text using heading patterns
 * @param {string} text - Full CV text
 * @returns {CvSections}
 */
export function extractCvSections(text) {
  if (!text || typeof text !== 'string') {
    return {
      experience: '',
      skills: '',
      projects: '',
      education: '',
      location: ''
    };
  }

  const sections = {
    experience: '',
    skills: '',
    projects: '',
    education: '',
    location: ''
  };

  // Split text into lines
  const lines = text.split(/\r?\n/);
  const sectionIndices = {};
  
  // Find section headings
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 3) continue;
    
    // Check each section pattern
    for (const [sectionName, patterns] of Object.entries(SECTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          // Check if line looks like a heading (short, possibly bold/uppercase)
          const isHeading = line.length < 50 && (
            line === line.toUpperCase() ||
            /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(line) ||
            line.match(/^#{1,3}\s+/) // Markdown heading
          );
          
          if (isHeading && !sectionIndices[sectionName]) {
            sectionIndices[sectionName] = i;
            break;
          }
        }
      }
    }
  }

  // Extract content for each section
  const sortedSections = Object.entries(sectionIndices)
    .sort((a, b) => a[1] - b[1]);

  for (let i = 0; i < sortedSections.length; i++) {
    const [sectionName, startIdx] = sortedSections[i];
    const endIdx = i < sortedSections.length - 1 
      ? sortedSections[i + 1][1] 
      : lines.length;
    
    // Extract lines for this section (skip the heading line)
    const sectionLines = lines.slice(startIdx + 1, endIdx)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    sections[sectionName] = sectionLines.join('\n').trim();
  }

  // Fallback: if no sections found, try to infer from content
  if (Object.values(sections).every(s => !s)) {
    return inferSectionsFromContent(text);
  }

  return sections;
}

/**
 * Fallback: Infer sections from content patterns when headings aren't found
 * @param {string} text
 * @returns {CvSections}
 */
function inferSectionsFromContent(text) {
  const sections = {
    experience: '',
    skills: '',
    projects: '',
    education: '',
    location: ''
  };

  const lowerText = text.toLowerCase();
  
  // Look for common patterns
  const experiencePatterns = [
    /\b(worked at|employed at|position at|role at|developer|engineer|manager|analyst|consultant)\b/gi
  ];
  
  const skillsPatterns = [
    /\b(java|python|javascript|react|angular|vue|node|sql|aws|docker|kubernetes|git|agile|scrum)\b/gi
  ];
  
  const educationPatterns = [
    /\b(university|college|bachelor|master|phd|degree|graduated|gpa)\b/gi
  ];

  // Simple heuristic: split by common delimiters and categorize
  const paragraphs = text.split(/\n\s*\n/);
  
  for (const para of paragraphs) {
    const paraLower = para.toLowerCase();
    
    if (experiencePatterns.some(p => p.test(para))) {
      sections.experience += (sections.experience ? '\n\n' : '') + para;
    } else if (skillsPatterns.some(p => p.test(para))) {
      sections.skills += (sections.skills ? ', ' : '') + para;
    } else if (educationPatterns.some(p => p.test(para))) {
      sections.education += (sections.education ? '\n\n' : '') + para;
    }
  }

  return sections;
}

/**
 * Extract years of experience and calculate recency decay
 * @param {string} experienceText
 * @returns {number} Recency multiplier (1.0 for recent, 0.4 for old)
 */
export function calculateRecencyDecay(experienceText) {
  if (!experienceText) return 0.4; // Default to old if no experience
  
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Look for date patterns: "2020 - 2022", "Jan 2020 - Present", "2020-present", etc.
  const datePatterns = [
    /(\d{4})\s*[-–—]\s*(present|now|current|\d{4})/gi,
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\s*[-–—]\s*(present|now|current)/gi,
    /\b(\d{4})\s*[-–—]\s*(\d{4})\b/g
  ];
  
  let mostRecentYear = 0;
  
  for (const pattern of datePatterns) {
    const matches = experienceText.matchAll(pattern);
    for (const match of matches) {
      const year = parseInt(match[1] || match[2]);
      if (year && year > mostRecentYear) {
        mostRecentYear = year;
      }
      
      // Check if it's "present" or current
      if (match[2] && (match[2].toLowerCase().includes('present') || 
                       match[2].toLowerCase().includes('now') ||
                       match[2].toLowerCase().includes('current'))) {
        mostRecentYear = currentYear;
      }
    }
  }
  
  if (mostRecentYear === 0) {
    // No dates found, assume moderate recency
    return 0.7;
  }
  
  const yearsAgo = currentYear - mostRecentYear;
  
  // Recency decay: ≤2y: 1.0; 2–5y: 0.7; >5y: 0.4
  if (yearsAgo <= 2) return 1.0;
  if (yearsAgo <= 5) return 0.7;
  return 0.4;
}

/**
 * Create structured CV document from parsed text
 * @param {string} id
 * @param {string} name
 * @param {string} text
 * @returns {CvDoc}
 */
export function createCvDoc(id, name, text) {
  const sections = extractCvSections(text);
  
  return {
    id,
    name,
    text,
    sections,
    updatedAt: Date.now()
  };
}

