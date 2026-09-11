const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'quiz.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize Tables
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_code TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_order INTEGER UNIQUE NOT NULL,
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      question_id INTEGER NOT NULL REFERENCES questions(id),
      selected_option TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      response_time_ms INTEGER NOT NULL DEFAULT 0,
      UNIQUE(team_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_question_index INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'WAITING',
      question_revealed_at INTEGER DEFAULT NULL,
      polling_closes_at INTEGER DEFAULT NULL,
      correct_answer_revealed INTEGER NOT NULL DEFAULT 0,
      winner_revealed INTEGER NOT NULL DEFAULT 0,
      quiz_completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS question_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER UNIQUE NOT NULL REFERENCES questions(id),
      winner_team_code TEXT DEFAULT NULL,
      winner_submitted_at INTEGER DEFAULT NULL,
      winner_time_formatted TEXT DEFAULT NULL,
      correct_submissions_count INTEGER NOT NULL DEFAULT 0,
      total_submissions_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Ensure singleton state exists
  const existingState = db.prepare('SELECT * FROM quiz_state WHERE id = 1').get();
  if (!existingState) {
    db.prepare(`
      INSERT INTO quiz_state (
        id, current_question_index, state, question_revealed_at, 
        polling_closes_at, correct_answer_revealed, winner_revealed, quiz_completed
      ) VALUES (1, 0, 'WAITING', NULL, NULL, 0, 0, 0)
    `).run();
  }

  seedQuestions();
}

const INITIAL_QUESTIONS = [
  {
    order: 1,
    question: "Why does Google have an \"I'm Feeling Lucky\" button?",
    a: "It opens a random website",
    b: "It takes you directly to the top search result",
    c: "It searches without keywords",
    d: "It shows the most popular searches",
    correct: "B"
  },
  {
    order: 2,
    question: "Why does your laptop charger brick often get warm?",
    a: "It stores excess electricity",
    b: "Some electrical energy is converted into heat",
    c: "The battery sends heat back to the charger",
    d: "It deliberately heats itself to charge faster",
    correct: "B"
  },
  {
    order: 3,
    question: "What helps your phone recognize the orientation of a QR code?",
    a: "The tiny dots in the center",
    b: "The three large squares near the corners",
    c: "The white border",
    d: "The middle of the code",
    correct: "B"
  },
  {
    order: 4,
    question: "Which company famously started as a DVD-by-mail service?",
    a: "Amazon",
    b: "Netflix",
    c: "Hulu",
    d: "Spotify",
    correct: "B"
  },
  {
    order: 5,
    question: "The name \"Bluetooth\" was inspired by:",
    a: "The blue color of early wireless chips",
    b: "A medieval Scandinavian king",
    c: "A military communication system",
    d: "The shape of the original antenna",
    correct: "B"
  },
  {
    order: 6,
    question: "What was the first video uploaded to YouTube mainly about?",
    a: "A music performance",
    b: "A person visiting a zoo",
    c: "A computer tutorial",
    d: "A video game",
    correct: "B"
  },
  {
    order: 7,
    question: "What does \"Wi-Fi\" actually stand for?",
    a: "Wireless Internet",
    b: "Wireless Fidelity",
    c: "Wide-Frequency Internet",
    d: "Nothing specific",
    correct: "D"
  },
  {
    order: 8,
    question: "What was Google's original name?",
    a: "SearchBox",
    b: "BackRub",
    c: "PageRank",
    d: "Googol",
    correct: "B"
  },
  {
    order: 9,
    question: "The famous term \"computer bug\" became associated with a real incident involving:",
    a: "A spider",
    b: "A moth",
    c: "A cockroach",
    d: "A beetle",
    correct: "B"
  },
  {
    order: 10,
    question: "Which of these came first?",
    a: "The first iPhone",
    b: "Google Maps",
    c: "YouTube",
    d: "Facebook",
    correct: "D"
  },
  {
    order: 11,
    question: "Why do keyboards have a raised bump on the F and J keys?",
    a: "To make the keys easier to find without looking",
    b: "To indicate the most frequently used letters",
    c: "To prevent accidental key presses",
    d: "To help the keyboard detect fingerprints",
    correct: "A"
  },
  {
    order: 12,
    question: "Which company was originally known for selling books online?",
    a: "Amazon",
    b: "eBay",
    c: "Netflix",
    d: "Google",
    correct: "A"
  },
  {
    order: 13,
    question: "Which of these is closest to what a QR code actually stores?",
    a: "A photograph",
    b: "A small amount of encoded information",
    c: "A live internet connection",
    d: "A GPS location",
    correct: "B"
  },
  {
    order: 14,
    question: "Which of these was originally developed for tracking parts in automobile manufacturing?",
    a: "Bluetooth",
    b: "QR codes",
    c: "Wi-Fi",
    d: "NFC",
    correct: "B"
  },
  {
    order: 15,
    question: "Which company started as an online auction marketplace?",
    a: "eBay",
    b: "Spotify",
    c: "Netflix",
    d: "Yahoo",
    correct: "A"
  }
];

