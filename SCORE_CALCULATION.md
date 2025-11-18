# JobScout Score Calculation Explained

## How Resume Matching Works

JobScout uses **TF-IDF (Term Frequency-Inverse Document Frequency)** and **Cosine Similarity** to match job descriptions with your resumes.

### Step-by-Step Process

1. **Tokenization**
   - Both job description and resume text are converted to lowercase
   - Punctuation is removed
   - Text is split into individual words (tokens)
   - Stopwords (common words like "the", "and", "is") are filtered out
   - Only words longer than 2 characters are kept

2. **TF-IDF Calculation**
   - **Term Frequency (TF)**: How often a word appears in a document, normalized by document length
   - **Inverse Document Frequency (IDF)**: How rare/common a word is across both documents
   - Words that appear in both documents get higher weights
   - Common words get lower weights

3. **Cosine Similarity**
   - Creates vectors from the TF-IDF scores
   - Calculates the angle between the two vectors
   - Returns a score between 0 and 1:
     - **0.0** = No similarity (completely different)
     - **1.0** = Perfect match (identical content)
   - Typically, scores range from 0.1 to 0.7 for real matches

### Why Scores Might Be 0.0%

Common reasons for zero scores:

1. **Empty Job Descriptions**
   - If LinkedIn job descriptions aren't being scraped correctly
   - Check browser console for errors during scraping
   - Verify job descriptions are being fetched from detail pages

2. **Resume Text Not Parsed**
   - PDF/DOCX files might not be parsing correctly
   - Check that resumes show word counts in the Resumes tab
   - Try uploading a TXT file as a test

3. **No Common Terms**
   - Job description and resume have completely different vocabulary
   - This is rare but possible for very different fields

4. **Text Too Short**
   - Job description or resume text is less than 10 characters
   - Matching requires meaningful text to work

### How to Debug

1. **Check Browser Console** (F12 → Console tab)
   - Look for debug messages about:
     - "Zero score match"
     - "Empty tokens after tokenization"
     - "Missing text for similarity"
   - These will tell you what's wrong

2. **Verify Resume Upload**
   - Go to Options → Resumes tab
   - Check that resumes show word counts
   - If word count is 0, the resume wasn't parsed correctly

3. **Check Job Descriptions**
   - In the browser console, check if job descriptions are being fetched
   - Look for "Final job info after detail page extraction" logs
   - Verify `hasDescription: true` in the logs

4. **Test with Sample Text**
   - Try uploading a simple resume with common tech terms
   - Scan a job that clearly matches
   - Scores should be > 0 if everything is working

### Expected Score Ranges

- **0.0 - 0.1**: Very poor match (different fields/skills)
- **0.1 - 0.3**: Weak match (some common terms)
- **0.3 - 0.5**: Moderate match (relevant but not perfect)
- **0.5 - 0.7**: Good match (strong overlap)
- **0.7 - 1.0**: Excellent match (very similar content)

### Improving Scores

1. **Ensure Job Descriptions Are Scraped**
   - The extension fetches full job descriptions from detail pages
   - If descriptions are empty, check content.js scraping logic

2. **Upload Complete Resumes**
   - Include skills, experience, education
   - More text = better matching

3. **Check for Common Keywords**
   - Job and resume should share technical terms
   - Industry-specific vocabulary helps

### Technical Details

The formula used:
```
cosine_similarity = dot_product(vec1, vec2) / (norm(vec1) * norm(vec2))
```

Where:
- `vec1` = TF-IDF vector of job description
- `vec2` = TF-IDF vector of resume
- `dot_product` = sum of element-wise products
- `norm` = vector magnitude (Euclidean norm)

This gives a normalized score between 0 and 1, representing how similar the two documents are in terms of their word usage and importance.

