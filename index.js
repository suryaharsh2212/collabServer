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
  const { html, title } = req.body;
  if (!html) {
    return res.status(400).json({ error: 'HTML content is required' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // needed for deployment environments like Render
    });
    
    // Create full HTML document to render
    const fullHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${title || 'CollabDocs Export'}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #1a1a1a; }
          pre { background: #f5f5f5; padding: 1rem; border-radius: 8px; overflow-x: auto; font-family: monospace; }
          code { background: #f0f0f0; padding: 0.15rem 0.3rem; border-radius: 3px; font-family: monospace; }
          blockquote { border-left: 3px solid #6366f1; padding-left: 1rem; color: #666; font-style: italic; }
          h1, h2, h3 { margin-top: 1.5rem; margin-bottom: 0.5rem; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;

    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: 'domcontentloaded' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
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
  const { prompt, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return res.status(400).json({ error: 'Gemini API key is missing.' });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
     const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview" 
    });

    const systemPrompt = `
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

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    let html = response.text().trim();
    html = html.replace(/^```html\n?/, '').replace(/\n?```$/, '');
    
    res.json({ html });
  } catch (error) {
    console.error('AI Assist Error:', error);
    // Return specific error message if available (e.g., 503 Service Unavailable)
    const errorMessage = error.message || 'AI Assistant failed';
    res.status(500).json({ error: errorMessage });
  }
});
;

// ---- Start Server ----
app.listen(PORT, () => {
  console.log(` Express API server running Production`);
  console.log(`   Health check: https://collabserver.onrender.com/api/health`);
});
