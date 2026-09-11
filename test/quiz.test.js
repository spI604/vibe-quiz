const assert = require('assert');
const { dbHelpers } = require('../server/db');
const QuizManager = require('../server/quizManager');

console.log('--- RUNNING TECHSPARDHA 2K26 VIBE QUIZ TESTS ---\n');

// Mock IO for testing
const emittedEvents = [];
const mockIo = {
  emit: (event, data) => {
    emittedEvents.push({ event, data });
  }
};

// 1. Verify 10 Questions
const questions = dbHelpers.getQuestions();
assert.strictEqual(questions.length, 10, 'Must have exactly 10 questions');
console.log('✔ Verified 10 seeded questions present');

// Verify Question 1 content
assert.strictEqual(questions[0].question_order, 1);
assert.strictEqual(questions[0].correct_option, 'B');
assert.ok(questions[0].question_text.includes("orientation of a QR code"));
console.log('✔ Verified Question 1 content & correct answer');

// Verify Question 5 Wi-Fi answer is D
const q5 = questions.find(q => q.question_order === 5);
assert.strictEqual(q5.correct_option, 'D');
assert.strictEqual(q5.option_d, 'Nothing specific');
console.log('✔ Verified Question 5 content');

// 2. Reset Quiz State for clean test
dbHelpers.resetQuiz();
const quiz = new QuizManager(mockIo);
let state = quiz.getCurrentState();
assert.strictEqual(state.state, 'WAITING');
assert.strictEqual(state.currentQuestionIndex, 0);
console.log('✔ Verified initial state is WAITING at question 0');

// 3. Test Participant Payload Security (correct_option MUST NOT be present)
const initialParticipantPayload = quiz.getParticipantPayload();
assert.strictEqual(initialParticipantPayload.state, 'WAITING');
assert.strictEqual(initialParticipantPayload.correctOption, undefined, 'Correct option must not be leaked');
console.log('✔ Verified participant payload omits correct option in WAITING state');

// 4. Test Teams Creation
const team1 = dbHelpers.findOrCreateTeam('TEAM-001');
const team2 = dbHelpers.findOrCreateTeam('TEAM-002');
const team3 = dbHelpers.findOrCreateTeam('TEAM-003');
assert.strictEqual(team1.team_code, 'TEAM-001');
assert.strictEqual(team2.team_code, 'TEAM-002');
assert.strictEqual(team3.team_code, 'TEAM-003');
console.log('✔ Verified team registration');

// 5. Test State Transition: WAITING -> QUESTION_PREPARED
quiz.startQuiz();
state = quiz.getCurrentState();
assert.strictEqual(state.state, 'QUESTION_PREPARED');
const preparedPayload = quiz.getParticipantPayload(team1.id);
assert.strictEqual(preparedPayload.message, 'WAITING FOR QUESTION');
assert.strictEqual(preparedPayload.question, undefined, 'Question text must not be leaked to participant before reveal');
console.log('✔ Verified QUESTION_PREPARED state hides question from participant');

// 6. Test State Transition: QUESTION_PREPARED -> POLLING_ACTIVE
quiz.revealQuestion();
state = quiz.getCurrentState();
assert.strictEqual(state.state, 'POLLING_ACTIVE');
assert.ok(state.pollingClosesAt > Date.now());

const activePayload = quiz.getParticipantPayload(team1.id);
assert.ok(activePayload.question, 'Question should now be visible to participant');
assert.strictEqual(activePayload.question.order, 1);
assert.strictEqual(activePayload.correctOption, undefined, 'Correct option MUST NOT be visible during polling');
console.log('✔ Verified POLLING_ACTIVE reveals question but shields correct answer');

// 7. Test Answer Submissions
// Team 1 submits B (correct)
const sub1 = quiz.submitAnswer({ teamCode: 'TEAM-001', selectedOption: 'B' });
assert.strictEqual(sub1.success, true);
assert.strictEqual(sub1.selectedOption, 'B');

// Team 2 submits A (incorrect)
const sub2 = quiz.submitAnswer({ teamCode: 'TEAM-002', selectedOption: 'A' });
assert.strictEqual(sub2.success, true);
assert.strictEqual(sub2.selectedOption, 'A');

// Team 3 submits B (correct, later than Team 1)
const sub3 = quiz.submitAnswer({ teamCode: 'TEAM-003', selectedOption: 'b' });
assert.strictEqual(sub3.success, true);
assert.strictEqual(sub3.selectedOption, 'B');

// Duplicate submission attempt by Team 1 must fail
assert.throws(() => {
  quiz.submitAnswer({ teamCode: 'TEAM-001', selectedOption: 'C' });
}, /ALREADY_SUBMITTED/, 'Must reject duplicate submission by same team');
console.log('✔ Verified duplicate submission rejection');

// 8. Test Polling Close
quiz.closePolling();
state = quiz.getCurrentState();
assert.strictEqual(state.state, 'POLLING_CLOSED');

// Submission after close must fail
assert.throws(() => {
  quiz.submitAnswer({ teamCode: 'TEAM-004', selectedOption: 'B' });
}, /POLL_CLOSED/, 'Must reject submission when polling is closed');
console.log('✔ Verified post-deadline submission rejection');

// 9. Test Reveal Answer
quiz.revealAnswer();
state = quiz.getCurrentState();
assert.strictEqual(state.state, 'ANSWER_REVEALED');
const revealedPayload = quiz.getParticipantPayload(team1.id);
assert.strictEqual(revealedPayload.correctOption, 'B');
console.log('✔ Verified correct answer revealed accurately after host action');

// 10. Test Winner Determination
quiz.checkWinner();
state = quiz.getCurrentState();
assert.strictEqual(state.state, 'WINNER_CHECKED');

const hostPayload = quiz.getHostPayload();
assert.strictEqual(hostPayload.winnerInfo.hasWinner, true);
assert.strictEqual(hostPayload.winnerInfo.winner.teamCode, 'TEAM-001', 'Team 1 must win as fastest correct submission');
assert.strictEqual(hostPayload.winnerInfo.correctSubmissions.length, 2, 'Two teams submitted correct answer');
console.log('✔ Verified fastest correct submission selected as winner (TEAM-001)');

// 11. Test Next Question
quiz.nextQuestion();
state = quiz.getCurrentState();
assert.strictEqual(state.currentQuestionIndex, 1);
assert.strictEqual(state.state, 'QUESTION_PREPARED');
console.log('✔ Verified transition to Question 2 in QUESTION_PREPARED state');

// 12. Test Cumulative Leaderboard
const leaderboard = dbHelpers.getCumulativeLeaderboard();
const team1Score = leaderboard.find(t => t.team_code === 'TEAM-001');
const team2Score = leaderboard.find(t => t.team_code === 'TEAM-002');
assert.strictEqual(team1Score.points, 1);
assert.strictEqual(team2Score.points, 0);
assert.strictEqual(team1Score.round_wins, 1);
console.log('✔ Verified cumulative scoring leaderboard logic');

// 13. Test Admin Team Unregistration
const unreg = quiz.unregisterTeam('TEAM-001');
assert.ok(unreg, 'Team 1 unregistration should succeed');
const checkDeleted = dbHelpers.getTeamByCode('TEAM-001');
assert.strictEqual(checkDeleted, undefined, 'TEAM-001 should be deleted from DB');
console.log('✔ Verified admin unregisterTeam removes team and submissions');

// Clean up test state
quiz.stopTimer();
dbHelpers.resetQuiz();

console.log('\nALL 13 TESTS PASSED PERFECTLY!\n');
