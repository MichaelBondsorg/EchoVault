# EchoVault Migration Scripts

This folder contains scripts to help maintain your EchoVault journal app.

## Embedding Backfill Script

This script adds "embeddings" (AI-generated numerical representations) to your existing journal entries. Embeddings enable the smart search feature in the Chat assistant.

### What This Script Does

When you ask the Chat assistant a question like "What have I been stressed about?", it uses embeddings to find the most relevant journal entries to answer your question. Entries without embeddings won't show up in these smart searches.

This script:
1. Finds all journal entries that don't have embeddings yet
2. Generates embeddings for each one using Google's AI
3. Saves the embeddings back to your database
4. Handles errors gracefully (if one entry fails, it continues with the rest)

---

## Step-by-Step Instructions

### Step 1: Install Node.js

Node.js is a program that runs JavaScript code on your computer.

**On Mac:**
1. Open Terminal (press Cmd + Space, type "Terminal", press Enter)
2. Install Homebrew (if you don't have it):
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. Install Node.js:
   ```
   brew install node
   ```

**On Windows:**
1. Go to https://nodejs.org
2. Download the "LTS" version (the big green button)
3. Run the installer and follow the prompts

**Verify it worked:**
```
node --version
```
You should see something like `v20.10.0`

---

### Step 2: Download Your Firebase Service Account Key

This is a special file that gives the script permission to access your database.

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Click on your project (echo-vault-app)
3. Click the gear icon (Settings) in the left sidebar
4. Click "Project settings"
5. Click the "Service accounts" tab
6. Click "Generate new private key"
7. Click "Generate key" in the popup
8. A JSON file will download - **keep this file safe and private!**
9. Move this file somewhere you'll remember, like your Desktop
10. Rename it to something simple like `firebase-key.json`

**IMPORTANT:** Never share this file or commit it to GitHub. It's like a master password to your database.

---

### Step 3: Get Your Gemini API Key

You need a Gemini API key to generate embeddings.

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key (it looks like `AIzaSy...`)
5. Save it somewhere safe (you'll need it in the next step)

---

### Step 4: Download the Script

1. Open Terminal (Mac) or Command Prompt (Windows)
2. Navigate to where you want to put the script:
   ```
   cd ~/Desktop
   ```
3. Create a new folder:
   ```
   mkdir echovault-migration
   cd echovault-migration
   ```
4. Download the script from your GitHub repository, or copy the `backfill-embeddings.js` file into this folder

---

### Step 5: Install Dependencies

In your Terminal, make sure you're in the folder with the script, then run:

```
npm install firebase-admin node-fetch
```

This downloads the libraries the script needs.

---

### Step 6: Run the Script

Now you'll run the script with your credentials.

**On Mac/Linux:**
```
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/firebase-key.json"
export GEMINI_API_KEY="your-gemini-api-key-here"
node backfill-embeddings.js
```

Replace:
- `/path/to/your/firebase-key.json` with the actual path to your Firebase key file
  - Example: `/Users/yourname/Desktop/firebase-key.json`
- `your-gemini-api-key-here` with your actual Gemini API key

**On Windows (Command Prompt):**
```
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\your\firebase-key.json
set GEMINI_API_KEY=your-gemini-api-key-here
node backfill-embeddings.js
```

**On Windows (PowerShell):**
```
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\your\firebase-key.json"
$env:GEMINI_API_KEY="your-gemini-api-key-here"
node backfill-embeddings.js
```

---

### Step 7: Watch It Run

The script will show you progress as it runs:

```
============================================================
EchoVault Embedding Backfill Script
============================================================

Initializing Firebase Admin SDK...
Fetching user list...
Found 3 users

Processing user: abc123...
  Processing entry xyz789 (Today I felt really anxious about...)
  Batch complete: 1 processed, 0 skipped, 0 errors

...

============================================================
Backfill Complete
============================================================
Total entries scanned: 47
Embeddings generated:  12
Already had embedding: 35
Errors:                0
Duration:              23.4s
============================================================
```

---

## Troubleshooting

### "Error: GEMINI_API_KEY environment variable is not set"
Make sure you ran the `export` (Mac) or `set` (Windows) command with your API key before running the script.

### "Error: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set"
Make sure you ran the `export` (Mac) or `set` (Windows) command with the path to your Firebase key file.

### "Failed to initialize Firebase Admin SDK"
- Check that the path to your Firebase key file is correct
- Make sure the file exists and hasn't been moved
- Try using the full absolute path (starting with `/` on Mac or `C:\` on Windows)

### "Rate limited, waiting..."
This is normal! Google limits how many requests you can make per minute. The script automatically waits and retries.

### Script seems stuck
The script processes entries one at a time to avoid rate limits. For many entries, it may take several minutes. Watch the console output for progress.

---

## After Running the Script

Once the script completes:

1. Open your EchoVault app
2. Go to the Chat feature
3. Ask a question about your journal entries
4. The Chat should now be able to find and reference your older entries!

---

## Security Notes

- **Delete the Firebase key file** after you're done, or store it somewhere very secure
- **Never share** your Firebase key or Gemini API key with anyone
- **Never commit** these credentials to GitHub or any public repository
- The script only reads your journal text and writes embeddings - it doesn't modify or delete any of your actual journal content

---

## Need Help?

If you run into issues, you can:
1. Check the error message carefully - it usually tells you what's wrong
2. Make sure all the paths and API keys are correct
3. Try running the script again (it's safe to run multiple times - it skips entries that already have embeddings)
