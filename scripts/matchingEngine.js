// Hybrid Matching Engine - BM25 + Dense Embeddings + Section-aware scoring

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

// Section weights
const SECTION_WEIGHTS = {
  experience: 0.45,
  skills: 0.25,
  projects: 0.15,
  eduLoc: 0.15
};

// Final score weights
const SCORE_WEIGHTS = {
  dense: 0.35,
  sparse: 0.25,
  section: 0.40
};

// Must-have penalty threshold
const MUST_HAVE_PENALTY_THRESHOLD = 0.35;

/**
 * Simple BM25 implementation
 */
class BM25 {
  constructor(documents, k1 = 1.5, b = 0.75) {
    this.documents = documents.map(doc => this.tokenize(doc));
    this.k1 = k1;
    this.b = b;
    this.avgDocLength = this.documents.reduce((sum, doc) => sum + doc.length, 0) / this.documents.length;
    this.idf = this.calculateIDF();
  }

  tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s#+.-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  calculateIDF() {
    const idf = {};
    const totalDocs = this.documents.length;

    for (const doc of this.documents) {
      const uniqueTerms = new Set(doc);
      for (const term of uniqueTerms) {
        idf[term] = (idf[term] || 0) + 1;
      }
    }

    for (const term in idf) {
      const docFreq = idf[term];
      idf[term] = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5));
    }

    return idf;
  }

  score(query, docIndex) {
    const queryTerms = this.tokenize(query);
    const doc = this.documents[docIndex];
    const docLength = doc.length;
    
    let score = 0;
    const termFreq = {};

    for (const term of doc) {
      termFreq[term] = (termFreq[term] || 0) + 1;
    }

    for (const term of queryTerms) {
      if (!this.idf[term]) continue;
      
      const tf = termFreq[term] || 0;
      const numerator = this.idf[term] * tf * (this.k1 + 1);
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
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Normalize score to [0, 1] range with calibration
 * @param {number} score
 * @returns {number}
 */
function calibrateScore(score) {
  // Simple min-max normalization with sigmoid-like curve for better distribution
  // Clamp to [0, 1] and apply slight curve
  const clamped = Math.max(0, Math.min(1, score));
  
  // Apply slight boost to mid-range scores
  if (clamped > 0.3 && clamped < 0.7) {
    return clamped * 1.1; // Slight boost
  }
  
  return clamped;
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
  
  // 2. Sparse BM25 score
  const bm25 = new BM25([jobDescription, cvDoc.text]);
  const sparseScore = bm25.scoreQuery(jobDescription, cvDoc.text);
  const normalizedSparse = Math.max(0, Math.min(1, sparseScore / 10)); // Normalize BM25 score

  // 3. Dense embedding score
  let denseScore = 0;
  if (jobEmbedding && cvEmbedding) {
    denseScore = cosineSimilarity(jobEmbedding, cvEmbedding);
    // Ensure non-negative
    denseScore = Math.max(0, denseScore);
  }

  // 4. Section-aware scoring
  const sectionScore = calculateSectionScore(jobDescription, cvDoc, bm25, jobEmbedding, cvEmbedding);

  // 5. Final hybrid score
  let finalScore = 
    SCORE_WEIGHTS.dense * denseScore +
    SCORE_WEIGHTS.sparse * normalizedSparse +
    SCORE_WEIGHTS.section * sectionScore;

  // 6. Apply must-have penalty
  if (!mustHaveCheck.satisfied) {
    finalScore = Math.min(finalScore, MUST_HAVE_PENALTY_THRESHOLD);
  }

  // 7. Calibrate and clamp
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
 * Calculate section-aware weighted score
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

  // Experience section
  if (cvDoc.sections.experience) {
    const expSparse = bm25.scoreQuery(jobDescription, cvDoc.sections.experience);
    const normalizedExpSparse = Math.max(0, Math.min(1, expSparse / 10));
    
    // Apply recency decay
    const recencyMultiplier = calculateRecencyDecay(cvDoc.sections.experience);
    const expScore = normalizedExpSparse * recencyMultiplier;
    
    totalScore += expScore * SECTION_WEIGHTS.experience;
    totalWeight += SECTION_WEIGHTS.experience;
  }

  // Skills section
  if (cvDoc.sections.skills) {
    const skillsSparse = bm25.scoreQuery(jobDescription, cvDoc.sections.skills);
    const normalizedSkillsSparse = Math.max(0, Math.min(1, skillsSparse / 10));
    
    totalScore += normalizedSkillsSparse * SECTION_WEIGHTS.skills;
    totalWeight += SECTION_WEIGHTS.skills;
  }

  // Projects section
  if (cvDoc.sections.projects) {
    const projectsSparse = bm25.scoreQuery(jobDescription, cvDoc.sections.projects);
    const normalizedProjectsSparse = Math.max(0, Math.min(1, projectsSparse / 10));
    
    totalScore += normalizedProjectsSparse * SECTION_WEIGHTS.projects;
    totalWeight += SECTION_WEIGHTS.projects;
  }

  // Education + Location section
  const eduLocText = [cvDoc.sections.education, cvDoc.sections.location]
    .filter(Boolean)
    .join('\n');
  
  if (eduLocText) {
    const eduLocSparse = bm25.scoreQuery(jobDescription, eduLocText);
    const normalizedEduLocSparse = Math.max(0, Math.min(1, eduLocSparse / 10));
    
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
  
  // Extract top similar sentences (simplified - using BM25 on sentences)
  const topSentences = extractTopSentences(jobDescription, cvDoc, bm25);

  return {
    matchedKeywords,
    missingMustHaves: mustHaveCheck.missing,
    topSentences
  };
}

/**
 * Extract top matching keywords
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

  // Score each common term
  const termScores = [];
  for (const term of commonTerms) {
    // Simple frequency-based scoring
    const jobFreq = jobTokens.filter(t => t === term).length;
    const cvFreq = cvTokens.filter(t => t === term).length;
    const score = jobFreq * cvFreq * (bm25.idf[term] || 1);
    termScores.push({ term, score });
  }

  // Sort and return top 10
  termScores.sort((a, b) => b.score - a.score);
  return termScores.slice(0, 10).map(item => item.term);
}

/**
 * Extract top similar sentences
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
        score: Math.max(0, Math.min(1, maxScore / 10))
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

