// NLP utilities for matching resumes with job descriptions
// Simple TF-IDF and cosine similarity implementation

// Common stopwords to filter out
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'the', 'this', 'but', 'they', 'have',
  'had', 'what', 'said', 'each', 'which', 'their', 'time', 'if',
  'up', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her',
  'would', 'make', 'like', 'into', 'him', 'has', 'two', 'more', 'very',
  'after', 'words', 'long', 'than', 'first', 'been', 'call', 'who',
  'oil', 'sit', 'now', 'find', 'down', 'day', 'did', 'get', 'come',
  'made', 'may', 'part'
]);

/**
 * Tokenize text into words (lowercase, remove stopwords, basic cleaning)
 */
function tokenize(text) {
  if (!text) return [];
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Calculate term frequency (TF) for a document
 */
function calculateTF(tokens) {
  const tf = {};
  const totalTerms = tokens.length;
  
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  
  // Normalize by document length
  for (const term in tf) {
    tf[term] = tf[term] / totalTerms;
  }
  
  return tf;
}

/**
 * Calculate inverse document frequency (IDF) for terms across documents
 */
function calculateIDF(documents) {
  const idf = {};
  const totalDocs = documents.length;
  
  for (const doc of documents) {
    const uniqueTerms = new Set(doc);
    for (const term of uniqueTerms) {
      idf[term] = (idf[term] || 0) + 1;
    }
  }
  
  // Calculate IDF: log(totalDocs / docFrequency)
  for (const term in idf) {
    idf[term] = Math.log(totalDocs / idf[term]);
  }
  
  return idf;
}

/**
 * Calculate TF-IDF vector for a document
 */
function calculateTFIDF(tokens, idf) {
  const tf = calculateTF(tokens);
  const tfidf = {};
  
  for (const term in tf) {
    tfidf[term] = tf[term] * (idf[term] || 0);
  }
  
  return tfidf;
}

/**
 * Calculate cosine similarity between two TF-IDF vectors
 */
function calculateCosineSimilarity(vec1, vec2) {
  const allTerms = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (const term of allTerms) {
    const val1 = vec1[term] || 0;
    const val2 = vec2[term] || 0;
    
    dotProduct += val1 * val2;
    norm1 += val1 * val1;
    norm2 += val2 * val2;
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Match job description with resume text using cosine similarity
 */
export function cosineSimilarity(jobDescription, resumeText) {
  const jobTokens = tokenize(jobDescription);
  const resumeTokens = tokenize(resumeText);
  
  if (jobTokens.length === 0 || resumeTokens.length === 0) {
    return 0;
  }
  
  // Build IDF from both documents
  const idf = calculateIDF([jobTokens, resumeTokens]);
  
  // Calculate TF-IDF vectors
  const jobTFIDF = calculateTFIDF(jobTokens, idf);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf);
  
  // Calculate cosine similarity
  return calculateCosineSimilarity(jobTFIDF, resumeTFIDF);
}

/**
 * Get top matching keywords between job description and resume
 */
export function getTopMatchingKeywords(jobDescription, resumeText, topN = 10) {
  const jobTokens = tokenize(jobDescription);
  const resumeTokens = tokenize(resumeText);
  
  if (jobTokens.length === 0 || resumeTokens.length === 0) {
    return [];
  }
  
  // Build IDF
  const idf = calculateIDF([jobTokens, resumeTokens]);
  
  // Calculate TF-IDF vectors
  const jobTFIDF = calculateTFIDF(jobTokens, idf);
  const resumeTFIDF = calculateTFIDF(resumeTokens, idf);
  
  // Find common terms and calculate their contribution
  const commonTerms = new Set(
    Object.keys(jobTFIDF).filter(term => resumeTFIDF[term])
  );
  
  const termScores = [];
  for (const term of commonTerms) {
    const score = jobTFIDF[term] * resumeTFIDF[term];
    termScores.push({ term, score });
  }
  
  // Sort by score and return top N
  termScores.sort((a, b) => b.score - a.score);
  return termScores.slice(0, topN).map(item => item.term);
}

