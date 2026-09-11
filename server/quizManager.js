const { dbHelpers } = require('./db');

class QuizManager {
  constructor(io) {
    this.io = io;
    this.timerInterval = null;
    this.connectedTeams = new Map(); // socketId -> teamCode
    this.initFromDb();
  }

  initFromDb() {
    const state = dbHelpers.getState();
    // If server restarted while POLLING_ACTIVE, check if timer expired
    if (state.state === 'POLLING_ACTIVE' && state.polling_closes_at) {
      if (Date.now() >= state.polling_closes_at) {
        dbHelpers.updateState({ state: 'POLLING_CLOSED' });
      } else {
        this.startTimer(state.polling_closes_at);
      }
    }
  }

  // Socket connection tracking
  registerTeamConnection(socketId, teamCode) {
    this.connectedTeams.set(socketId, teamCode);
    this.broadcastTeamsCount();
  }

  unregisterTeamConnection(socketId) {
    this.connectedTeams.delete(socketId);
    this.broadcastTeamsCount();
  }

  getConnectedTeamsCount() {
    // Unique team codes currently connected
    const uniqueCodes = new Set(this.connectedTeams.values());
    return uniqueCodes.size;
  }

  broadcastTeamsCount() {
    const count = this.getConnectedTeamsCount();
    const registeredCount = dbHelpers.getTeamsCount();
    this.io.emit('teams_count_update', {
      connectedCount: count,
      registeredCount: registeredCount
    });
  }

