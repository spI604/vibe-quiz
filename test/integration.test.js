const { io } = require('socket.io-client');
const assert = require('assert');

console.log('--- STARTING LIVE WEBSOCKET INTEGRATION TEST ---\n');

const SERVER_URL = 'http://localhost:3000';

async function runIntegrationTest() {
  // 1. Connect Host Socket
  const hostSocket = io(SERVER_URL);
  
  await new Promise((resolve) => {
    hostSocket.on('connect', resolve);
  });
  console.log('✔ Host socket connected');

  // Authenticate Host
  const authRes = await new Promise((resolve) => {
    hostSocket.emit('host_auth', { password: '9999' }, resolve);
  });
  assert.strictEqual(authRes.success, true, 'Host authentication should succeed');
  console.log('✔ Host authenticated successfully');

  // Reset quiz to WAITING for a clean test run
  await new Promise((resolve) => {
    hostSocket.emit('host_reset_quiz', {}, resolve);
  });

  // 2. Connect Participant Sockets (TEAM-001 & TEAM-002)
  const p1Socket = io(SERVER_URL);
  const p2Socket = io(SERVER_URL);

  await Promise.all([
    new Promise(r => p1Socket.on('connect', r)),
    new Promise(r => p2Socket.on('connect', r))
  ]);
  console.log('✔ Participant 1 & 2 sockets connected');

  // Join participants
  const p1Join = await new Promise(r => p1Socket.emit('participant_join', { teamCode: 'TEAM-001' }, r));
  const p2Join = await new Promise(r => p2Socket.emit('participant_join', { teamCode: 'TEAM-002' }, r));
  assert.strictEqual(p1Join.success, true);
  assert.strictEqual(p2Join.success, true);
  console.log('✔ Participants joined sessions as TEAM-001 and TEAM-002');

  // 3. Host starts quiz
  const startRes = await new Promise(r => hostSocket.emit('host_start_quiz', {}, r));
  assert.strictEqual(startRes.success, true);
  assert.strictEqual(startRes.payload.state, 'QUESTION_PREPARED');
  console.log('✔ Host started quiz -> state is QUESTION_PREPARED');

  // 4. Host reveals question
  const revealRes = await new Promise(r => hostSocket.emit('host_reveal_question', {}, r));
  assert.strictEqual(revealRes.success, true);
  assert.strictEqual(revealRes.payload.state, 'POLLING_ACTIVE');
  console.log('✔ Host revealed question -> state is POLLING_ACTIVE, 60s timer running');

  // 5. Participants submit answers
  // TEAM-001 submits 'B' (correct)
  const sub1 = await new Promise(r => p1Socket.emit('submit_answer', { selectedOption: 'B', teamCode: 'TEAM-001' }, r));
  assert.strictEqual(sub1.success, true);
  assert.strictEqual(sub1.result.selectedOption, 'B');

  // TEAM-002 submits 'B' (correct, slightly later)
  await new Promise(r => setTimeout(r, 50));
  const sub2 = await new Promise(r => p2Socket.emit('submit_answer', { selectedOption: 'B', teamCode: 'TEAM-002' }, r));
  assert.strictEqual(sub2.success, true);
  console.log('✔ Submissions received: TEAM-001 and TEAM-002');

  // 6. Host closes polling
  const closeRes = await new Promise(r => hostSocket.emit('host_close_polling', {}, r));
  assert.strictEqual(closeRes.success, true);
  console.log('✔ Polling closed on server');

  // 7. Host reveals answer
  const answerRes = await new Promise(r => hostSocket.emit('host_reveal_answer', {}, r));
  assert.strictEqual(answerRes.success, true);
  assert.strictEqual(answerRes.payload.state, 'ANSWER_REVEALED');
  console.log('✔ Host revealed answer -> Option B displayed as correct');

  // 8. Host checks winner
  const winnerRes = await new Promise(r => hostSocket.emit('host_check_winner', {}, r));
  assert.strictEqual(winnerRes.success, true);
  assert.strictEqual(winnerRes.payload.state, 'WINNER_CHECKED');
  assert.strictEqual(winnerRes.payload.winnerInfo.hasWinner, true);
  assert.strictEqual(winnerRes.payload.winnerInfo.winner.teamCode, 'TEAM-001', 'TEAM-001 was earliest correct submission');
  console.log(`✔ Winner declared: ${winnerRes.payload.winnerInfo.winner.teamCode} (${winnerRes.payload.winnerInfo.winner.timeFormatted})`);

  // 9. Host advances to next question
  const nextRes = await new Promise(r => hostSocket.emit('host_next_question', {}, r));
  assert.strictEqual(nextRes.success, true);
  assert.strictEqual(nextRes.payload.currentQuestionIndex, 1);
  assert.strictEqual(nextRes.payload.state, 'QUESTION_PREPARED');
  console.log('✔ Next Question 2 prepared on host stage');

  // Disconnect all sockets
  hostSocket.disconnect();
  p1Socket.disconnect();
  p2Socket.disconnect();

  console.log('\nFULL WEBSOCKET INTEGRATION TEST COMPLETED SUCCESSFULLY!\n');
  process.exit(0);
}

runIntegrationTest().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
