require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { dbHelpers } = require('./db');
const QuizManager = require('./quizManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || '9999';

// Derive or get app destination URL for QR
function getAppUrl(req) {
  if (process.env.APP_URL && process.env.APP_URL.trim() !== '') {
    return process.env.APP_URL.trim();
  }
  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}`;
  }
  return `http://localhost:${PORT}`;
}

// Session tokens for authenticated hosts
const hostSessions = new Set();

// Create QuizManager singleton
const quizManager = new QuizManager(io);

app.use(express.json());

// Serve vendor assets locally
app.use('/vendor/confetti.js', express.static(
  path.join(__dirname, '..', 'node_modules', 'canvas-confetti', 'dist', 'confetti.browser.js')
));

// Static files from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Explicit page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'quiz.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'host.html'));
});

// Team Code Validation: TEAM-001 to TEAM-100
function validateTeamCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  const regex = /^TEAM-(?:00[1-9]|0[1-9][0-9]|100)$/;
  if (regex.test(normalized)) {
    return normalized;
  }
  // Also tolerate TEAM-1 to TEAM-100 and auto-pad with zeros
  const altRegex = /^TEAM-([1-9]|[1-9][0-9]|100)$/;
  const match = normalized.match(altRegex);
  if (match) {
    const num = parseInt(match[1], 10);
    return `TEAM-${String(num).padStart(3, '0')}`;
  }
  return null;
}

// API: Dynamic QR Code
app.get('/api/qr', async (req, res) => {
  try {
    const joinUrl = getAppUrl(req);
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 8,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.json({
      success: true,
      joinUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'QR_GENERATION_FAILED' });
  }
});

// API: Participant Team Login
app.post('/api/team/login', (req, res) => {
  const { teamCode } = req.body;
  const validated = validateTeamCode(teamCode);

  if (!validated) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TEAM_CODE',
      message: 'Invalid Team ID. Please use format TEAM-001 through TEAM-100.'
    });
  }

  const team = dbHelpers.findOrCreateTeam(validated);
  res.json({
    success: true,
    team: {
      id: team.id,
      teamCode: team.team_code
    }
  });
});

// API: Host Authentication
app.post('/api/host/login', (req, res) => {
  const { password } = req.body;
  if (!password || String(password).trim() !== String(HOST_PASSWORD).trim()) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_PASSWORD',
      message: 'Access denied. Incorrect Host Event Key.'
    });
  }

  const token = crypto.randomBytes(32).toString('hex');
  hostSessions.add(token);
  res.json({
    success: true,
    token
  });
});

// Host Auth Middleware for Socket & API
function isHostAuthenticated(token) {
  return token && hostSessions.has(token);
}

// Socket.io Real-time Communication
io.on('connection', (socket) => {
  let authenticatedHost = false;
  let registeredTeamCode = null;
  let registeredTeamId = null;

  // Participant Registration / State Request
  socket.on('participant_join', (data, callback) => {
    try {
      const { teamCode } = data || {};
      const validated = validateTeamCode(teamCode);
      if (!validated) {
        if (callback) callback({ error: 'INVALID_TEAM_CODE' });
        return;
      }

      const team = dbHelpers.findOrCreateTeam(validated);
      registeredTeamCode = team.team_code;
      registeredTeamId = team.id;
      socket.teamId = team.id;
      socket.teamCode = team.team_code;
      socket.join('participant_room');

      quizManager.registerTeamConnection(socket.id, registeredTeamCode);

      const payload = quizManager.getParticipantPayload(team.id);
      if (callback) callback({ success: true, payload });
      else socket.emit('quiz_state_change', payload);
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Participant Answer Submission
  socket.on('submit_answer', (data, callback) => {
    try {
      const { selectedOption, teamCode } = data || {};
      const activeCode = registeredTeamCode || validateTeamCode(teamCode);

      if (!activeCode) {
        if (callback) callback({ error: 'UNAUTHORIZED_TEAM', message: 'Team ID required.' });
        return;
      }

      const result = quizManager.submitAnswer({
        teamCode: activeCode,
        selectedOption
      });

      if (callback) callback({ success: true, result });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Authentication on Socket
  socket.on('host_auth', (data, callback) => {
    const { token, password } = data || {};
    if (isHostAuthenticated(token) || (password && String(password).trim() === String(HOST_PASSWORD).trim())) {
      authenticatedHost = true;
      socket.join('host_room');
      let sessionToken = token;
      if (!isHostAuthenticated(token)) {
        sessionToken = crypto.randomBytes(32).toString('hex');
        hostSessions.add(sessionToken);
      }
      const payload = quizManager.getHostPayload();
      if (callback) callback({ success: true, token: sessionToken, payload });
      else socket.emit('quiz_state_change', payload);
    } else {
      if (callback) callback({ success: false, error: 'AUTH_FAILED' });
    }
  });

  // Host Action: START QUIZ
  socket.on('host_start_quiz', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const payload = quizManager.startQuiz();
      if (callback) callback({ success: true, payload });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Action: REVEAL QUESTION
  socket.on('host_reveal_question', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const payload = quizManager.revealQuestion();
      if (callback) callback({ success: true, payload });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Action: REVEAL ANSWER
  socket.on('host_reveal_answer', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const payload = quizManager.revealAnswer();
      if (callback) callback({ success: true, payload });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Action: CHECK WINNER
  socket.on('host_check_winner', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const payload = quizManager.checkWinner();
      if (callback) callback({ success: true, payload });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Action: NEXT QUESTION
  socket.on('host_next_question', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const payload = quizManager.nextQuestion();
      if (callback) callback({ success: true, payload });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Action: CLOSE POLLING EARLY
  socket.on('host_close_polling', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      quizManager.closePolling();
      if (callback) callback({ success: true, payload: quizManager.getHostPayload() });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Host Action: RESET QUIZ
  socket.on('host_reset_quiz', (data, callback) => {
    if (!authenticatedHost) {
      if (callback) callback({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const payload = quizManager.resetQuiz();
      if (callback) callback({ success: true, payload });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    if (registeredTeamCode) {
      quizManager.unregisterTeamConnection(socket.id);
    }
  });
});

// Start server if run directly
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(` TECHSPARDHA 2K26 — VIBE QUIZ`);
    console.log(` Server running at http://localhost:${PORT}`);
    console.log(` Host interface at http://localhost:${PORT}/host (Password: ${HOST_PASSWORD})`);
    console.log(`==================================================\n`);
  });
}

module.exports = { app, server, quizManager };
