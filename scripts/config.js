// Configuration constants for JobScout

/**
 * Minimum match score threshold (0-1 scale)
 * Jobs below this score will be excluded from results
 */
export const MIN_SCORE_THRESHOLD = 0.05; // 5%

/**
 * Maximum number of search URLs allowed
 */
export const MAX_SEARCH_URLS = 10;

/**
 * Maximum number of pages to scan per search URL
 */
export const MAX_PAGES_PER_URL = 5;

/**
 * Scan interval defaults (in minutes)
 */
export const SCAN_INTERVAL = {
  MIN: 15,
  MAX: 1440, // 24 hours
  DEFAULT: 60
};

/**
 * Job archival settings
 */
export const ARCHIVAL = {
  // Archive jobs older than this many days
  DAYS_TO_ARCHIVE: 90,
  // Maximum number of recent job IDs to keep in lastSeenJobIds
  MAX_RECENT_JOB_IDS: 2000
};

/**
 * Matching score thresholds for display
 */
export const SCORE_THRESHOLDS = {
  EXCELLENT: 0.70, // 70%+
  GOOD: 0.50,      // 50-70%
  MODERATE: 0.30,  // 30-50%
  WEAK: 0.10       // 10-30%
};

/**
 * Resume validation settings
 */
export const RESUME = {
  MIN_TEXT_LENGTH: 10,
  MAX_FILE_SIZE_MB: 10
};

/**
 * Pagination settings
 */
export const PAGINATION = {
  RESULTS_PER_PAGE: 20
};


