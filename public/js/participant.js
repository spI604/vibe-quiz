// ==================================================
// PARTICIPANT CLIENT LOGIC
// ==================================================

(function() {
  const teamCode = localStorage.getItem('vibe_team_code');
  if (!teamCode) {
    window.location.href = '/';
    return;
  }

  // DOM Elements
  const navTeamCode = document.getElementById('nav-team-code');
  const logoutBtn = document.getElementById('logout-btn');
  const socketStatus = document.getElementById('socket-status');

  const viewWaiting = document.getElementById('view-waiting');
  const viewQuestion = document.getElementById('view-question');
  const viewWinner = document.getElementById('view-winner');
  const viewFinal = document.getElementById('view-final');

  const waitingStatusText = document.getElementById('waiting-status-text');
  const waitingQIndicator = document.getElementById('waiting-q-indicator');

  const questionBadge = document.getElementById('question-badge');
  const questionStateBadge = document.getElementById('question-state-badge');
  const questionText = document.getElementById('question-text');
  const optAText = document.getElementById('opt-a-text');
  const optBText = document.getElementById('opt-b-text');
  const optCText = document.getElementById('opt-c-text');
  const optDText = document.getElementById('opt-d-text');
  const optionButtons = document.querySelectorAll('.option-btn');
  const submissionBanner = document.getElementById('submission-banner');
  const submissionBannerText = document.getElementById('submission-banner-text');

  const timerRow = document.getElementById('participant-timer-row');
  const timerDisplay = document.getElementById('timer-display');
  const timerDot = document.getElementById('timer-dot');
  const timerStatusLabel = document.getElementById('timer-status-label');

  const roundWinnerTeam = document.getElementById('round-winner-team');
  const roundWinnerTime = document.getElementById('round-winner-time');
  const myFinalScorePill = document.getElementById('my-final-score-pill');
  const finalStandingsTbody = document.getElementById('final-standings-tbody');

  navTeamCode.textContent = teamCode;

  // Logout handler
  logoutBtn.addEventListener('click', () => {
    if (confirm(`Switch or leave team ${teamCode}?`)) {
      localStorage.removeItem('vibe_team_code');
      localStorage.removeItem('vibe_team_id');
      window.location.href = '/';
    }
  });

  // Client State Tracking
  let currentQuizState = null;
  let hasSubmitted = false;
  let selectedOption = null;
  let timerInterval = null;

  // Socket Connection
  const socket = io();

  socket.on('connect', () => {
    socketStatus.classList.remove('danger');
    socketStatus.title = 'Connected to quiz server';
    
    // Join quiz session with team identity
    socket.emit('participant_join', { teamCode }, (res) => {
      if (res && res.error) {
        alert('Authentication failed: ' + res.error);
        localStorage.removeItem('vibe_team_code');
        window.location.href = '/';
        return;
      }
      if (res && res.payload) {
        handleStateUpdate(res.payload);
      }
    });
  });

  socket.on('disconnect', () => {
    socketStatus.classList.add('danger');
    socketStatus.title = 'Disconnected from server. Reconnecting...';
  });

  socket.on('quiz_state_change', (payload) => {
    handleStateUpdate(payload);
  });

  socket.on('timer_tick', (data) => {
    updateTimerDisplay(data.remainingSeconds);
  });

  // Format seconds to mm:ss
  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec));
    const mins = String(Math.floor(s / 60)).padStart(2, '0');
    const secs = String(s % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function updateTimerDisplay(remainingSec) {
    timerDisplay.textContent = formatSeconds(remainingSec);
    if (remainingSec <= 5) {
      timerDisplay.className = 'timer-digits danger';
    } else if (remainingSec <= 15) {
      timerDisplay.className = 'timer-digits warning';
    } else {
      timerDisplay.className = 'timer-digits';
    }
  }

  // Answer Submission Handler
  optionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (hasSubmitted) return;
      if (!currentQuizState || currentQuizState.state !== 'POLLING_ACTIVE') return;

      const chosen = btn.getAttribute('data-option');
      hasSubmitted = true;
      selectedOption = chosen;

      // Lock buttons immediately
      optionButtons.forEach(b => {
        b.disabled = true;
        if (b.getAttribute('data-option') === chosen) {
          b.classList.add('selected');
        }
      });

      // Show instant submission feedback
      submissionBanner.className = 'submission-status submitted';
      submissionBannerText.textContent = `ANSWER SUBMITTED: OPTION ${chosen}`;
      submissionBanner.style.display = 'flex';

      // Submit to server
      socket.emit('submit_answer', { selectedOption: chosen, teamCode }, (res) => {
        if (res && res.error) {
          submissionBanner.className = 'submission-status locked';
          submissionBannerText.textContent = res.message || 'Submission locked or rejected.';
        }
      });
    });
  });

  // Main State Processor
  function handleStateUpdate(data) {
    if (!data) return;
    currentQuizState = data;
    const state = data.state;
    const question = data.question || data.currentQuestion;
    const userSubmission = data.userSubmission;
    const correctOption = data.correctOption;
    const winnerInfo = data.winnerInfo;
    const finalLeaderboard = data.finalLeaderboard;

    // Reset view visibility
    viewWaiting.style.display = 'none';
    viewQuestion.style.display = 'none';
    viewWinner.style.display = 'none';
    viewFinal.style.display = 'none';

    // 1. WAITING / QUESTION_PREPARED (Strictly hide question from participants)
    if (state === 'WAITING' || state === 'QUESTION_PREPARED') {
      viewWaiting.style.display = 'flex';
      viewQuestion.style.display = 'none';
      waitingStatusText.textContent = state === 'WAITING' ? 'WAITING FOR QUIZ TO START' : 'QUESTION PREPARED — READY';
      waitingQIndicator.textContent = `Question ${(data.currentQuestionIndex || 0) + 1} of ${data.totalQuestions || 15}`;
      timerStatusLabel.textContent = 'READY';
      timerDisplay.textContent = '00:60';
      timerDisplay.className = 'timer-digits';
      hasSubmitted = false;
      selectedOption = null;
      return;
    }

    // 2. POLLING_ACTIVE / POLLING_CLOSED / ANSWER_REVEALED / WINNER_CHECKED
    if (question && (state === 'POLLING_ACTIVE' || state === 'POLLING_CLOSED' || state === 'ANSWER_REVEALED' || state === 'WINNER_CHECKED')) {
      viewWaiting.style.display = 'none';
      viewQuestion.style.display = 'flex';

      const qOrder = question.order || question.question_order || ((data.currentQuestionIndex || 0) + 1);
      questionBadge.textContent = `QUESTION ${String(qOrder).padStart(2, '0')}`;
      questionText.textContent = question.text || question.question_text || '';
      optAText.textContent = question.option_a || question.a || '';
      optBText.textContent = question.option_b || question.b || '';
      optCText.textContent = question.option_c || question.c || '';
      optDText.textContent = question.option_d || question.d || '';

      // Reset option button styles
      optionButtons.forEach(b => {
        b.classList.remove('selected', 'correct', 'incorrect');
      });

      // Restore user submission if present
      if (userSubmission) {
        hasSubmitted = true;
        selectedOption = userSubmission.selectedOption;
      }

      if (state === 'POLLING_ACTIVE') {
        questionStateBadge.className = 'badge badge-cyan';
        questionStateBadge.textContent = 'POLLING ACTIVE';
        timerStatusLabel.textContent = 'TIME REMAINING';

        if (hasSubmitted) {
          optionButtons.forEach(b => {
            b.disabled = true;
            if (b.getAttribute('data-option') === selectedOption) {
              b.classList.add('selected');
            }
          });
          submissionBanner.className = 'submission-status submitted';
          submissionBannerText.textContent = `ANSWER SUBMITTED: OPTION ${selectedOption}`;
          submissionBanner.style.display = 'flex';
        } else {
          optionButtons.forEach(b => b.disabled = false);
          submissionBanner.style.display = 'none';
        }
      }

      if (state === 'POLLING_CLOSED') {
        questionStateBadge.className = 'badge badge-gold';
        questionStateBadge.textContent = 'POLLING CLOSED';
        timerStatusLabel.textContent = 'LOCKED';
        timerDisplay.textContent = '00:00';
        timerDisplay.className = 'timer-digits';
        optionButtons.forEach(b => b.disabled = true);

        if (hasSubmitted && selectedOption) {
          const selBtn = document.querySelector(`.option-btn[data-option="${selectedOption}"]`);
          if (selBtn) selBtn.classList.add('selected');
          submissionBanner.className = 'submission-status locked';
          submissionBannerText.textContent = `ANSWERS LOCKED — SUBMITTED: OPTION ${selectedOption}`;
        } else {
          submissionBanner.className = 'submission-status locked';
          submissionBannerText.textContent = 'ANSWERS LOCKED — NO SUBMISSION';
        }
        submissionBanner.style.display = 'flex';
      }

      if (state === 'ANSWER_REVEALED' || state === 'WINNER_CHECKED') {
        questionStateBadge.className = 'badge badge-emerald';
        questionStateBadge.textContent = 'ANSWER REVEALED';
        timerStatusLabel.textContent = 'REVEALED';
        optionButtons.forEach(b => b.disabled = true);

        if (correctOption) {
          const correctBtn = document.querySelector(`.option-btn[data-option="${correctOption}"]`);
          if (correctBtn) correctBtn.classList.add('correct');

          if (hasSubmitted && selectedOption) {
            if (selectedOption === correctOption) {
              submissionBanner.className = 'submission-status correct';
              submissionBannerText.textContent = `CORRECT! OPTION ${correctOption} (+1 PT)`;
              triggerSubtleConfetti();
            } else {
              const wrongBtn = document.querySelector(`.option-btn[data-option="${selectedOption}"]`);
              if (wrongBtn) wrongBtn.classList.add('incorrect');
              submissionBanner.className = 'submission-status locked';
              submissionBannerText.textContent = `INCORRECT — CORRECT ANSWER: ${correctOption}`;
            }
          } else {
            submissionBanner.className = 'submission-status locked';
            submissionBannerText.textContent = `TIME EXPIRED — CORRECT ANSWER: ${correctOption}`;
          }
          submissionBanner.style.display = 'flex';
        }
      }

      // Winner panel if winner revealed
      if (state === 'WINNER_CHECKED' && winnerInfo) {
        if (winnerInfo.hasWinner) {
          viewWinner.style.display = 'flex';
          roundWinnerTeam.textContent = winnerInfo.winner.teamCode;
          roundWinnerTime.textContent = `${winnerInfo.winner.timeFormatted} (${winnerInfo.winner.responseTimeSec}s)`;
        } else {
          viewWinner.style.display = 'flex';
          roundWinnerTeam.textContent = 'NO CORRECT ANSWERS';
          roundWinnerTeam.style.fontSize = '1.4rem';
          roundWinnerTime.textContent = 'No winner declared for this round';
        }
      }
    }

    // 3. QUIZ COMPLETE
    if (state === 'QUIZ_COMPLETE') {
      viewFinal.style.display = 'flex';
      timerRow.style.display = 'none';

      if (finalLeaderboard && Array.isArray(finalLeaderboard)) {
        const myRow = finalLeaderboard.find(t => t.team_code === teamCode);
        const myPoints = myRow ? myRow.points : 0;
        const myRank = myRow ? (finalLeaderboard.indexOf(myRow) + 1) : '-';
        myFinalScorePill.textContent = `Your Team: Rank #${myRank} (${myPoints} pts)`;

        finalStandingsTbody.innerHTML = '';
        finalLeaderboard.forEach((team, idx) => {
          const tr = document.createElement('tr');
          if (team.team_code === teamCode) tr.classList.add('highlighted');
          tr.innerHTML = `
            <td style="font-family: var(--font-display); font-weight: 700;">#${idx + 1}</td>
            <td style="font-family: var(--font-mono);">${team.team_code}</td>
            <td style="text-align: right; font-family: var(--font-mono); font-weight: 700;">${team.points} pts</td>
          `;
          finalStandingsTbody.appendChild(tr);
        });
      }
    }
  }

  // Tasteful micro-confetti
  function triggerSubtleConfetti() {
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 40,
        spread: 50,
        origin: { y: 0.8 },
        colors: ['#10b981', '#06b6d4', '#38bdf8', '#818cf8']
      });
    }
  }
})();
