// ==================================================
// HOST CONTROL CONSOLE LOGIC
// ==================================================

(function() {
  // DOM Elements - Auth
  const authOverlay = document.getElementById('host-auth-overlay');
  const authForm = document.getElementById('host-auth-form');
  const passwordInput = document.getElementById('host-password-input');
  const authError = document.getElementById('host-auth-error');
  const hostMainApp = document.getElementById('host-main-app');

  // DOM Elements - Navigation & Metrics
  const metricTeamsJoined = document.getElementById('metric-teams-joined');
  const metricQuestionCounter = document.getElementById('metric-question-counter');
  const metricStateBadge = document.getElementById('metric-state-badge');
  const showQrBtn = document.getElementById('show-qr-btn');
  const resetQuizBtn = document.getElementById('reset-quiz-btn');

  // DOM Elements - Stage Views
  const stageViewWaiting = document.getElementById('stage-view-waiting');
  const stageViewActive = document.getElementById('stage-view-active');
  const stageViewFinal = document.getElementById('stage-view-final');
  const stageQOrder = document.getElementById('stage-q-order');
  const stageMiniStatus = document.getElementById('stage-mini-status');
  const stageActionHint = document.getElementById('stage-action-hint');

  // Waiting Stage Elements
  const hostQrImg = document.getElementById('host-qr-img');
  const hostJoinUrlLabel = document.getElementById('host-join-url-label');
  const waitingTeamsCountPill = document.getElementById('waiting-teams-count-pill');

  // Active Stage Elements
  const stageQuestionText = document.getElementById('stage-question-text');
  const hostOptAText = document.getElementById('host-opt-a-text');
  const hostOptBText = document.getElementById('host-opt-b-text');
  const hostOptCText = document.getElementById('host-opt-c-text');
  const hostOptDText = document.getElementById('host-opt-d-text');
  const stageOptionCards = document.querySelectorAll('.stage-option-card');
  const hostTimerNum = document.getElementById('host-timer-num');
  const hostSubmissionsVal = document.getElementById('host-submissions-val');

  // Action Buttons
  const btnStartQuiz = document.getElementById('btn-start-quiz');
  const btnRevealQuestion = document.getElementById('btn-reveal-question');
  const btnPollingActive = document.getElementById('btn-polling-active');
  const btnRevealAnswer = document.getElementById('btn-reveal-answer');
  const btnCheckWinner = document.getElementById('btn-check-winner');
  const btnNextQuestion = document.getElementById('btn-next-question');
  const btnViewFinal = document.getElementById('btn-view-final');

  // Sidebar History
  const historyItemsList = document.getElementById('history-items-list');
  const historyCountBadge = document.getElementById('history-count-badge');

  // Winner Modal Elements
  const winnerModalOverlay = document.getElementById('winner-modal-overlay');
  const winnerModalTeam = document.getElementById('winner-modal-team');
  const winnerModalTime = document.getElementById('winner-modal-time');
  const winnerModalResponseSec = document.getElementById('winner-modal-response-sec');
  const winnerModalCorrectList = document.getElementById('winner-modal-correct-list');
  const winnerModalCloseBtn = document.getElementById('winner-modal-close-btn');

  // QR Modal Elements
  const qrModalOverlay = document.getElementById('qr-modal-overlay');
  const qrModalImg = document.getElementById('qr-modal-img');
  const qrModalUrlLabel = document.getElementById('qr-modal-url-label');
  const qrModalCloseBtn = document.getElementById('qr-modal-close-btn');

  // Final Results Elements
  const championTeamCode = document.getElementById('champion-team-code');
  const championScore = document.getElementById('champion-score');
  const hostFinalStandingsTbody = document.getElementById('host-final-standings-tbody');

  // State Variables
  let hostToken = sessionStorage.getItem('vibe_host_token');
  let currentHostState = null;
  let socket = null;

  // 1. Host Authentication
  function checkAuth() {
    if (hostToken) {
      authOverlay.style.display = 'none';
      hostMainApp.style.display = 'flex';
      initSocket();
    } else {
      authOverlay.style.display = 'flex';
      hostMainApp.style.display = 'none';
      passwordInput.focus();
    }
  }

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.style.display = 'none';
    const password = passwordInput.value.trim();

    try {
      const res = await fetch('/api/host/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (data.success && data.token) {
        hostToken = data.token;
        sessionStorage.setItem('vibe_host_token', hostToken);
        authOverlay.style.display = 'none';
        hostMainApp.style.display = 'flex';
        initSocket();
      } else {
        authError.textContent = data.message || 'Invalid Host Event Key.';
        authError.style.display = 'block';
      }
    } catch (err) {
      authError.textContent = 'Connection error. Please retry.';
      authError.style.display = 'block';
    }
  });

  // 2. Fetch Dynamic QR Code
  fetch('/api/qr')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        hostQrImg.src = data.qrDataUrl;
        hostJoinUrlLabel.textContent = data.joinUrl;
        qrModalImg.src = data.qrDataUrl;
        qrModalUrlLabel.textContent = data.joinUrl;
      }
    })
    .catch(console.error);

  // QR Modal Toggle
  showQrBtn.addEventListener('click', () => {
    qrModalOverlay.classList.add('active');
  });

  qrModalCloseBtn.addEventListener('click', () => {
    qrModalOverlay.classList.remove('active');
  });

  // 3. Socket Initialization
  function initSocket() {
    if (socket) return;
    socket = io();

    socket.on('connect', () => {
      socket.emit('host_auth', { token: hostToken }, (res) => {
        if (res && res.success) {
          if (res.token) {
            hostToken = res.token;
            sessionStorage.setItem('vibe_host_token', hostToken);
          }
          if (res.payload) {
            renderHostState(res.payload);
          }
        } else {
          sessionStorage.removeItem('vibe_host_token');
          hostToken = null;
          checkAuth();
        }
      });
    });

    socket.on('quiz_state_change', (payload) => {
      if (payload && payload.isParticipantOnly) return;
      renderHostState(payload);
    });

    socket.on('host_state_change', (payload) => {
      renderHostState(payload);
    });

    socket.on('teams_count_update', (data) => {
      metricTeamsJoined.textContent = data.connectedCount;
      waitingTeamsCountPill.textContent = `${data.connectedCount} TEAMS`;
    });

    socket.on('submission_received', (data) => {
      if (currentHostState && currentHostState.connectedTeamsCount) {
        hostSubmissionsVal.textContent = `${data.submissionsCount} / ${currentHostState.connectedTeamsCount}`;
      } else {
        hostSubmissionsVal.textContent = `${data.submissionsCount}`;
      }
    });

    socket.on('timer_tick', (data) => {
      updateStageTimer(data.remainingSeconds);
    });
  }

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec));
    const mins = String(Math.floor(s / 60)).padStart(2, '0');
    const secs = String(s % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function updateStageTimer(remainingSec) {
    hostTimerNum.textContent = formatSeconds(remainingSec);
    if (remainingSec <= 5) {
      hostTimerNum.className = 'stage-timer-ring-num danger';
    } else if (remainingSec <= 15) {
      hostTimerNum.className = 'stage-timer-ring-num warning';
    } else {
      hostTimerNum.className = 'stage-timer-ring-num';
    }

    if (currentHostState && currentHostState.state === 'POLLING_ACTIVE') {
      btnPollingActive.textContent = `POLLING IN PROGRESS (${formatSeconds(remainingSec)})...`;
    }
  }

  // 4. Render State Machine
  function renderHostState(data) {
    if (!data) return;
    currentHostState = data;
    const { state, currentQuestionIndex, totalQuestions, currentQuestion, connectedTeamsCount, submissionsCount, history, finalLeaderboard, winnerInfo } = data;

    const qNum = (currentQuestionIndex !== undefined ? currentQuestionIndex : (currentQuestion ? currentQuestion.question_order - 1 : 0)) + 1;
    const totalQ = totalQuestions || 15;

    // Update Top Metric Pills
    metricTeamsJoined.textContent = connectedTeamsCount || 0;
    waitingTeamsCountPill.textContent = `${connectedTeamsCount || 0} TEAMS`;
    metricQuestionCounter.textContent = `${qNum} / ${totalQ}`;
    metricStateBadge.textContent = state ? state.replace('_', ' ') : 'WAITING';

    // Reset All Buttons Visibility
    btnStartQuiz.style.display = 'none';
    btnRevealQuestion.style.display = 'none';
    btnPollingActive.style.display = 'none';
    btnRevealAnswer.style.display = 'none';
    btnCheckWinner.style.display = 'none';
    btnNextQuestion.style.display = 'none';
    btnViewFinal.style.display = 'none';

    // Reset View Visibility
    stageViewWaiting.style.display = 'none';
    stageViewActive.style.display = 'none';
    stageViewFinal.style.display = 'none';

    // Reset Option Styles
    stageOptionCards.forEach(c => {
      c.classList.remove('correct-revealed', 'dimmed', 'placeholder-card', 'locked-placeholder');
    });

    // Render Sidebar History
    renderHistory(history || []);

    // STATE 1: WAITING
    if (state === 'WAITING') {
      stageViewWaiting.style.display = 'flex';
      stageQOrder.textContent = 'TECHSPARDHA 2K26';
      stageMiniStatus.className = 'badge badge-cyan';
      stageMiniStatus.textContent = 'READY';
      stageActionHint.textContent = "Click 'START QUIZ' to prepare Question 1 on the stage.";
      btnStartQuiz.style.display = 'inline-flex';
      return;
    }

    // STATE 7: QUIZ COMPLETE
    if (state === 'QUIZ_COMPLETE') {
      stageViewFinal.style.display = 'block';
      stageQOrder.textContent = 'QUIZ COMPLETE';
      stageMiniStatus.className = 'badge badge-gold';
      stageMiniStatus.textContent = 'FINAL RESULTS';
      stageActionHint.textContent = 'Quiz finished. Final standings and champions declared.';

      if (finalLeaderboard && finalLeaderboard.length > 0) {
        const topTeam = finalLeaderboard[0];
        championTeamCode.textContent = topTeam.team_code;
        championScore.textContent = `${topTeam.points} POINTS (${topTeam.round_wins || 0} ROUND WINS)`;

        hostFinalStandingsTbody.innerHTML = '';
        finalLeaderboard.forEach((t, idx) => {
          const tr = document.createElement('tr');
          if (idx === 0) tr.classList.add('highlighted');
          tr.innerHTML = `
            <td style="font-family: var(--font-display); font-weight: 700;">#${idx + 1}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${t.team_code}</td>
            <td style="text-align: center; font-family: var(--font-mono);">${t.round_wins || 0}</td>
            <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: #38bdf8;">${t.points} pts</td>
          `;
          hostFinalStandingsTbody.appendChild(tr);
        });

        triggerCelebration();
      }
      return;
    }

    // ACTIVE STAGE (STATES 2, 3, 4, 5, 6)
    // Always render stageViewActive for all active question states
    stageViewActive.style.display = 'flex';
    stageQOrder.textContent = `QUESTION ${String(qNum).padStart(2, '0')}`;
    hostSubmissionsVal.textContent = `${submissionsCount || 0} / ${connectedTeamsCount || 0}`;

    // STATE 2: QUESTION_PREPARED (Strictly hide question until host reveals it!)
    if (state === 'QUESTION_PREPARED') {
      stageMiniStatus.className = 'badge badge-indigo';
      stageMiniStatus.textContent = 'PREPARED (HIDDEN)';
      stageActionHint.textContent = "Question is prepared. Click 'START QUESTION' to unveil and start 60s countdown.";

      // Display exact requested placeholders:
      // 1. __________
      // A. _____         B. ______
      // C. _____       D. _______
      stageQuestionText.innerHTML = `
        <div class="placeholder-question-container">
          <span class="placeholder-q-num">${qNum}.</span>
          <div class="placeholder-q-content">
            <span class="placeholder-dashes">__________</span>
            <span class="placeholder-tag">QUESTION HIDDEN &bull; CLICK &quot;START QUESTION&quot; TO REVEAL</span>
          </div>
        </div>
      `;

      hostOptAText.innerHTML = `<span class="placeholder-dashes">_____</span>`;
      hostOptBText.innerHTML = `<span class="placeholder-dashes">______</span>`;
      hostOptCText.innerHTML = `<span class="placeholder-dashes">_____</span>`;
      hostOptDText.innerHTML = `<span class="placeholder-dashes">_______</span>`;

      stageOptionCards.forEach(c => c.classList.add('placeholder-card'));

      hostTimerNum.textContent = '00:60';
      hostTimerNum.className = 'stage-timer-ring-num';

      // Ensure START QUESTION button is prominently visible
      btnRevealQuestion.style.display = 'inline-flex';
      btnRevealQuestion.innerHTML = '▶ START QUESTION';
      return;
    }

    // STATES 3, 4, 5, 6: Unveil full question and options
    if (currentQuestion) {
      stageQuestionText.textContent = currentQuestion.question_text;
      hostOptAText.textContent = currentQuestion.option_a;
      hostOptBText.textContent = currentQuestion.option_b;
      hostOptCText.textContent = currentQuestion.option_c;
      hostOptDText.textContent = currentQuestion.option_d;
    }
    stageOptionCards.forEach(c => c.classList.remove('placeholder-card', 'locked-placeholder'));

    // STATE 3: POLLING_ACTIVE
    if (state === 'POLLING_ACTIVE') {
      stageMiniStatus.className = 'badge badge-cyan';
      stageMiniStatus.textContent = 'POLLING ACTIVE';
      stageActionHint.textContent = 'Answer submissions are open. Countdown running.';
      btnPollingActive.style.display = 'inline-flex';
    }

    // STATE 4: POLLING_CLOSED
    if (state === 'POLLING_CLOSED') {
      stageMiniStatus.className = 'badge badge-gold';
      stageMiniStatus.textContent = 'POLLING CLOSED';
      stageActionHint.textContent = "Time expired. Answers are locked. Click 'REVEAL ANSWER' to show the correct option.";
      hostTimerNum.textContent = '00:00';
      hostTimerNum.className = 'stage-timer-ring-num';
      btnRevealAnswer.style.display = 'inline-flex';
    }

    // STATE 5: ANSWER_REVEALED
    if (state === 'ANSWER_REVEALED') {
      stageMiniStatus.className = 'badge badge-emerald';
      stageMiniStatus.textContent = 'ANSWER REVEALED';
      stageActionHint.textContent = "Correct answer revealed on stage and participant devices. Click 'CHECK WINNER'.";
      
      if (currentQuestion) {
        highlightCorrectOption(currentQuestion.correct_option);
      }
      btnCheckWinner.style.display = 'inline-flex';
    }

    // STATE 6: WINNER_CHECKED
    if (state === 'WINNER_CHECKED') {
      stageMiniStatus.className = 'badge badge-emerald';
      stageMiniStatus.textContent = 'WINNER VERIFIED';
      if (currentQuestion) {
        highlightCorrectOption(currentQuestion.correct_option);
      }

      if (winnerInfo) {
        openWinnerModal(winnerInfo);
      }

      if (qNum < totalQ) {
        stageActionHint.textContent = `Round winner recorded. Click 'NEXT QUESTION' to proceed to Question ${qNum + 1}.`;
        btnNextQuestion.style.display = 'inline-flex';
      } else {
        stageActionHint.textContent = "All 15 questions completed! Click 'VIEW FINAL RESULTS'.";
        btnViewFinal.style.display = 'inline-flex';
      }
    }
  }

  function highlightCorrectOption(correctLetter) {
    stageOptionCards.forEach(card => {
      if (card.getAttribute('data-option') === correctLetter) {
        card.classList.add('correct-revealed');
      } else {
        card.classList.add('dimmed');
      }
    });
  }

  // Render Sidebar History
  function renderHistory(history) {
    historyCountBadge.textContent = `${history.length} / 15`;
    if (history.length === 0) {
      historyItemsList.innerHTML = `
        <div style="color: var(--text-muted); font-size: 0.85rem; padding: 20px 10px; text-align: center;">
          No completed rounds yet.
        </div>
      `;
      return;
    }

    historyItemsList.innerHTML = '';
    history.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item fade-in';
      div.innerHTML = `
        <div class="history-item-left">
          <span class="history-q-num">Question ${item.question_order}</span>
          <span class="history-time">${item.winner_time_formatted || 'No time recorded'}</span>
        </div>
        <div>
          ${item.winner_team_code 
            ? `<span class="history-winner-badge">${item.winner_team_code}</span>`
            : `<span class="history-no-winner">No Winner</span>`
          }
        </div>
      `;
      historyItemsList.appendChild(div);
    });
  }

  // Open Winner Celebration Modal
  function openWinnerModal(winnerInfo) {
    if (!winnerInfo) return;

    if (winnerInfo.hasWinner && winnerInfo.winner) {
      winnerModalTeam.textContent = winnerInfo.winner.teamCode;
      winnerModalTime.textContent = winnerInfo.winner.timeFormatted;
      winnerModalResponseSec.textContent = `(+${winnerInfo.winner.responseTimeSec}s)`;

      winnerModalCorrectList.innerHTML = '';
      winnerInfo.correctSubmissions.forEach((sub, idx) => {
        const row = document.createElement('div');
        row.className = `leaderboard-row ${idx === 0 ? 'gold-first' : ''}`;
        row.innerHTML = `
          <span>${idx === 0 ? '🥇 1st' : (idx === 1 ? '🥈 2nd' : (idx === 2 ? '🥉 3rd' : `#${idx + 1}`))} &nbsp; ${sub.teamCode}</span>
          <span>${sub.timeFormatted} (+${sub.responseTimeSec}s)</span>
        `;
        winnerModalCorrectList.appendChild(row);
      });

      triggerCelebration();
    } else {
      winnerModalTeam.textContent = 'NO CORRECT ANSWERS';
      winnerModalTeam.style.fontSize = '2.2rem';
      winnerModalTime.textContent = 'No winner declared';
      winnerModalResponseSec.textContent = '';
      winnerModalCorrectList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 12px;">
          No team submitted the correct answer before the deadline.
        </div>
      `;
    }

    winnerModalOverlay.classList.add('active');
  }

  winnerModalCloseBtn.addEventListener('click', () => {
    winnerModalOverlay.classList.remove('active');
  });

  // Confetti Animation
  function triggerCelebration() {
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10b981', '#06b6d4', '#38bdf8', '#fbbf24', '#818cf8']
      });
    }
  }

  // Button Action Handlers
  btnStartQuiz.addEventListener('click', () => {
    socket.emit('host_start_quiz', {}, (res) => {
      if (res && res.error) alert(res.error);
    });
  });

  btnRevealQuestion.addEventListener('click', () => {
    socket.emit('host_reveal_question', {}, (res) => {
      if (res && res.error) alert(res.error);
    });
  });

  btnRevealAnswer.addEventListener('click', () => {
    socket.emit('host_reveal_answer', {}, (res) => {
      if (res && res.error) alert(res.error);
    });
  });

  btnCheckWinner.addEventListener('click', () => {
    socket.emit('host_check_winner', {}, (res) => {
      if (res && res.error) alert(res.error);
    });
  });

  btnNextQuestion.addEventListener('click', () => {
    winnerModalOverlay.classList.remove('active');
    socket.emit('host_next_question', {}, (res) => {
      if (res && res.error) alert(res.error);
    });
  });

  btnViewFinal.addEventListener('click', () => {
    winnerModalOverlay.classList.remove('active');
    socket.emit('host_next_question', {}, (res) => {
      if (res && res.error) alert(res.error);
    });
  });

  // Reset Quiz Action
  resetQuizBtn.addEventListener('click', () => {
    const confirmReset = confirm('WARNING: Are you sure you want to reset the entire quiz to Question 1? All submissions and history for this session will be cleared.');
    if (confirmReset) {
      winnerModalOverlay.classList.remove('active');
      socket.emit('host_reset_quiz', {}, (res) => {
        if (res && res.error) alert(res.error);
      });
    }
  });

  // Check auth on load
  checkAuth();
})();
