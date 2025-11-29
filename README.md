# YouTube Fact-Checking Bot

This project is a YouTube fact-checking bot designed to scan comments, identify requests, evaluate their relevance, and post verified answers.  

---

## 🚀 Workflow Overview

1. **Scan YouTube comments**
   - Fetch top-level comments and replies.
   - Skip threads without replies to minimize API usage.
   - Store comments in the database for traceability.

2. **Identify requests**
   - Extract potential fact-checking requests from comments.
   - Save them in the `requests` table with state = `pending`.

3. **Evaluate relevance**
   - Use `askRelevance()` to decide if a request deserves fact-checking.
   - Update request state to `approved` or `rejected`.

4. **Process approved requests**
   - Generate a fact-checking answer via `askAnswer()`.
   - Post the answer as a reply to the original comment.
   - Update request state to `answered`.
   - Optionally remove the request from the database once processed.

---

## ⚙️ Technical Stack

- **Language**: TypeScript (Node.js runtime)  
- **Database**: SQLite for lightweight persistence and auditability  
- **YouTube Data API v3**:  
  - `commentThreads.list` → fetch top-level comments  
  - `comments.list` → fetch replies  
  - `comments.insert` → post fact-checking replies  
- **LLM API**: AIML API (`chat/completions`) used for relevance evaluation (`askRelevance`) and generating concise fact-checking answers (`askAnswer`)  

---

## 🗂 Database Schema

- **channels** → stores channel IDs  
- **videos** → stores video metadata  
- **comments** → stores comments and replies  
- **requests** → tracks fact-checking requests  

---

## ☁️ Hosting & Deployment

This bot can be hosted like any Node.js service:

1. **Local development**  
   - Install dependencies: `npm install`  
   - Run with: `npm start`  
   - Requires a valid YouTube API key and AIML API key in `.env` file at root, like follow :
      ```
      CLIENT_ID=XXXXXX.apps.googleusercontent.com
      CLIENT_SECRET=XXXXXXXX
      YOUTUBE_HANDLE=@youtubeChanel

      AIML_API_KEY=XXXXXXX
      ```

---