function seedQuestions() {
  const count = db.prepare('SELECT COUNT(*) as count FROM questions').get().count;
  if (count === 0) {
    const insertStmt = db.prepare(`
      INSERT INTO questions (
        question_order, question_text, option_a, option_b, option_c, option_d, correct_option
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const q of INITIAL_QUESTIONS) {
      insertStmt.run(q.order, q.question, q.a, q.b, q.c, q.d, q.correct);
    }
  }
}

// Database helper functions
const dbHelpers = {
  // Teams
  findOrCreateTeam(teamCode) {
    const existing = db.prepare('SELECT * FROM teams WHERE team_code = ?').get(teamCode);
    if (existing) return existing;
    const now = Date.now();
    const result = db.prepare('INSERT INTO teams (team_code, created_at) VALUES (?, ?)').run(teamCode, now);
    return { id: Number(result.lastInsertRowid), team_code: teamCode, created_at: now };
  },

  getTeamByCode(teamCode) {
    return db.prepare('SELECT * FROM teams WHERE team_code = ?').get(teamCode);
  },

  getAllTeams() {
    return db.prepare('SELECT * FROM teams ORDER BY team_code ASC').all();
  },

  getTeamsCount() {
    return db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
  },

  unregisterTeam(teamCode) {
    const team = db.prepare('SELECT id, team_code FROM teams WHERE team_code = ?').get(teamCode);
    if (!team) return null;
    db.prepare('DELETE FROM submissions WHERE team_id = ?').run(team.id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
    return team;
  },

  unregisterAllTeams() {
    db.prepare('DELETE FROM submissions').run();
    const result = db.prepare('DELETE FROM teams').run();
    return result.changes;
  },

  getAllTeamsWithStats() {
    return db.prepare(`
      SELECT 
        t.id, 
        t.team_code, 
        t.created_at,
        COUNT(s.id) as submissions_count,
        COALESCE(SUM(s.is_correct), 0) as total_points
      FROM teams t
      LEFT JOIN submissions s ON t.id = s.team_id
      GROUP BY t.id
      ORDER BY t.team_code ASC
    `).all();
  },

  // Questions
  getQuestions() {
    return db.prepare('SELECT * FROM questions ORDER BY question_order ASC').all();
  },

  getQuestionByOrder(order) {
    return db.prepare('SELECT * FROM questions WHERE question_order = ?').get(order);
  },

  getQuestionById(id) {
    return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  },

  // Quiz State
  getState() {
    return db.prepare('SELECT * FROM quiz_state WHERE id = 1').get();
  },

  updateState(fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.getState();
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    db.prepare(`UPDATE quiz_state SET ${setClause} WHERE id = 1`).run(...values);
    return this.getState();
  },

  resetQuiz() {
    db.exec('DELETE FROM submissions;');
    db.exec('DELETE FROM question_results;');
    db.prepare(`
      UPDATE quiz_state SET
        current_question_index = 0,
        state = 'WAITING',
        question_revealed_at = NULL,
        polling_closes_at = NULL,
        correct_answer_revealed = 0,
        winner_revealed = 0,
        quiz_completed = 0
      WHERE id = 1
    `).run();
    return this.getState();
  },

  // Submissions
  createSubmission({ teamId, questionId, selectedOption, submittedAt, isCorrect, responseTimeMs }) {
    const result = db.prepare(`
      INSERT INTO submissions (
        team_id, question_id, selected_option, submitted_at, is_correct, response_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(teamId, questionId, selectedOption, submittedAt, isCorrect ? 1 : 0, responseTimeMs);
    return {
      id: Number(result.lastInsertRowid),
      team_id: teamId,
      question_id: questionId,
      selected_option: selectedOption,
      submitted_at: submittedAt,
      is_correct: isCorrect ? 1 : 0,
      response_time_ms: responseTimeMs
    };
  },

  getTeamSubmissionForQuestion(teamId, questionId) {
    return db.prepare(`
      SELECT * FROM submissions 
      WHERE team_id = ? AND question_id = ?
    `).get(teamId, questionId);
  },

  getSubmissionsForQuestion(questionId) {
    return db.prepare(`
      SELECT s.*, t.team_code 
      FROM submissions s
      JOIN teams t ON s.team_id = t.id
      WHERE s.question_id = ?
      ORDER BY s.submitted_at ASC
    `).all(questionId);
  },

  getCorrectSubmissionsForQuestion(questionId) {
    return db.prepare(`
      SELECT s.*, t.team_code 
      FROM submissions s
      JOIN teams t ON s.team_id = t.id
      WHERE s.question_id = ? AND s.is_correct = 1
      ORDER BY s.submitted_at ASC
    `).all(questionId);
  },

  // Question Results
  saveQuestionResult({ questionId, winnerTeamCode, winnerSubmittedAt, winnerTimeFormatted, correctCount, totalCount }) {
    db.prepare(`
      INSERT INTO question_results (
        question_id, winner_team_code, winner_submitted_at, winner_time_formatted,
        correct_submissions_count, total_submissions_count
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(question_id) DO UPDATE SET
        winner_team_code = excluded.winner_team_code,
        winner_submitted_at = excluded.winner_submitted_at,
        winner_time_formatted = excluded.winner_time_formatted,
        correct_submissions_count = excluded.correct_submissions_count,
        total_submissions_count = excluded.total_submissions_count
    `).run(questionId, winnerTeamCode, winnerSubmittedAt, winnerTimeFormatted, correctCount, totalCount);
  },

  getAllQuestionResults() {
    return db.prepare(`
      SELECT qr.*, q.question_order, q.question_text
      FROM question_results qr
      JOIN questions q ON qr.question_id = q.id
      ORDER BY q.question_order ASC
    `).all();
  },

  // Cumulative Leaderboard
  getCumulativeLeaderboard() {
    return db.prepare(`
      SELECT 
        t.team_code,
        COUNT(CASE WHEN s.is_correct = 1 THEN 1 END) as points,
        COUNT(s.id) as total_answered,
        MIN(CASE WHEN qr.winner_team_code = t.team_code THEN qr.question_id END) as first_win_question,
        COUNT(CASE WHEN qr.winner_team_code = t.team_code THEN 1 END) as round_wins
      FROM teams t
      LEFT JOIN submissions s ON t.id = s.team_id
      LEFT JOIN question_results qr ON qr.winner_team_code = t.team_code
      GROUP BY t.id, t.team_code
      ORDER BY points DESC, round_wins DESC, t.team_code ASC
    `).all();
  }
};

// Initialize schema on load
initSchema();

module.exports = {
  db,
  dbHelpers
};
