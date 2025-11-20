// Must-Have Extractor - Extracts hard requirements from job descriptions

/**
 * @typedef {Object} MustHaves
 * @property {string[]} requiredSkills - Required technical skills/keywords
 * @property {string} [language] - Required language level (e.g., "German B2")
 * @property {string} [location] - Location requirement (e.g., "On-site", "Remote")
 * @property {string[]} [clearance] - Security clearance or work permit requirements
 */

// Common skill synonyms/aliases
const SKILL_SYNONYMS = {
  'javascript': ['js', 'ecmascript', 'node.js', 'nodejs'],
  'typescript': ['ts'],
  'python': ['py'],
  'java': [],
  'react': ['reactjs', 'react.js'],
  'angular': ['angularjs', 'angular.js'],
  'vue': ['vuejs', 'vue.js'],
  'node': ['node.js', 'nodejs'],
  'aws': ['amazon web services'],
  'kubernetes': ['k8s', 'kube'],
  'docker': [],
  'sql': ['database', 'mysql', 'postgresql'],
  'git': ['github', 'gitlab'],
  'agile': ['scrum', 'kanban'],
  'ci/cd': ['continuous integration', 'continuous deployment', 'devops']
};

// Language level patterns
const LANGUAGE_PATTERNS = [
  /(?:fluent|native|proficient)\s+in\s+([A-Z][a-z]+)/i,
  /([A-Z][a-z]+)\s+(?:level\s+)?([A-C][1-2]|native|fluent|proficient|intermediate|beginner)/i,
  /([A-Z][a-z]+)\s+(?:language|speaking)/i,
  /(?:speak|speaking|know|knowing)\s+([A-Z][a-z]+)/i
];

// Location requirement patterns
const LOCATION_PATTERNS = [
  /(?:must be|required to be|need to be)\s+(?:located\s+)?(?:in|at)\s+([A-Z][a-zA-Z\s,]+)/i,
  /(?:on-site|onsite|on site|in-office|in office)/i,
  /(?:remote|work from home|wfh|hybrid)/i,
  /(?:relocation|relocate)/i,
  /(?:visa|work permit|authorization)/i
];

// Clearance/security patterns
const CLEARANCE_PATTERNS = [
  /(?:security\s+)?clearance/i,
  /(?:work\s+)?permit/i,
  /(?:visa|authorization|eligibility)/i,
  /(?:us\s+)?citizen/i,
  /(?:green\s+)?card/i
];

/**
 * Extract must-have requirements from job description
 * @param {string} jobDescription - Full job description text
 * @returns {MustHaves}
 */
export function extractMustHaves(jobDescription) {
  if (!jobDescription || typeof jobDescription !== 'string') {
    return {
      requiredSkills: [],
      location: null,
      clearance: []
    };
  }

  const text = jobDescription;
  const lowerText = text.toLowerCase();

  // Extract required skills
  const requiredSkills = extractRequiredSkills(text, lowerText);

  // Extract language requirements
  const language = extractLanguageRequirement(text);

  // Extract location requirements
  const location = extractLocationRequirement(text, lowerText);

  // Extract clearance/permit requirements
  const clearance = extractClearanceRequirements(text, lowerText);

  return {
    requiredSkills,
    language,
    location,
    clearance
  };
}

/**
 * Extract required skills from job description
 * @param {string} text
 * @param {string} lowerText
 * @returns {string[]}
 */
function extractRequiredSkills(text, lowerText) {
  const skills = new Set();
  
  // Patterns for required skills
  const requiredPatterns = [
    /(?:required|must have|must|essential|mandatory|necessary)\s+(?:skills?|experience\s+with|knowledge\s+of|proficiency\s+in)\s*:?\s*([^.\n]+)/gi,
    /(?:must|should|need to)\s+(?:know|have experience with|be familiar with)\s+([^.\n]+)/gi,
    /(?:experience\s+with|proficient\s+in|expert\s+in)\s+([^.\n]+)/gi
  ];

  // Common technical terms
  const techTerms = [
    'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust',
    'react', 'angular', 'vue', 'node', 'express', 'django', 'flask',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
    'sql', 'mongodb', 'postgresql', 'mysql', 'redis',
    'git', 'ci/cd', 'jenkins', 'github actions',
    'agile', 'scrum', 'devops', 'microservices',
    'machine learning', 'ai', 'data science', 'tensorflow', 'pytorch'
  ];

  // Extract from explicit "required" patterns
  for (const pattern of requiredPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const skillText = match[1].trim();
      // Extract individual skills from the text
      const extracted = extractSkillsFromText(skillText);
      extracted.forEach(skill => skills.add(skill.toLowerCase()));
    }
  }

  // Also check for common tech terms in "must have" context
  for (const term of techTerms) {
    const patterns = [
      new RegExp(`(?:must|required|essential).*?${term.replace(/[+*]/g, '\\$&')}`, 'gi'),
      new RegExp(`${term.replace(/[+*]/g, '\\$&')}.*?(?:required|must|essential)`, 'gi')
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        skills.add(term.toLowerCase());
      }
    }
  }

  return Array.from(skills);
}

