// Enhanced Hybrid Matching Engine - Improved BM25 + Dense Embeddings + Section-aware scoring

import { calculateRecencyDecay } from './cvParser.js';
import { checkMustHaves } from './mustHaveExtractor.js';

/**
 * @typedef {Object} MatchExplanation
 * @property {string[]} matchedKeywords
 * @property {string[]} missingMustHaves
 * @property {Array<{text: string, score: number}>} topSentences
 */

/**
 * @typedef {Object} JobMatch
 * @property {string} cvId
 * @property {number} score
 * @property {MatchExplanation} explanation
 */

// Section weights - optimized for better relevance
const SECTION_WEIGHTS = {
  experience: 0.50,  // Increased - most important
  skills: 0.30,       // Increased - critical for tech roles
  projects: 0.12,     // Slightly decreased
  eduLoc: 0.08       // Decreased - less critical
};

// Final score weights - rebalanced for better accuracy
const SCORE_WEIGHTS = {
  dense: 0.40,    // Increased - semantic understanding is crucial
  sparse: 0.30,   // Increased - exact term matching matters
  section: 0.30   // Decreased but still important
};

// Must-have penalty threshold
const MUST_HAVE_PENALTY_THRESHOLD = 0.35;

// Technical term synonyms for better matching
const TECHNICAL_SYNONYMS = {
  'javascript': ['js', 'ecmascript', 'nodejs', 'node.js'],
  'typescript': ['ts'],
  'react': ['reactjs', 'react.js'],
  'angular': ['angularjs', 'angular.js'],
  'vue': ['vuejs', 'vue.js'],
  'python': ['py'],
  'machine learning': ['ml', 'ai', 'artificial intelligence'],
  'data science': ['data analytics', 'data analysis'],
  'devops': ['dev ops', 'sre', 'site reliability'],
  'kubernetes': ['k8s'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  'microsoft azure': ['azure']
};

// Stopwords for better filtering
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'this', 'but', 'they', 'have',
  'had', 'what', 'said', 'each', 'which', 'their', 'time', 'if',
  'up', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her',
  'would', 'make', 'like', 'into', 'him', 'two', 'more', 'very',
  'after', 'words', 'long', 'than', 'first', 'been', 'call', 'who'
]);

/**
 * Enhanced BM25 implementation with improved normalization
 */
class BM25 {
  constructor(documents, k1 = 1.6, b = 0.75) {
    this.documents = documents.map(doc => this.tokenize(doc));
    this.k1 = k1; // Slightly increased for better term frequency saturation
    this.b = b;
    this.avgDocLength = this.documents.reduce((sum, doc) => sum + doc.length, 0) / this.documents.length || 1;
    this.idf = this.calculateIDF();
    this.importantKeywords = this.extractImportantKeywords(documents.join(' '));
  }

  tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s#+.-]/g, ' ') // Keep special chars for tech terms
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOPWORDS.has(word))
      .map(word => word.replace(/^[#+.-]+|[#+.-]+$/g, '')) // Clean edges
      .filter(word => word.length > 2);
  }

  /**
   * Extract important technical keywords
   */
  extractImportantKeywords(text) {
    if (!text) return new Set();
    
    const keywords = new Set();
    const lowerText = text.toLowerCase();
    
    // Technical patterns
    const techPatterns = [
      // Programming languages
      /\b(java|python|javascript|typescript|go|rust|c\+\+|c#|php|ruby|swift|kotlin|scala|r|matlab|perl|shell|bash|powershell)\b/gi,
      // Frameworks
      /\b(react|angular|vue|node|express|django|flask|spring|laravel|rails|asp\.net|\.net|jquery|bootstrap|tailwind)\b/gi,
      // Databases
      /\b(mysql|postgresql|mongodb|cassandra|redis|elasticsearch|oracle|sql|nosql|dynamodb|firebase)\b/gi,
      // Cloud and DevOps
      /\b(aws|azure|gcp|docker|kubernetes|jenkins|gitlab|github|terraform|ansible|chef|puppet|ci\/cd)\b/gi,
      // Tools
      /\b(git|svn|jira|confluence|slack|agile|scrum|kanban|devops|microservices|api|rest|graphql|soap)\b/gi,
      // Data and ML
      /\b(machine learning|ml|ai|artificial intelligence|data science|big data|hadoop|spark|tensorflow|pytorch|pandas|numpy)\b/gi,
      // Platforms
      /\b(frontend|backend|fullstack|full stack|web development|mobile development|ios|android|linux|windows|macos)\b/gi
    ];
    
    for (const pattern of techPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const cleaned = match.toLowerCase().trim();
          if (cleaned.length > 2) {
            keywords.add(cleaned);
            // Add synonyms
            for (const [key, synonyms] of Object.entries(TECHNICAL_SYNONYMS)) {
              if (cleaned === key || synonyms.includes(cleaned)) {
                keywords.add(key);
                synonyms.forEach(syn => keywords.add(syn));
              }
            }
          }
        });
      }
    }
    
    // Capitalized terms (technologies, tools)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (capitalizedWords) {
      capitalizedWords.forEach(word => {
        const cleaned = word.toLowerCase().trim();
        if (cleaned.length > 3 && !STOPWORDS.has(cleaned)) {
          keywords.add(cleaned);
        }
      });
    }
    
    return keywords;
  }

  calculateIDF() {
    const idf = {};
    const totalDocs = this.documents.length;

    // Count document frequency
    for (const doc of this.documents) {
      const uniqueTerms = new Set(doc);
      for (const term of uniqueTerms) {
        idf[term] = (idf[term] || 0) + 1;
      }
    }

    // Calculate IDF with improved smoothing
    for (const term in idf) {
      const docFreq = idf[term];
      // Improved IDF formula with better smoothing
      idf[term] = Math.log((totalDocs + 1) / (docFreq + 0.5));
      
      // Boost important keywords
      if (this.importantKeywords.has(term)) {
        idf[term] *= 1.5; // 50% boost for technical terms
      }
      
      // Ensure minimum value
      if (idf[term] <= 0) {
        idf[term] = 0.1;
      }
    }

    return idf;
  }

  score(query, docIndex) {
    const queryTerms = this.tokenize(query);
    const doc = this.documents[docIndex];
    const docLength = doc.length;
    
    if (docLength === 0) return 0;
    
    let score = 0;
    const termFreq = {};

    // Count term frequencies
    for (const term of doc) {
      termFreq[term] = (termFreq[term] || 0) + 1;
    }

    // Calculate BM25 score
    for (const term of queryTerms) {
      if (!this.idf[term]) continue;
      
      const tf = termFreq[term] || 0;
      const idfValue = this.idf[term];
      
      // BM25 formula
      const numerator = idfValue * tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
      
      score += numerator / denominator;
    }

    return score;
  }

  scoreQuery(query, docText) {
    // For single document scoring, create a temporary index
    const tempIndex = new BM25([docText], this.k1, this.b);
    return tempIndex.score(query, 0);
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Float32Array|number[]} vec1
 * @param {Float32Array|number[]} vec2
 * @returns {number}
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  
  // Ensure non-negative and normalize
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Enhanced score normalization with better calibration
 * @param {number} score
 * @returns {number}
 */
function calibrateScore(score) {
  // Clamp to [0, 1]
  let clamped = Math.max(0, Math.min(1, score));
  
  // Apply sigmoid-like transformation for better distribution
  // This helps differentiate between similar scores
  if (clamped > 0.1) {
    // Use a power curve to stretch mid-range scores
    const power = 0.9; // Slight compression
    clamped = Math.pow(clamped, power);
  }
  
  // Boost scores in the good range (0.4-0.8) slightly
  if (clamped >= 0.4 && clamped <= 0.8) {
    clamped = clamped * 1.05; // 5% boost
    clamped = Math.min(1, clamped); // Ensure we don't exceed 1
  }
  
  return clamped;
}

/**
 * Normalize BM25 score to [0, 1] range
 * Uses adaptive normalization based on score distribution
 */
function normalizeBM25Score(bm25Score) {
  // BM25 scores typically range from 0 to ~20-30 for good matches
  // Use adaptive threshold based on score magnitude
  if (bm25Score <= 0) return 0;
  
  // For very high scores, use logarithmic scaling
  if (bm25Score > 15) {
    return Math.min(1, 0.7 + (Math.log(bm25Score - 14) / Math.log(20)) * 0.3);
  }
  
  // For medium scores, use linear scaling
  if (bm25Score > 5) {
    return Math.min(1, 0.3 + ((bm25Score - 5) / 10) * 0.4);
  }
  
  // For low scores, use square root scaling
  return Math.min(1, Math.sqrt(bm25Score / 5) * 0.3);
}

