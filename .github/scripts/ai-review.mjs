import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Error: GEMINI_API_KEY secret is not set in repository secrets!');
  process.exit(1);
}

const prNumber = process.env.PR_NUMBER;
if (!prNumber) {
  console.error('Error: PR_NUMBER environment variable is required');
  process.exit(1);
}

const model = process.env.MODEL || 'gemini-2.5-flash';
const commentBody = process.env.COMMENT_BODY || '/review';

// 1. Fetch PR details (title, body) using gh CLI
let prTitle = '';
let prBody = '';
try {
  const prJson = execSync(`gh pr view ${prNumber} --json title,body`, { encoding: 'utf8' });
  const parsed = JSON.parse(prJson);
  prTitle = parsed.title || '';
  prBody = parsed.body || '';
} catch (e) {
  console.warn('Could not fetch PR title/body via gh:', e.message);
}

// 2. Fetch PR diff using gh CLI
let diff = '';
try {
  diff = execSync(`gh pr diff ${prNumber}`, { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
} catch (e) {
  console.error('Error fetching PR diff:', e.message);
  process.exit(1);
}

if (!diff || !diff.trim()) {
  console.log('No code changes found in PR.');
  writeFileSync(
    'review.md',
    '### 🤖 Gemini AI Code Review\n\nBu PR için incelenecek herhangi bir kod değişikliği (diff) bulunamadı.',
    'utf8',
  );
  process.exit(0);
}

// Truncate if diff is exceptionally huge (> 250 KB)
const MAX_DIFF_LENGTH = 250_000;
let truncatedNote = '';
if (diff.length > MAX_DIFF_LENGTH) {
  diff = diff.slice(0, MAX_DIFF_LENGTH);
  truncatedNote =
    '\n\n> ⚠️ *Not: PR diff boyutu çok büyük olduğu için ilk 250.000 karakter incelendi.*';
}

const systemPrompt = `You are a senior full-stack software engineer and expert code reviewer.
Review the code changes in this Pull Request thoroughly.

Structure your review as follows:
### 📋 Özet (Summary)
Briefly explain what this PR changes and its overall goal.

### 🔍 Detaylı İnceleme (Code Analysis)
- **Hatalar & Riskler (Bugs & Edge Cases):** Any logical bugs, undefined variables, unhandled promise rejections, memory leaks, or edge cases.
- **Güvenlik & Performans (Security & Performance):** Vulnerabilities, rate-limit issues, memory leaks, unnecessary database queries.
- **Kod Kalitesi & TypeScript:** Type safety, code readability, cleaner syntax, Discord.js best practices.

### 💡 Öneriler ve Çözümler (Suggestions & Fixes)
Provide concrete code suggestions if applicable using markdown code blocks.

Format your response cleanly in Turkish, professional, concise, and constructive.`;

const userPrompt = `## PR Title: ${prTitle}
## PR Description:
${prBody}

## Changes Diff:
\`\`\`diff
${diff}
\`\`\``;

async function run() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const reviewText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reviewText) {
    throw new Error('Gemini did not return any review text.');
  }

  const header = `## 🤖 Gemini AI Code Review\n\n> 💬 *Tetikleyen komut:* \`${commentBody}\`${truncatedNote}\n\n`;
  writeFileSync('review.md', header + reviewText, 'utf8');
  console.log('Review generated successfully and written to review.md');
}

run().catch((err) => {
  console.error('Fatal error during Gemini review:', err);
  process.exit(1);
});
