/**
 * JobScout - Google Sheets Integration Script
 * 
 * SETUP INSTRUCTIONS:
 * 
 * 1. Create a new Google Sheet with these column headers in Row 1:
 *    Position | Application Status | Company | Applied on | Job Description
 * 
 * 2. In your Google Sheet, go to Extensions → Apps Script
 * 
 * 3. Delete any existing code and paste this entire script
 * 
 * 4. Click Save (💾 icon)
 * 
 * 5. Deploy as Web App:
 *    - Click Deploy → New deployment
 *    - Click the gear icon (⚙️) next to "Select type"
 *    - Choose "Web app"
 *    - Set "Execute as" to "Me"
 *    - Set "Who has access" to "Anyone"
 *    - Click Deploy
 *    - Copy the Web app URL (ends with /exec)
 *    - Paste it in the JobScout extension's Resumes tab
 * 
 * 6. You may need to authorize the script:
 *    - Click "Review Permissions"
 *    - Choose your Google account
 *    - Click "Advanced" → "Go to [Project Name] (unsafe)"
 *    - Click "Allow"
 * 
 * USAGE:
 * - When you click "Save" on a job in JobScout, it will be added to your sheet
 * - Duplicate jobs (same Job Description URL) will not be added
 * - Click "Test Connection" in JobScout to verify the setup
 */

/**
 * Handle GET requests (for when URL is accessed directly)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    message: 'This is a JobScout Google Apps Script endpoint. It only accepts POST requests from the extension.',
    instructions: 'Please use the JobScout Chrome extension to save jobs to this sheet.'
  }))
  .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests from JobScout extension
 */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Check if e and postData exist
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('Error: No data received. e = ' + JSON.stringify(e));
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'no_data',
        message: 'No data received. Make sure the request includes JSON data.'
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    const data = JSON.parse(e.postData.contents);
    
    // Handle test request
    if (data.action === 'test') {
      const testRow = [
        'TEST JOB - You can delete this row',
        'TEST',
        'TEST COMPANY',
        new Date().toLocaleDateString('en-GB'),
        'https://test.com'
      ];
      sheet.appendRow(testRow);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: 'Test successful! Check your sheet for a test row.'
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Check for duplicates (optional - prevents saving the same job twice)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const urlColumn = 5; // Job Description column (E)
      const existingUrls = sheet.getRange(2, urlColumn, lastRow - 1, 1).getValues();
      
      for (let i = 0; i < existingUrls.length; i++) {
        if (existingUrls[i][0] === data.jobUrl) {
          return ContentService.createTextOutput(JSON.stringify({
            success: false,
            error: 'duplicate',
            message: 'This job has already been saved to your sheet.'
          }))
          .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    
    // Append new row with job data
    const newRow = [
      data.position,      // Column A: Position
      data.status,        // Column B: Application Status (always "Applied")
      data.company,       // Column C: Company
      data.appliedOn,     // Column D: Applied on (dd.mm.yyyy)
      data.jobUrl         // Column E: Job Description (URL)
    ];
    
    sheet.appendRow(newRow);
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Job saved successfully!'
    }))
    .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    Logger.log('Stack trace: ' + error.stack);
    if (e) {
      Logger.log('Request data: ' + JSON.stringify(e));
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString(),
      errorType: error.name,
      message: 'Failed to save job. Error: ' + error.message
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Optional: Function to manually test the script
 * Run this function from the Apps Script editor to verify it works
 */
function testScript() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Test data
  const testData = {
    position: 'Test Position - Software Engineer',
    status: 'Applied',
    company: 'Test Company Inc.',
    appliedOn: new Date().toLocaleDateString('en-GB'),
    jobUrl: 'https://linkedin.com/jobs/view/12345678'
  };
  
  sheet.appendRow([
    testData.position,
    testData.status,
    testData.company,
    testData.appliedOn,
    testData.jobUrl
  ]);
  
  Logger.log('Test row added successfully!');
}