/**
 * Match a job description against a CV using hybrid scoring
 * @param {string} jobDescription - Full job description text
 * @param {import('./cvParser.js').CvDoc} cvDoc - Structured CV document
 * @param {import('./mustHaveExtractor.js').MustHaves} mustHaves - Extracted must-haves
 * @param {Float32Array} [jobEmbedding] - Pre-computed job embedding
 * @param {Float32Array} [cvEmbedding] - Pre-computed CV embedding
 * @returns {Promise<{score: number, explanation: MatchExplanation}>}
 */
export async function matchJobToCv(jobDescription, cvDoc, mustHaves, jobEmbedding = null, cvEmbedding = null) {
  // 1. Check must-haves
  const mustHaveCheck = checkMustHaves(mustHaves, cvDoc);
  
  // 2. Enhanced sparse BM25 score
  const bm25 = new BM25([jobDescription, cvDoc.text]);
  const sparseScore = bm25.scoreQuery(jobDescription, cvDoc.text);
  const normalizedSparse = normalizeBM25Score(sparseScore);

  // 3. Dense embedding score
  let denseScore = 0;
  if (jobEmbedding && cvEmbedding) {
    denseScore = cosineSimilarity(jobEmbedding, cvEmbedding);
    // Ensure non-negative
    denseScore = Math.max(0, denseScore);
  }

  // 4. Enhanced section-aware scoring
  const sectionScore = calculateSectionScore(jobDescription, cvDoc, bm25, jobEmbedding, cvEmbedding);

  // 5. Final hybrid score with improved weighting
  let finalScore = 
    SCORE_WEIGHTS.dense * denseScore +
    SCORE_WEIGHTS.sparse * normalizedSparse +
    SCORE_WEIGHTS.section * sectionScore;

  // 6. Apply must-have penalty
  if (!mustHaveCheck.satisfied) {
    finalScore = Math.min(finalScore, MUST_HAVE_PENALTY_THRESHOLD);
  }

  // 7. Enhanced calibration
  finalScore = calibrateScore(finalScore);

  // 8. Generate explanation
  const explanation = generateExplanation(
    jobDescription,
    cvDoc,
    mustHaveCheck,
    bm25,
    normalizedSparse,
    denseScore
  );

  return {
    score: finalScore,
    explanation
  };
}

/**
 * Enhanced section-aware weighted score calculation
 * @param {string} jobDescription
 * @param {import('./cvParser.js').CvDoc} cvDoc
 * @param {BM25} bm25
 * @param {Float32Array} [jobEmbedding]
 * @param {Float32Array} [cvEmbedding]
 * @returns {number}
 */
