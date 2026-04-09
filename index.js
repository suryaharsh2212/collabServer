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
        ${title ? `<h1 style="text-align: center; border-bottom: 1px solid #ccc; padding-bottom: 10px;">${title}</h1>` : ''}
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

// ---- AI Template Generation ----

app.post('/api/ai/generate-blueprint', async (req, res) => {
  const { prompt } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    return res.status(400).json({ 
      error: 'Gemini API key is missing or invalid in server/index.js .env file.' 
    });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemPrompt = `
      You are an expert Technical Architect and Product Manager.
      User Goal: ${prompt}

      TASK: Generate a high-fidelity, collaborative document structure in clean HTML5.
      
      REQUIREMENTS:
      1. TONE: Professional, structured, and action-oriented.
      2. FORMAT: 
         - Use <h1> for the main title.
         - Use <h2> for major sections (e.g., Objective, Roadmap, Technical Stack).
         - Use <blockquote> for high-level summaries or abstracts.
         - Use <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Action Item</p></li></ul> for checklists.
         - Use <table> with <thead> for data, timelines, or status tracking.
      3. OUTPUT: Return ONLY the HTML body content. No Markdown, no <html>/<body> tags.

      Focus on the specific context of "${prompt}". If it's a meeting, include agendas and attendees. If it's technical, include architecture and code blocks.
    `;

    try {
      const result = await model.generateContent(systemPrompt);
      const response = await result.response;
      let html = response.text().trim();
      html = html.replace(/^```html\n?/, '').replace(/\n?```$/, '');
      const titleMatch = html.match(/<h1>(.*?)<\/h1>/);
      const title = titleMatch ? titleMatch[1] : `AI: ${prompt}`;
      res.json({ title, html });
    } catch (aiErr) {
      console.warn('AI Quota hit, using Smart Fallback for:', prompt);
      
      // SMART FALLBACK LOGIC
      const p = prompt.toLowerCase();
      let fallbackHtml = '';
      let fallbackTitle = `Blueprint: ${prompt}`;

      if (p.includes('meeting') || p.includes('notes') || p.includes('call')) {
        fallbackHtml = `
          <h1>Meeting Notes: ${prompt}</h1>
          <p> <em>[Drafted via Smart Fallback]</em></p>
          <blockquote><strong>Facilitator:</strong> [Name] | <strong>Date:</strong> ${new Date().toLocaleDateString()}</blockquote>
          <h2>Agenda Items</h2><ul><li>Item 1</li><li>Item 2</li></ul>
          <hr />
          <h2>Decision Log</h2><p>Notes on key decisions made during the session...</p>
          <h2>Action Items</h2>
          <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Review decisions with team</p></li><li data-type="taskItem" data-checked="false"><p>Update stakeholders</p></li></ul>
        `;
      } else if (p.includes('api') || p.includes('doc') || p.includes('technical')) {
        fallbackHtml = `
          <h1>Technical Design: ${prompt}</h1>
          <p> <em>[Drafted via Smart Fallback]</em></p>
          <blockquote>Overview of the technical approach, architecture, and system design.</blockquote>
          <h2>Architecture</h2><pre><code>[Client] <-> [API Gateway] <-> [Service] <-> [DB]</code></pre>
          <h2>API Specification</h2>
          <table><thead><tr><th>Endpoint</th><th>Method</th><th>Description</th></tr></thead><tbody><tr><td>/api/v1/health</td><td>GET</td><td>Check service status</td></tr></tbody></table>
        `;
      } else if (p.includes('school') || p.includes('instruction') || p.includes('curriculum') || p.includes('lesson')) {
        fallbackHtml = `
          <h1>Instructional Plan: ${prompt}</h1>
          <p> <em>[Drafted via Smart Fallback]</em></p>
          <blockquote><strong>Subject:</strong> ${prompt} | <strong>Target Audience:</strong> Students/Trainees</blockquote>
          <h2>Module 1: Introduction & Fundamentals</h2>
          <ul><li>Learning Objectives</li><li>Key Terminology</li><li>Initial Assessment</li></ul>
          <h2>Module 2: Core Skills Development</h2>
          <p>Walkthrough of the practical steps and techniques required...</p>
          <h2>Student Milestones</h2>
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false"><p>Complete theory session</p></li>
            <li data-type="taskItem" data-checked="false"><p>Pass practical evaluation</p></li>
          </ul>
        `;
      } else {
        fallbackHtml = `
          <h1>Project Blueprint: ${prompt}</h1>
          <p> <em>[Drafted via Smart Fallback]</em></p>
          <blockquote>Objective: To define and execute the successful delivery of ${prompt}.</blockquote>
          <h2>Project Goals</h2><ul><li>Primary Objective</li><li>Success Metric</li></ul>
          <h2>Roadmap</h2>
          <table><thead><tr><th>Phase</th><th>Deliverable</th><th>Status</th></tr></thead><tbody><tr><td>Q1</td><td>Foundation & Setup</td><td>Planned</td></tr></tbody></table>
          <h2>Immediate Tasks</h2>
          <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Establish project team</p></li></ul>
        `;
      }
      res.json({ title: fallbackTitle, html: fallbackHtml });
    }
  } catch (error) {
    console.error('AI Service Error:', error);
    res.status(500).json({ error: 'Failed to initialize AI service' });
  }
});

// ---- Start Server ----
app.listen(PORT, () => {
  console.log(` Express API server running Production`);
  console.log(`   Health check: https://collabserver.onrender.com/api/health`);
});