/**
 * Extract individual skills from a text string
 * @param {string} text
 * @returns {string[]}
 */
function extractSkillsFromText(text) {
  const skills = [];
  
  // Split by common delimiters
  const parts = text.split(/[,;|•\n]/);
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 2 && trimmed.length < 50) {
      // Check if it looks like a skill (not a full sentence)
      if (!trimmed.match(/^[A-Z][a-z]+ [a-z]+ [a-z]+/)) { // Not a full sentence
        skills.push(trimmed);
      }
    }
  }
  
  return skills;
}

/**
 * Extract language requirement
 * @param {string} text
 * @returns {string|null}
 */
function extractLanguageRequirement(text) {
  for (const pattern of LANGUAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const language = match[1] || match[0];
      const level = match[2] || '';
      return level ? `${language} ${level}` : language;
    }
  }
  return null;
}

/**
 * Extract location requirement
 * @param {string} text
 * @param {string} lowerText
 * @returns {string|null}
 */
function extractLocationRequirement(text, lowerText) {
  // Check for explicit location requirements
  for (const pattern of LOCATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (match[1]) {
        return match[1].trim();
      }
      return match[0].trim();
    }
  }
  
  // Check for remote/on-site keywords
  if (lowerText.includes('remote') || lowerText.includes('work from home')) {
    return 'Remote';
  }
  if (lowerText.includes('on-site') || lowerText.includes('in-office')) {
    return 'On-site';
  }
  if (lowerText.includes('hybrid')) {
    return 'Hybrid';
  }
  
  return null;
}

/**
 * Extract clearance/security requirements
 * @param {string} text
 * @param {string} lowerText
 * @returns {string[]}
 */
function extractClearanceRequirements(text, lowerText) {
  const requirements = [];
  
  for (const pattern of CLEARANCE_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(pattern);
      if (match) {
        requirements.push(match[0]);
      }
    }
  }
  
  return requirements;
}

/**
 * Check if a CV satisfies all must-have requirements
 * @param {MustHaves} mustHaves
 * @param {import('./cvParser.js').CvDoc} cvDoc
 * @returns {{satisfied: boolean, missing: string[]}}
 */
export function checkMustHaves(mustHaves, cvDoc) {
  const missing = [];
  const cvText = cvDoc.text.toLowerCase();
  const cvSkills = (cvDoc.sections.skills || '').toLowerCase();

  // Check required skills
  for (const skill of mustHaves.requiredSkills) {
    const skillLower = skill.toLowerCase();
    const found = cvText.includes(skillLower) || cvSkills.includes(skillLower);
    
    // Also check synonyms
    if (!found && SKILL_SYNONYMS[skillLower]) {
      const foundSynonym = SKILL_SYNONYMS[skillLower].some(syn => 
        cvText.includes(syn) || cvSkills.includes(syn)
      );
      if (!foundSynonym) {
        missing.push(`Required skill: ${skill}`);
      }
    } else if (!found) {
      missing.push(`Required skill: ${skill}`);
    }
  }

  // Check language requirement
  if (mustHaves.language) {
    const langLower = mustHaves.language.toLowerCase();
    if (!cvText.includes(langLower.split(' ')[0])) {
      missing.push(`Language requirement: ${mustHaves.language}`);
    }
  }

  // Check location requirement (if it's a hard requirement like "must be in US")
  if (mustHaves.location && 
      (mustHaves.location.toLowerCase().includes('must') || 
       mustHaves.location.toLowerCase().includes('required'))) {
    // This is a soft check - location matching is complex
    // For now, we'll note it but not fail on it
  }

  // Check clearance requirements
  for (const clearance of mustHaves.clearance) {
    if (!cvText.includes(clearance.toLowerCase())) {
      missing.push(`Clearance requirement: ${clearance}`);
    }
  }

  return {
    satisfied: missing.length === 0,
    missing
  };
}