  // Formats server timestamp into localized time string: "8:41:22 PM"
  formatTimestamp(epochMs) {
    const date = new Date(epochMs);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  // Get current state snapshot
  getCurrentState() {
    const state = dbHelpers.getState();
    const questions = dbHelpers.getQuestions();
    const currentQuestion = questions[state.current_question_index] || null;

    return {
      state: state.state,
      currentQuestionIndex: state.current_question_index,
      totalQuestions: questions.length,
      questionRevealedAt: state.question_revealed_at,
      pollingClosesAt: state.polling_closes_at,
      correctAnswerRevealed: Boolean(state.correct_answer_revealed),
      winnerRevealed: Boolean(state.winner_revealed),
      quizCompleted: Boolean(state.quiz_completed),
      currentQuestion: currentQuestion
    };
  }

  // Safe question payload for participants (STRICTLY OMIT correct_option)
  getParticipantPayload(teamId = null) {
    const stateInfo = this.getCurrentState();
    const payload = {
      state: stateInfo.state,
      currentQuestionIndex: stateInfo.currentQuestionIndex,
      totalQuestions: stateInfo.totalQuestions,
      pollingClosesAt: stateInfo.pollingClosesAt,
      serverTime: Date.now(),
      connectedTeamsCount: this.getConnectedTeamsCount()
    };

    if (stateInfo.state === 'WAITING') {
      payload.message = 'WAITING FOR QUIZ TO START';
      return payload;
    }

    if (stateInfo.state === 'QUESTION_PREPARED') {
      payload.message = 'WAITING FOR QUESTION';
      return payload;
    }

    if (stateInfo.currentQuestion) {
      payload.question = {
        order: stateInfo.currentQuestion.question_order,
        text: stateInfo.currentQuestion.question_text,
        option_a: stateInfo.currentQuestion.option_a,
        option_b: stateInfo.currentQuestion.option_b,
        option_c: stateInfo.currentQuestion.option_c,
        option_d: stateInfo.currentQuestion.option_d
      };

      // Only reveal correct_option if state is ANSWER_REVEALED or later
      if (stateInfo.correctAnswerRevealed) {
        payload.correctOption = stateInfo.currentQuestion.correct_option;
      }
    }

    // Include team's own submission if teamId provided
    if (teamId && stateInfo.currentQuestion) {
      const submission = dbHelpers.getTeamSubmissionForQuestion(teamId, stateInfo.currentQuestion.id);
      if (submission) {
        payload.userSubmission = {
          selectedOption: submission.selected_option,
          submittedAt: submission.submitted_at,
          timeFormatted: this.formatTimestamp(submission.submitted_at)
        };
      }
    }

    // If winner revealed, include winner info
    if (stateInfo.winnerRevealed && stateInfo.currentQuestion) {
      payload.winnerInfo = this.getWinnerForQuestion(stateInfo.currentQuestion.id);
    }

    // If quiz completed, include final leaderboard
    if (stateInfo.state === 'QUIZ_COMPLETE') {
      payload.finalLeaderboard = dbHelpers.getCumulativeLeaderboard();
    }

    return payload;
  }

  // Host payload (includes admin fields, submission counts, correct answer)
  getHostPayload() {
    const stateInfo = this.getCurrentState();
    const payload = {
      ...stateInfo,
      serverTime: Date.now(),
      connectedTeamsCount: this.getConnectedTeamsCount(),
      registeredTeamsCount: dbHelpers.getTeamsCount(),
      history: dbHelpers.getAllQuestionResults()
    };

    if (stateInfo.currentQuestion) {
      const submissions = dbHelpers.getSubmissionsForQuestion(stateInfo.currentQuestion.id);
      payload.submissionsCount = submissions.length;
      payload.submissions = submissions.map(s => ({
        teamCode: s.team_code,
        selectedOption: s.selected_option,
        submittedAt: s.submitted_at,
        timeFormatted: this.formatTimestamp(s.submitted_at),
        isCorrect: Boolean(s.is_correct),
        responseTimeMs: s.response_time_ms
      }));

      if (stateInfo.winnerRevealed) {
        payload.winnerInfo = this.getWinnerForQuestion(stateInfo.currentQuestion.id);
      }
    }

    if (stateInfo.state === 'QUIZ_COMPLETE') {
      payload.finalLeaderboard = dbHelpers.getCumulativeLeaderboard();
    }

    return payload;
  }

  // Timer logic
  startTimer(pollingClosesAt) {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const now = Date.now();
      const remainingMs = Math.max(0, pollingClosesAt - now);
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      this.io.emit('timer_tick', {
        remainingSeconds,
        remainingMs,
        serverTime: now,
        pollingClosesAt
      });

      if (remainingMs <= 0) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.closePolling();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // FSM Action: START QUIZ (from WAITING -> QUESTION_PREPARED)
  startQuiz() {
    const state = dbHelpers.getState();
    if (state.state !== 'WAITING') {
      throw new Error(`Cannot start quiz from state ${state.state}`);
    }

    dbHelpers.updateState({
      state: 'QUESTION_PREPARED',
      current_question_index: 0,
      question_revealed_at: null,
      polling_closes_at: null,
      correct_answer_revealed: 0,
      winner_revealed: 0,
      quiz_completed: 0
    });

    this.broadcastStateChange();
    return this.getHostPayload();
  }

  // FSM Action: REVEAL QUESTION (from QUESTION_PREPARED -> POLLING_ACTIVE)
  revealQuestion() {
    const state = dbHelpers.getState();
    if (state.state !== 'QUESTION_PREPARED') {
      throw new Error(`Cannot reveal question from state ${state.state}`);
    }

    const now = Date.now();
    const durationMs = 60 * 1000; // 60 seconds
    const pollingClosesAt = now + durationMs;

    dbHelpers.updateState({
      state: 'POLLING_ACTIVE',
      question_revealed_at: now,
      polling_closes_at: pollingClosesAt,
      correct_answer_revealed: 0,
      winner_revealed: 0
    });

    this.startTimer(pollingClosesAt);
    this.broadcastStateChange();
    return this.getHostPayload();
  }

  // FSM Action: CLOSE POLLING (POLLING_ACTIVE -> POLLING_CLOSED)
  closePolling() {
    const state = dbHelpers.getState();
    if (state.state !== 'POLLING_ACTIVE') return;

    this.stopTimer();

    dbHelpers.updateState({
      state: 'POLLING_CLOSED'
    });

    this.broadcastStateChange();
  }

  // FSM Action: REVEAL ANSWER (POLLING_CLOSED -> ANSWER_REVEALED)
  revealAnswer() {
    const state = dbHelpers.getState();
    if (state.state !== 'POLLING_CLOSED') {
      throw new Error(`Cannot reveal answer before polling has closed. Current state: ${state.state}`);
    }

    dbHelpers.updateState({
      state: 'ANSWER_REVEALED',
      correct_answer_revealed: 1
    });

    this.broadcastStateChange();
    return this.getHostPayload();
  }

  // FSM Action: CHECK WINNER (ANSWER_REVEALED -> WINNER_CHECKED)
  checkWinner() {
    const state = dbHelpers.getState();
    if (state.state !== 'ANSWER_REVEALED') {
      throw new Error(`Cannot check winner before answer is revealed. Current state: ${state.state}`);
    }

    const questions = dbHelpers.getQuestions();
    const currentQ = questions[state.current_question_index];
    if (!currentQ) throw new Error('No current question found');

    const winnerInfo = this.getWinnerForQuestion(currentQ.id);

    // Record result in question_results table
    const allSubmissions = dbHelpers.getSubmissionsForQuestion(currentQ.id);
    dbHelpers.saveQuestionResult({
      questionId: currentQ.id,
      winnerTeamCode: winnerInfo.hasWinner ? winnerInfo.winner.teamCode : null,
      winnerSubmittedAt: winnerInfo.hasWinner ? winnerInfo.winner.submittedAt : null,
      winnerTimeFormatted: winnerInfo.hasWinner ? winnerInfo.winner.timeFormatted : null,
      correctCount: winnerInfo.correctSubmissions.length,
      totalCount: allSubmissions.length
    });

    dbHelpers.updateState({
      state: 'WINNER_CHECKED',
      winner_revealed: 1
    });

    this.broadcastStateChange();
    return this.getHostPayload();
  }

  // FSM Action: NEXT QUESTION
  nextQuestion() {
    const state = dbHelpers.getState();
    if (state.state !== 'WINNER_CHECKED') {
      throw new Error(`Cannot advance to next question until winner step is complete. Current state: ${state.state}`);
    }

    const questions = dbHelpers.getQuestions();
    const nextIndex = state.current_question_index + 1;

    if (nextIndex >= questions.length) {
      // Finished all 15 questions
      dbHelpers.updateState({
        state: 'QUIZ_COMPLETE',
        quiz_completed: 1
      });
    } else {
      // Advance to next question
      dbHelpers.updateState({
        current_question_index: nextIndex,
        state: 'QUESTION_PREPARED',
        question_revealed_at: null,
        polling_closes_at: null,
        correct_answer_revealed: 0,
        winner_revealed: 0
      });
    }

    this.broadcastStateChange();
    return this.getHostPayload();
  }

  // Reset entire quiz (for re-runs/dev)
  resetQuiz() {
    this.stopTimer();
    dbHelpers.resetQuiz();
    this.broadcastStateChange();
    return this.getHostPayload();
  }

  // Winner calculation for a question
  getWinnerForQuestion(questionId) {
    const correctSubmissions = dbHelpers.getCorrectSubmissionsForQuestion(questionId);
    const formattedCorrect = correctSubmissions.map((s, idx) => ({
      rank: idx + 1,
      teamCode: s.team_code,
      submittedAt: s.submitted_at,
      timeFormatted: this.formatTimestamp(s.submitted_at),
      responseTimeMs: s.response_time_ms,
      responseTimeSec: (s.response_time_ms / 1000).toFixed(2)
    }));

    if (formattedCorrect.length === 0) {
      return {
        hasWinner: false,
        message: 'NO CORRECT ANSWERS',
        correctSubmissions: []
      };
    }

    return {
      hasWinner: true,
      winner: formattedCorrect[0],
      correctSubmissions: formattedCorrect
    };
  }

  // Participant Answer Submission
  submitAnswer({ teamCode, selectedOption }) {
    const state = dbHelpers.getState();

    // Rule 1: Polling must be active
    if (state.state !== 'POLLING_ACTIVE') {
      throw new Error('POLL_CLOSED: Answer submission is only allowed when polling is active.');
    }

    // Rule 2: Server deadline check
    const now = Date.now();
    if (!state.polling_closes_at || now > state.polling_closes_at) {
      throw new Error('POLL_EXPIRED: Submission deadline has passed. Answers are locked.');
    }

    // Rule 3: Valid option format
    const cleanOption = String(selectedOption || '').toUpperCase().trim();
    if (!['A', 'B', 'C', 'D'].includes(cleanOption)) {
      throw new Error('INVALID_OPTION: Option must be A, B, C, or D.');
    }

    // Find team
    const team = dbHelpers.getTeamByCode(teamCode);
    if (!team) {
      throw new Error('TEAM_NOT_FOUND: Team ID is not registered.');
    }

    // Find current question
    const questions = dbHelpers.getQuestions();
    const currentQ = questions[state.current_question_index];
    if (!currentQ) {
      throw new Error('NO_ACTIVE_QUESTION: No active question found.');
    }

    // Rule 4: Prevent duplicate submissions
    const existing = dbHelpers.getTeamSubmissionForQuestion(team.id, currentQ.id);
    if (existing) {
      throw new Error('ALREADY_SUBMITTED: Team has already submitted an answer for this question.');
    }

    // Compute correctness and response time on the server
    const isCorrect = cleanOption === currentQ.correct_option;
    const responseTimeMs = state.question_revealed_at ? Math.max(0, now - state.question_revealed_at) : 0;

    const submission = dbHelpers.createSubmission({
      teamId: team.id,
      questionId: currentQ.id,
      selectedOption: cleanOption,
      submittedAt: now,
      isCorrect,
      responseTimeMs
    });

    // Notify host of live submission count
    const submissions = dbHelpers.getSubmissionsForQuestion(currentQ.id);
    this.io.emit('submission_received', {
      submissionsCount: submissions.length,
      teamCode: team.team_code,
      submittedAt: now,
      timeFormatted: this.formatTimestamp(now)
    });

    return {
      success: true,
      selectedOption: cleanOption,
      submittedAt: now,
      timeFormatted: this.formatTimestamp(now)
    };
  }

  // Broadcast state change to all clients
  broadcastStateChange() {
    const hostPayload = this.getHostPayload();
    this.io.emit('quiz_state_change', hostPayload);
  }
}

module.exports = QuizManager;
