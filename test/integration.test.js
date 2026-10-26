import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { startChat } from '../src/app.js';

const redisUrl = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';
const event = (socket, name, predicate = () => true, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)); }, timeout);
  function handler(value) { if (predicate(value)) { clearTimeout(timer); socket.off(name, handler); resolve(value); } }
  socket.on(name, handler);
});
const ack = (socket, name, payload) => socket.timeout(5000).emitWithAck(name, payload);

test('direct and group chat work across replicas with private delivery, session recovery and shared history', { timeout: 40000 }, async (t) => {
  const prefix = `chat-test:${randomUUID()}`;
  const servers = []; const sockets = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    if (servers[0]?.redis.isReady) {
      const keys = await servers[0].redis.keys(`${prefix}:*`);
      if (keys.length) await servers[0].redis.del(keys);
    }
    await Promise.all(servers.map((server) => server.stop(0)));
  });
  const a = await startChat({ port: 0, redisUrl, prefix, instance: 'replica-a' }); servers.push(a);
  const b = await startChat({ port: 0, redisUrl, prefix, instance: 'replica-b' }); servers.push(b);
  async function client(port) {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], autoConnect: false, reconnectionDelay: 100 });
    sockets.push(socket); const connected = event(socket, 'connect'); socket.connect(); await connected; return socket;
  }
  const alice = await client(a.port); const bob = await client(b.port); const eve = await client(b.port);
  assert.equal((await fetch(`http://127.0.0.1:${a.port}/health/ready`)).status, 200);
  assert.match(await (await fetch(`http://127.0.0.1:${a.port}/`)).text(), /Course Chat/);
  assert.equal((await ack(alice, 'chat:send', { text: 'before session' })).ok, false);
  assert.equal((await ack(alice, 'session:join', { username: 'A' })).ok, false);
  const aliceSession = await ack(alice, 'session:join', { username: 'Alice' });
  const bobSession = await ack(bob, 'session:join', { username: 'Bob' });
  const eveSession = await ack(eve, 'session:join', { username: 'Eve' });
  assert.equal(bobSession.users.find((user) => user.id === aliceSession.user.id).online, true);
  assert.equal(eveSession.users.some((user) => Object.hasOwn(user, 'token')), false);
  assert.match(aliceSession.token, /^[a-f0-9]{64}$/);
  const toBob = { type: 'direct', id: bobSession.user.id };
  const toAlice = { type: 'direct', id: aliceSession.user.id };
  const opened = await ack(alice, 'conversation:open', toBob);
  assert.equal(opened.history.length, 0);
  const gotDM = event(bob, 'chat:message');
  const noLeak = assert.rejects(event(eve, 'chat:message', () => true, 300), /Timed out/);
  const sent = await ack(alice, 'chat:send', { target: toBob, text: 'Hello Bob', senderId: eveSession.user.id });
  assert.equal(sent.ok, true);
  assert.equal(sent.message.senderId, aliceSession.user.id);
  assert.equal(sent.message.instance, 'replica-a');
  assert.deepEqual(await gotDM, sent.message);
  await noLeak;
  const bobHistory = await ack(bob, 'conversation:open', toAlice);
  assert.equal(bobHistory.history[0].id, sent.message.id);
  const eveHistory = await ack(eve, 'conversation:open', { ...toBob, conversationId: opened.conversation.conversationId });
  assert.notEqual(eveHistory.conversation.conversationId, opened.conversation.conversationId);
  assert.equal(eveHistory.history.length, 0);
  assert.equal((await ack(alice, 'chat:send', { target: toBob, text: 'a'.repeat(1001) })).ok, false);
  assert.equal((await ack(alice, 'conversation:open', { type: 'direct', id: aliceSession.user.id })).ok, false);
  const typing = event(bob, 'chat:typing', (data) => data.active);
  alice.emit('chat:typing', { target: toBob, active: true });
  assert.equal((await typing).userId, aliceSession.user.id);

  assert.equal((await ack(alice, 'group:create', { name: 'X' })).ok, false);
  const created = await ack(alice, 'group:create', { name: 'Project team' });
  assert.equal(created.ok, true);
  const group = { type: 'group', id: created.group.id };
  assert.equal((await ack(eve, 'chat:send', { target: group, text: 'Not a member' })).ok, false);
  assert.equal((await ack(bob, 'conversation:open', group)).ok, true);
  const gotGroup = event(bob, 'chat:message', (message) => message.type === 'group');
  const groupNoLeak = assert.rejects(event(eve, 'chat:message', () => true, 300), /Timed out/);
  const groupSent = await ack(alice, 'chat:send', { target: group, text: '<b>Group message</b>' });
  assert.equal((await gotGroup).text, '<b>Group message</b>');
  await groupNoLeak;
  // Groups are intentionally open: someone who explicitly opens one may read its history.
  const joinedGroup = await ack(eve, 'conversation:open', group);
  assert.equal(joinedGroup.history[0].id, groupSent.message.id);

  const historyKey = `${prefix}:history:${opened.conversation.conversationId}`;
  await a.redis.del(historyKey);
  const batch = a.redis.multi();
  for (let i = 0; i < 110; i++) batch.lPush(historyKey, JSON.stringify({ ...sent.message, id: String(i) }));
  await batch.exec();
  await ack(alice, 'chat:send', { target: toBob, text: 'Trim history' });
  assert.equal(await a.redis.lLen(historyKey), 100);
  assert.ok(await a.redis.ttl(historyKey) > 0);

  const disconnected = event(bob, 'disconnect');
  const stopping = b.stop(100);
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/health/ready`)).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/health/live`)).status, 200);
  await stopping; await disconnected;
  bob.disconnect(); eve.disconnect();
  const resumed = await client(a.port);
  const resumedSession = await ack(resumed, 'session:join', { username: 'Bob', token: bobSession.token });
  assert.equal(resumedSession.user.id, bobSession.user.id);
  const restored = await ack(resumed, 'conversation:open', toAlice);
  assert.equal(restored.history.length, 100);
  const restoredGroup = event(resumed, 'chat:message', (message) => message.type === 'group');
  await ack(alice, 'chat:send', { target: group, text: 'Group membership survived reconnect' });
  assert.equal((await restoredGroup).text, 'Group membership survived reconnect');
});
