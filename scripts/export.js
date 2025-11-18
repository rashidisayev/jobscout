// CSV export utility for JobScout

/**
 * Export jobs to CSV file
 */
export function exportToCsv(jobs) {
  if (!jobs || jobs.length === 0) {
    throw new Error('No jobs to export');
  }
  
  // CSV headers
  const headers = [
    'Date Found',
    'Title',
    'Company',
    'Location',
    'Date Posted',
    'Link',
    'Best Resume',
    'Match Score',
    'Top Keywords'
  ];
  
  // Convert jobs to CSV rows
  const rows = jobs.map(job => [
    formatDate(job.foundAt),
    escapeCsvField(job.title || ''),
    escapeCsvField(job.company || ''),
    escapeCsvField(job.location || ''),
    escapeCsvField(job.datePosted || ''),
    escapeCsvField(job.link || ''),
    escapeCsvField(job.bestResume || ''),
    job.matchScore !== undefined ? (job.matchScore * 100).toFixed(2) : '',
    escapeCsvField((job.topKeywords || []).join(', '))
  ]);
  
  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jobscout-export-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Escape CSV field (handle commas, quotes, newlines)
 */
function escapeCsvField(field) {
  if (field === null || field === undefined) {
    return '';
  }
  
  const str = String(field);
  
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Format date for CSV
 */
function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toISOString();
}

