// Embedding Module - Dense semantic embeddings using ONNX runtime
// Falls back to TF-IDF-based pseudo-embeddings if ONNX not available

let onnxSession = null;
let onnxInitialized = false;

/**
 * Initialize ONNX runtime and load model
 * @returns {Promise<boolean>} True if ONNX is available, false otherwise
 */
export async function initializeEmbeddings() {
  if (onnxInitialized) {
    return onnxSession !== null;
  }

  onnxInitialized = true;

  try {
    // Try to load ONNX runtime
    // Note: This requires onnxruntime-web to be included
    // For now, we'll use a fallback approach
    
    // Check if onnxruntime-web is available
    if (typeof window !== 'undefined' && window.ort) {
      const ort = window.ort;
      
      // Model path - user needs to download and place model in vendor/onnx/
      const modelPath = chrome?.runtime?.getURL?.('vendor/onnx/all-MiniLM-L6-v2.onnx') || 
                       './vendor/onnx/all-MiniLM-L6-v2.onnx';
      
      try {
        onnxSession = await ort.InferenceSession.create(modelPath);
        console.log('ONNX model loaded successfully');
        return true;
      } catch (error) {
        console.warn('Failed to load ONNX model, using fallback:', error);
        return false;
      }
    }
    
    return false;
  } catch (error) {
    console.warn('ONNX runtime not available, using fallback embeddings:', error);
    return false;
  }
}

/**
 * Generate embedding for text using ONNX or fallback
 * @param {string} text - Text to embed
 * @param {Map<string, Float32Array>} [cache] - Embedding cache
 * @returns {Promise<Float32Array>}
 */
export async function embed(text, cache = null) {
  if (!text || typeof text !== 'string') {
    return new Float32Array(384); // Default dimension for MiniLM
  }

  // Check cache
  if (cache && cache.has(text)) {
    return cache.get(text);
  }

  // Try ONNX first
  if (onnxSession) {
    try {
      const embedding = await embedWithONNX(text);
      if (cache) cache.set(text, embedding);
      return embedding;
    } catch (error) {
      console.warn('ONNX embedding failed, using fallback:', error);
    }
  }

  // Fallback: TF-IDF-based pseudo-embedding
  const embedding = await embedWithFallback(text);
  if (cache) cache.set(text, embedding);
  return embedding;
}

/**
 * Embed text using ONNX model
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
async function embedWithONNX(text) {
  if (!onnxSession) {
    throw new Error('ONNX session not initialized');
  }

  // Tokenize and prepare input
  // Note: This is simplified - real implementation needs proper tokenization
  const tokens = tokenize(text);
  const inputIds = tokens.map((t, i) => i).slice(0, 128); // Simplified token IDs
  
      // Create input tensor
      // Note: This is a simplified example - actual implementation needs proper tokenization
      // For now, we'll use the fallback method
      throw new Error('ONNX embedding not fully implemented - using fallback');
  
  // Run inference
  const results = await onnxSession.run({ input: inputTensor });
  
  // Extract embedding (assuming output is named 'output' or first output)
  const output = results[Object.keys(results)[0]];
  const embedding = new Float32Array(output.data);
  
  // Normalize
  return normalize(embedding);
}

/**
 * Fallback embedding using TF-IDF-like approach
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
async function embedWithFallback(text) {
  // Create a simple hash-based embedding
  // This is a placeholder until ONNX is properly set up
  const tokens = tokenize(text);
  const embedding = new Float32Array(384); // Match MiniLM dimension
  
  // Simple hash-based feature extraction
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const hash = simpleHash(token);
    
    // Distribute hash across embedding dimensions
    for (let j = 0; j < embedding.length; j++) {
      embedding[j] += Math.sin(hash * (j + 1) + i) * (1 / tokens.length);
    }
  }
  
  return normalize(embedding);
}

/**
 * Simple tokenization
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .slice(0, 128); // Limit length
}

/**
 * Simple hash function
 * @param {string} str
 * @returns {number}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Normalize vector to unit length
 * @param {Float32Array} vec
 * @returns {Float32Array}
 */
function normalize(vec) {
  const norm = Math.sqrt(Array.from(vec).reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vec;
  return new Float32Array(vec.map(val => val / norm));
}

/**
 * Embedding cache manager
 */
export class EmbeddingCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (simple FIFO)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }
}

