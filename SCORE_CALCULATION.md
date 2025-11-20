# JobScout Score Calculation Explained

## How Resume Matching Works

JobScout uses an **enhanced TF-IDF (Term Frequency-Inverse Document Frequency)** algorithm with **keyword weighting** and **Cosine Similarity** to match job descriptions with your resumes.

### Step-by-Step Process

1. **Enhanced Tokenization**
   - Both job description and resume text are converted to lowercase
   - Punctuation is removed (except special chars for tech terms like C++, .NET)
   - Text is split into individual words (tokens)
   - Stopwords (common words like "the", "and", "is") are filtered out
   - Only words longer than 2 characters are kept
   - Technical terms with special characters are preserved

2. **Important Keyword Extraction**
   - Extracts technical keywords: programming languages, frameworks, tools, databases, cloud platforms
   - Identifies capitalized terms (technologies, company names)
   - Creates a set of important keywords from both documents

3. **Weighted TF-IDF Calculation**
   - **Term Frequency (TF)**: How often a word appears in a document, normalized by document length
   - **Inverse Document Frequency (IDF)**: How rare/common a word is across both documents (with smoothing)
   - **Keyword Weighting**:
     - Important keywords (skills, technologies) get **2.0x weight**
     - Multi-word technical terms get **1.3x boost**
     - Common words get lower weights
   - Words that appear in both documents get higher weights

4. **Cosine Similarity**
   - Creates vectors from the weighted TF-IDF scores
   - Calculates the angle between the two vectors
   - Returns a base score between 0 and 1

5. **Score Bonuses**
   - **Keyword Matching Bonus**: Up to **15% bonus** for matching important keywords
     - Formula: `min(0.15, matchingKeywords.length * 0.02)`
   - **Title Matching Bonus**: **5% bonus** if job title matches resume content

6. **Final Score**
   - Base cosine similarity + keyword bonus + title bonus
   - Normalized to ensure score is between 0 and 1
   - Formula: `score = baseSimilarity + keywordBonus + titleBonus`
   - Clamped to [0, 1] range

### Score Thresholds and Filtering

**Minimum Score Threshold: 5% (0.05)**
- Jobs with scores below 5% are automatically excluded
- Jobs with 0% scores are excluded
- This filters out irrelevant jobs like "Elektriker*in" when you're looking for software engineering roles

**Exclusion Filters**
Jobs are also excluded if they match multiple exclusion patterns:
- Different career levels (intern, entry-level, junior, etc.)
- Different job types (part-time, contractor, freelance, etc.)
- Different industries (retail, construction, etc.)

### Expected Score Ranges

- **≥ 0.70 (70%)**: Excellent match (green) - Very similar content
- **0.50 - 0.69 (50-69%)**: Good match (teal) - Strong overlap
- **0.30 - 0.49 (30-49%)**: Moderate match (amber) - Relevant but not perfect
- **0.10 - 0.29 (10-29%)**: Weak match (orange) - Some common terms
- **0.05 - 0.09 (5-9%)**: Very poor match (red) - Minimal relevance
- **< 0.05 (<5%)**: Excluded - Not shown in results

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
   - No matching technical skills or keywords
   - Different industries or fields

4. **Text Too Short**
   - Job description or resume text is less than 10 characters
   - Matching requires meaningful text to work

5. **Exclusion Filters**
   - Job matches exclusion patterns (intern, part-time, different industry, etc.)
   - Automatically filtered out before scoring

### How to Debug

1. **Check Browser Console** (F12 → Console tab)
   - Look for debug messages about:
     - "Matching job X against Y resume(s)"
     - "Score for filename.pdf: 0.1234"
     - "Job excluded by filters"
     - "Job score below threshold"
   - These will tell you what's happening

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
   - Scores should be > 0.05 if everything is working

### Improving Scores

1. **Ensure Job Descriptions Are Scraped**
   - The extension fetches full job descriptions from detail pages
   - If descriptions are empty, check content.js scraping logic

2. **Upload Complete Resumes**
   - Include skills, experience, education
   - More text = better matching
   - Include technical keywords and technologies

3. **Check for Common Keywords**
   - Job and resume should share technical terms
   - Industry-specific vocabulary helps
   - Matching important keywords gives bonus points

4. **Relevant Job Titles**
   - If job title matches your resume content, you get a 5% bonus
   - This helps surface relevant positions

### Technical Details

#### Base Cosine Similarity Formula
```
cosine_similarity = dot_product(vec1, vec2) / (norm(vec1) * norm(vec2))
```

Where:
- `vec1` = Weighted TF-IDF vector of job description
- `vec2` = Weighted TF-IDF vector of resume
- `dot_product` = sum of element-wise products
- `norm` = vector magnitude (Euclidean norm)

#### Weighted TF-IDF
```
tfidf[term] = tf[term] * idf[term] * weight[term]
```

Where:
- `tf[term]` = Term frequency (normalized)
- `idf[term]` = Inverse document frequency (with smoothing)
- `weight[term]` = 2.0 for important keywords, 1.3 for multi-word terms, 1.0 otherwise

#### Final Score Calculation
```
baseScore = cosineSimilarity(weightedJobTFIDF, weightedResumeTFIDF)
keywordBonus = min(0.15, matchingKeywords.length * 0.02)
titleBonus = 0.05 if title matches, else 0
finalScore = clamp(baseScore + keywordBonus + titleBonus, 0, 1)
```

#### IDF Smoothing
```
idf[term] = log((totalDocs + 1) / (docFrequency + 1))
```

This prevents zero values when a term appears in all documents and ensures better differentiation for small document sets.

### Important Keywords

The system automatically identifies and weights these types of terms:

- **Programming Languages**: Java, Python, JavaScript, TypeScript, Go, Rust, C++, C#, etc.
- **Frameworks**: React, Angular, Vue, Node.js, Express, Django, Flask, Spring, etc.
- **Databases**: MySQL, PostgreSQL, MongoDB, Redis, Elasticsearch, etc.
- **Cloud Platforms**: AWS, Azure, GCP, Docker, Kubernetes, Terraform, etc.
- **Tools**: Git, CI/CD, Jenkins, GitHub Actions, Agile, Scrum, etc.
- **Data/ML**: Machine Learning, AI, TensorFlow, PyTorch, Data Science, etc.

### Filtering and Exclusion

**Automatic Exclusion:**
- Jobs with scores < 5% (0.05) are excluded
- Jobs with 0% scores are excluded
- Jobs matching exclusion patterns are excluded
- Excluded jobs are removed from storage and not shown in results

**Exclusion Patterns:**
- Career level mismatches (intern, entry-level, junior when you're senior)
- Job type mismatches (part-time, contractor when you want full-time)
- Industry mismatches (retail, construction when you're in tech)

This ensures you only see relevant job opportunities that match your profile.
