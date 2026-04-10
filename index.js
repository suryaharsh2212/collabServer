/**
 * index.js — Express API Server + Puppeteer PDF export
 */
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;


const allowedOrigins = [
  'https://collabdocs-z51m.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));


const rooms = new Map();


/** Generate PDF via Puppeteer */
app.post('/api/export/pdf', async (req, res) => {
  const { html, title, margins, indentation } = req.body;
  if (!html) {
    return res.status(400).json({ error: 'HTML content is required' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    // Create full HTML document to render
    const fullHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${title || 'CollabDocs Export'}</title>
        <style>
          body { font-family: 'Inter', system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 0; line-height: 1.6; color: #1a1a1a; }
          
          /* Typography */
          h1 { font-size: 2.5rem; margin-bottom: 1rem; color: #111; text-align: center; }
          h2 { font-size: 1.8rem; margin-top: 2rem; margin-bottom: 0.8rem; color: #333; }
          h3 { font-size: 1.4rem; margin-top: 1.5rem; margin-bottom: 0.6rem; color: #444; }
          p { margin-bottom: 1rem; text-indent: ${indentation || 0}mm; }
          
          /* Tables */
          table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; margin-bottom: 1.5rem; table-layout: auto; }
          th, td { border: 1px solid #ddd; padding: 12px 15px; text-align: left; }
          th { background-color: #f8f9fa; font-weight: bold; color: #333; }
          tr:nth-child(even) { background-color: #fafafa; }
          
          /* Blocks */
          pre { background: #f5f5f5; padding: 1.5rem; border-radius: 8px; overflow-x: auto; font-family: 'JetBrains Mono', monospace; border: 1px solid #e0e0e0; margin-bottom: 1.5rem; }
          code { background: #f0f0f0; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
          blockquote { border-left: 4px solid #6366f1; padding: 1rem 1.5rem; background: #f9f9ff; color: #444; font-style: italic; border-radius: 0 8px 8px 0; margin-bottom: 1.5rem; margin-left: 0; }
          
          /* Images & Media */
          img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 1.5rem 0; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
          
          /* Alignment Helpers */
          [style*="text-align: center"] { text-align: center; }
          [style*="text-align: center"] img, 
          [style*="text-align: center"] table { margin-left: auto !important; margin-right: auto !important; }
          
          [style*="text-align: right"] { text-align: right; }
          [style*="text-align: right"] img, 
          [style*="text-align: right"] table { margin-left: auto !important; margin-right: 0 !important; }
          
          /* Task Lists */
          ul[data-type="taskList"] { list-style: none; padding-left: 0; }
          ul[data-type="taskList"] li { display: flex; align-items: flex-start; margin-bottom: 0.5rem; }
          ul[data-type="taskList"] input[type="checkbox"] { margin-right: 10px; margin-top: 5px; }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;

    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: 'domcontentloaded' });

    // Format margins to include 'mm' if they are numbers
    const finalMargins = margins ? {
      top: `${margins.top}mm`,
      right: `${margins.right}mm`,
      bottom: `${margins.bottom}mm`,
      left: `${margins.left}mm`
    } : { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' };

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: finalMargins,
      printBackground: true
    });

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title || 'Export'}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// ---- Metadata Routes ----

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'collabdocs-api',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/rooms', (req, res) => {
  const { roomId, title, owner } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId is required' });

  if (rooms.has(roomId)) {
    return res.json({ room: rooms.get(roomId), created: false });
  }

  const room = {
    id: roomId,
    title: title || 'Untitled Document',
    owner: owner || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  rooms.set(roomId, room);
  res.status(201).json({ room, created: true });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room });
});

// ---- AI Interaction ----

/** AI Content Assistant (In-Editor) */
app.post('/api/ai/assist', async (req, res) => {
  const { prompt, context, mode = 'doc' } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return res.status(400).json({ error: 'Gemini API key is missing.' });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    let systemPrompt = '';

    if (mode === 'code') {
      systemPrompt = `
        You are an elite Senior Software Engineer. You provide beautifully formatted technical reports in Markdown.
        
        CONTEXT OF CURRENT CODE:
        ${context || '// No code yet.'}

        USER TASK:
        ${prompt}
        
        STRUCTURE:
        1. ### 💻 Proposed Fix
           Provide the corrected code in a \`\`\`language block.
        2. ### 🔍 Diagnostic Report
           What was wrong.
        3. ### ✨ Improvements Made
           How it's better.
        
        CRITICAL: Use clean Markdown. Use bullet points and headers.
      `;
    } else {
      systemPrompt = `
        You are an expert Writing Assistant integrated into a collaborative document editor called CollabDocs.
        
        CONTEXT OF CURRENT DOCUMENT:
        ${context || 'No content yet.'}

        USER REQUEST:
        ${prompt}

        INSTRUCTIONS:
        1. If the user asks to "continue" or "write", provide a few paragraphs of high-quality content.
        2. If the user asks to "refine" or "fix", provide the corrected version.
        3. OUTPUT: Return ONLY the HTML content. No Markdown, no title tags. 
        4. Use semantic HTML (p, strong, ul, li).
      `;
    }

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    let text = response.text().trim();

    // Cleanup for documentation mode (Legacy)
    if (mode === 'doc') {
      text = text.replace(/^```html\n?/, '').replace(/\n?```$/, '');
    }

    res.json({ html: text });
  } catch (error) {
    console.error('AI Assist Error:', error);
    // Return specific error message if available (e.g., 503 Service Unavailable)
    const errorMessage = error.message || 'AI Assistant failed';
    res.status(500).json({ error: errorMessage });
  }
});

/** AI PDF Data Reconstruction */
app.post('/api/import/pdf', async (req, res) => {
  const { text } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(400).json({ error: 'Gemini API key is missing.' });
  if (!text) return res.status(400).json({ error: 'No text provided.' });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Using gemini-1.5-flash for faster response and good document parsing
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `
      You are an elite Document Reconstruction Expert. Your task is to take raw, messy text extracted from a PDF and transform it into a professional, clean, semantic HTML document. 

      RAW TEXT TO PROCESS:
      ${text}

      INSTRUCTIONS:
      1. CRITICAL: Identify the document structure: Use <h1> for the main title, <h2> for secondary headings, etc.
      2. CLEANUP: Merge broken lines into proper paragraphs (<p>).
      3. LISTS: Identify bullet points or numbered lists and use <ul>/<li> or <ol>/<li>.
      4. TABLES: If you detect tabular data, reconstruct it using standard <table>, <thead>, <tbody>, <tr>, <td>, and <th> tags.
      5. FORMATTING: Use <strong> for emphasis where appropriate.
      6. REMOVAL: Strip out page numbers, redundant header/footer repetitions, or artifacts.
      7. OUTPUT: Return ONLY the HTML as a string. Do NOT include markdown blocks (\`\`\`html) or any conversational text.
    `;

    const result = await model.generateContent(prompt);
    const resultResponse = await result.response;
    let html = resultResponse.text().trim();

    // Secondary cleanup just in case
    html = html.replace(/^```html\n?/, '').replace(/\n?```$/, '');

    res.json({ html });
  } catch (error) {
    console.error('AI Import Error:', error);
    res.status(500).json({ error: 'Failed to reconstruct document structure.' });
  }
});
;

// ---- Start Server ----
app.listen(PORT, () => {
  console.log(` Express API server running Production`);
  console.log(`   Health check: https://collabserver.onrender.com/api/health`);
});
