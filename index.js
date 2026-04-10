/**
 * index.js — Express API Server + Puppeteer PDF export
 */
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION!  Shutting down...');
  console.error(err.name, err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION!  Shutting down...');
  console.error(err.name, err.message);
  process.exit(1);
});


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

// ---- Email Invitation System ----

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_USER,
    pass: process.env.ZOHO_PASS,
  },
});

// Verify connection configuration on startup
transporter.verify(function (error, success) {
  if (error) {
    console.error('SMTP Connection Error:', error);
  } else {
    console.log('Server is ready to send invitations');
  }
});


app.post('/api/invite', async (req, res) => {
  const { email, inviteLink, docTitle, isCode, senderName } = req.body;


  if (!email || !inviteLink) {
    return res.status(400).json({ error: 'Email and invite link are required' });
  }

  const mailOptions = {
    from: `"CollabDocs" <${process.env.ZOHO_USER}>`,
    to: email,
    subject: `${senderName || 'A colleague'} invited you to ${isCode ? 'code' : 'collaborate'}: ${docTitle || 'Untitled Session'}`,
    text: `Hello! ${senderName || 'A colleague'} has invited you to ${isCode ? 'code live' : 'collaborate'} on "${docTitle || 'Untitled Session'}" at CollabDocs. Use this link to join the session: ${inviteLink}`,
    html: isCode ? `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CollabDocs Code Invitation</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'JetBrains Mono', 'Fira Code', monospace; -webkit-font-smoothing: antialiased;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #1e293b; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155;">
                <!-- Header -->
                <tr>
                  <td align="center" style="padding: 40px; background-color: #0f172a;">
                    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); width: 56px; height: 56px; border-radius: 16px; display: inline-block; margin-bottom: 15px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="padding: 14px; box-sizing: border-box;">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                      </svg>
                    </div>
                    <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -1px; font-family: sans-serif;">CollabDocs // Code</h1>

                  </td>
                </tr>
                <!-- Body -->
                <tr>
                  <td style="padding: 40px 50px;">
                    <p style="color: #10b981; font-weight: 700; font-size: 14px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 2px;">Incoming Session Invite</p>
                    <h2 style="color: #ffffff; margin: 0 0 20px 0; font-size: 20px; font-weight: 600; font-family: sans-serif;">${senderName || 'A colleague'} wants to code with you.</h2>
                    <p style="color: #94a3b8; line-height: 1.6; font-size: 15px; margin-bottom: 30px;">
                      You have been invited to a live pair-programming session. Connect now to sync your workspace and collaborate on code in real-time.
                    </p>
                    
                    <div style="background-color: #0f172a; border-left: 4px solid #10b981; padding: 20px; margin-bottom: 35px; border-radius: 0 8px 8px 0;">
                      <p style="margin: 0; font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">Project Identifier</p>
                      <p style="margin: 8px 0 0 0; font-size: 17px; color: #10b981; font-weight: 700; font-family: monospace;">> ${docTitle || 'Untitled Snippet'}</p>
                    </div>
                    
                    <div style="text-align: center;">
                      <a href="${inviteLink}" style="background-color: #10b981; color: #ffffff; padding: 18px 35px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block; font-family: sans-serif; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.25);">Connect to Session</a>
                    </div>
                  </td>
                </tr>
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 50px; background-color: #0f172a; border-top: 1px solid #334155; text-align: center;">
                    <p style="color: #475569; font-size: 11px; margin: 0; font-family: monospace;">
                      &copy; 2024 CollabDocs The Developer Workspace.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    ` : `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CollabDocs Invitation</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e1e8ed;">
                <!-- Header -->
                <tr>
                  <td align="center" style="padding: 40px 40px 20px 40px; background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);">
                    <div style="background: rgba(255,255,255,0.2); width: 48px; height: 48px; border-radius: 12px; display: inline-block; margin-bottom: 15px;">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="padding: 10px; box-sizing: border-box;">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                      </svg>
                    </div>
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">CollabDocs</h1>
                    <p style="color: rgba(255,255,255,0.8); margin-top: 10px; font-size: 14px; font-weight: 500;">Premium Real-Time Collaboration</p>
                  </td>
                </tr>
                <!-- Body -->
                <tr>
                  <td style="padding: 40px 50px;">
                    <h2 style="color: #1a1a1a; margin: 0 0 20px 0; font-size: 22px; font-weight: 700;">You're Invited!</h2>
                    <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin-bottom: 30px;">
                      Hello,<br><br>
                      <strong>${senderName || 'A colleague'}</strong> has invited you to collaborate on a session at CollabDocs. You can now view and edit the document in real-time with other contributors.
                    </p>
                    
                    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 35px;">
                      <p style="margin: 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Session Title</p>
                      <p style="margin: 5px 0 0 0; font-size: 18px; color: #111827; font-weight: 700;">${docTitle || 'Untitled Session'}</p>
                    </div>
                    
                    <div style="text-align: center;">
                      <a href="${inviteLink}" style="background-color: #6366f1; color: #ffffff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">Join Collaboration Room</a>
                    </div>
                    
                    <p style="color: #9ca3af; font-size: 13px; line-height: 1.6; margin-top: 40px; text-align: center;">
                      If you're having trouble clicking the button, copy and paste the URL below into your web browser:<br>
                      <a href="${inviteLink}" style="color: #6366f1; word-break: break-all;">${inviteLink}</a>
                    </p>
                  </td>
                </tr>
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 50px; background-color: #f8fafc; border-top: 1px solid #e1e8ed; text-align: center;">
                    <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                      &copy; 2024 CollabDocs Engineering Team. <br>
                      Built for developers and writers who value real-time precision.
                    </p>
                  </td>
                </tr>
              </table>
              <table border="0" cellpadding="0" cellspacing="0" width="600">
                <tr>
                   <td align="center" style="padding: 20px 0; color: #cbd5e1; font-size: 11px;">
                      Sent via CollabDocs Automated Invitation System
                   </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  };




  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send invitation. Please check configuration.' });
  }
});


// ---- Universal Code Runner ----

const CODAPI_SANDBOX_MAP = {
  'javascript': 'javascript',
  'typescript': 'typescript',
  'python': 'python',
  'java': 'java',
  'cpp': 'cpp',
};

// Simple In-Memory Rate Limiting
const executionRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

app.post('/api/execute', async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  
  // Clean up old entries
  if (executionRateLimit.has(ip)) {
    const data = executionRateLimit.get(ip);
    if (now - data.startTime > RATE_LIMIT_WINDOW) {
      executionRateLimit.set(ip, { count: 1, startTime: now });
    } else if (data.count >= MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ 
        error: 'Too many executions. Please Wait a minute to preserve our trial limits.' 
      });
    } else {
      data.count++;
    }
  } else {
    executionRateLimit.set(ip, { count: 1, startTime: now });
  }

  const { language, code } = req.body;


  if (!language || !code) {
    return res.status(400).json({ error: 'Language and code are required' });
  }

  const sandbox = CODAPI_SANDBOX_MAP[language];
  if (!sandbox) {
    return res.status(400).json({ error: `Language '${language}' is not supported yet.` });
  }

  try {
    const response = await fetch('https://api.codapi.org/v1/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sandbox: sandbox,
        command: "run",
        files: {
          "": code
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Execution Engine Error');
    }

    // Standardize the response for the CollabDocs frontend
    res.json({
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      output: (data.stdout || '') + (data.stderr || ''),
      code: data.exit_code,
      version: 'Codapi Sandbox'
    });

  } catch (error) {
    console.error('Execution Error:', error);
    res.status(500).json({ error: 'Failed to execute code. Please try again later.' });
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