function calculateSectionScore(jobDescription, cvDoc, bm25, jobEmbedding, cvEmbedding) {
  let totalScore = 0;
  let totalWeight = 0;

  // Experience section - most important
  if (cvDoc.sections.experience) {
    const expSparse = bm25.scoreQuery(jobDescription, cvDoc.sections.experience);
    const normalizedExpSparse = normalizeBM25Score(expSparse);
    
    // Apply recency decay
    const recencyMultiplier = calculateRecencyDecay(cvDoc.sections.experience);
    const expScore = normalizedExpSparse * recencyMultiplier;
    
    totalScore += expScore * SECTION_WEIGHTS.experience;
    totalWeight += SECTION_WEIGHTS.experience;
  }

  // Skills section - critical for tech roles
  if (cvDoc.sections.skills) {
    const skillsSparse = bm25.scoreQuery(jobDescription, cvDoc.sections.skills);
    const normalizedSkillsSparse = normalizeBM25Score(skillsSparse);
    
    // Skills get a slight boost if they match well
    const skillsScore = normalizedSkillsSparse * 1.1; // 10% boost
    totalScore += Math.min(1, skillsScore) * SECTION_WEIGHTS.skills;
    totalWeight += SECTION_WEIGHTS.skills;
  }

  // Projects section
  if (cvDoc.sections.projects) {
    const projectsSparse = bm25.scoreQuery(jobDescription, cvDoc.sections.projects);
    const normalizedProjectsSparse = normalizeBM25Score(projectsSparse);
    
    totalScore += normalizedProjectsSparse * SECTION_WEIGHTS.projects;
    totalWeight += SECTION_WEIGHTS.projects;
  }

  // Education + Location section
  const eduLocText = [cvDoc.sections.education, cvDoc.sections.location]
    .filter(Boolean)
    .join('\n');
  
  if (eduLocText) {
    const eduLocSparse = bm25.scoreQuery(jobDescription, eduLocText);
    const normalizedEduLocSparse = normalizeBM25Score(eduLocSparse);
    
    totalScore += normalizedEduLocSparse * SECTION_WEIGHTS.eduLoc;
    totalWeight += SECTION_WEIGHTS.eduLoc;
  }

  // Normalize by total weight
  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Generate match explanation
 * @param {string} jobDescription
 * @param {import('./cvParser.js').CvDoc} cvDoc
 * @param {{satisfied: boolean, missing: string[]}} mustHaveCheck
 * @param {BM25} bm25
 * @param {number} sparseScore
 * @param {number} denseScore
 * @returns {MatchExplanation}
 */
function generateExplanation(jobDescription, cvDoc, mustHaveCheck, bm25, sparseScore, denseScore) {
  // Extract top matched keywords
  const matchedKeywords = extractTopKeywords(jobDescription, cvDoc, bm25);
  
  // Extract top similar sentences
  const topSentences = extractTopSentences(jobDescription, cvDoc, bm25);

  return {
    matchedKeywords,
    missingMustHaves: mustHaveCheck.missing,
    topSentences
  };
}

/**
 * Enhanced keyword extraction with better scoring
 * @param {string} jobDescription
 * @param {import('./cvParser.js').CvDoc} cvDoc
 * @param {BM25} bm25
 * @returns {string[]}
 */
function extractTopKeywords(jobDescription, cvDoc, bm25) {
  const jobTokens = bm25.tokenize(jobDescription);
  const cvTokens = bm25.tokenize(cvDoc.text);
  
  const commonTerms = new Set(
    jobTokens.filter(term => cvTokens.includes(term))
  );

  // Enhanced scoring for keywords
  const termScores = [];
  for (const term of commonTerms) {
    const jobFreq = jobTokens.filter(t => t === term).length;
    const cvFreq = cvTokens.filter(t => t === term).length;
    const idfValue = bm25.idf[term] || 1;
    
    // Boost important keywords
    const importanceBoost = bm25.importantKeywords.has(term) ? 2.0 : 1.0;
    
    // Score = frequency product * IDF * importance
    const score = jobFreq * cvFreq * idfValue * importanceBoost;
    termScores.push({ term, score });
  }

  // Sort and return top 15 (increased from 10)
  termScores.sort((a, b) => b.score - a.score);
  return termScores.slice(0, 15).map(item => item.term);
}

/**
 * Extract top similar sentences with improved scoring
 * @param {string} jobDescription
 * @param {import('./cvParser.js').CvDoc} cvDoc
 * @param {BM25} bm25
 * @returns {Array<{text: string, score: number}>}
 */
function extractTopSentences(jobDescription, cvDoc, bm25) {
  const jobSentences = jobDescription.split(/[.!?]\s+/).filter(s => s.length > 20);
  const cvSentences = cvDoc.text.split(/[.!?]\s+/).filter(s => s.length > 20);

  const sentenceScores = [];

  for (const cvSentence of cvSentences) {
    let maxScore = 0;
    let bestJobSentence = '';

    for (const jobSentence of jobSentences) {
      const score = bm25.scoreQuery(jobSentence, cvSentence);
      if (score > maxScore) {
        maxScore = score;
        bestJobSentence = jobSentence;
      }
    }

    if (maxScore > 0) {
      sentenceScores.push({
        text: cvSentence.substring(0, 150) + (cvSentence.length > 150 ? '...' : ''),
        score: normalizeBM25Score(maxScore)
      });
    }
  }

  // Sort and return top 3
  sentenceScores.sort((a, b) => b.score - a.score);
  return sentenceScores.slice(0, 3);
}

/**
 * Get score color and label
 * @param {number} score
 * @returns {{color: string, label: string, bg: string, text: string}}
 */
export function getScoreInfo(score) {
  if (score >= 0.70) {
    return {
      color: 'green',
      label: 'Excellent',
      bg: '#28a745',
      text: 'white'
    };
  }
  if (score >= 0.50) {
    return {
      color: 'teal',
      label: 'Good',
      bg: '#20c997',
      text: 'white'
    };
  }
  if (score >= 0.30) {
    return {
      color: 'amber',
      label: 'Moderate',
      bg: '#ffc107',
      text: '#333'
    };
  }
  if (score >= 0.10) {
    return {
      color: 'orange',
      label: 'Weak',
      bg: '#fd7e14',
      text: 'white'
    };
  }
  return {
    color: 'red',
    label: 'Very poor',
    bg: '#dc3545',
    text: 'white'
  };
}
