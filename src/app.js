import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { HISTORY_LIMIT, HISTORY_TTL, directId, makeLimiter, validateName, validateMessage } from './config.js';

const buildPath = fileURLToPath(new URL('../dist', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startChat(options = {}) {
  const port = options.port ?? Number(process.env.PORT || 3000);
  const instance = options.instance ?? process.env.INSTANCE_ID ?? hostname();
  const version = options.version ?? process.env.APP_VERSION ?? '1.0.0';
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const prefix = options.prefix ?? 'course-chat-v2';
  const key = (name) => `${prefix}:${name}`;
  const redis = createClient({ url: redisUrl, disableOfflineQueue: true,
    socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 3000) } });
  const pub = redis.duplicate();
  const sub = redis.duplicate();
  const clients = [redis, pub, sub];
  for (const client of clients) client.on('error', (err) => console.error(`[${instance}] Redis: ${err.message}`));
  let startupTimer;
  try {
    await Promise.race([
      Promise.all(clients.map((client) => client.connect())),
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('Redis startup timed out')), 15000); })
    ]);
    await redis.hSetNX(key('groups'), 'general', JSON.stringify({ id: 'general', name: 'General' }));
  } catch (error) {
    clients.forEach((client) => { if (client.isOpen) client.destroy(); });
    throw error;
  } finally { clearTimeout(startupTimer); }

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
    next();
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, { transports: ['websocket'], maxHttpBufferSize: 8192, serveClient: false });
  io.adapter(createAdapter(pub, sub, { key: key('adapter'), requestsTimeout: 3000 }));
  let draining = false;
  let redisHealthy = true;
  const ready = () => !draining && redisHealthy && clients.every((client) => client.isReady);
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', (_req, res) => res.status(ready() ? 200 : 503).json({ status: ready() ? 'ready' : 'unavailable' }));
  app.get('/api/info', (_req, res) => res.json({ instance, version, redis: ready() ? 'connected' : 'unavailable' }));
  app.use(express.static(buildPath));

  async function directory() {
    const [profiles, groups, sockets] = await Promise.all([
      redis.hGetAll(key('users')), redis.hGetAll(key('groups')), io.in('registered').fetchSockets()
    ]);
    const online = new Set(sockets.map((socket) => socket.data.userId));
    return {
      users: Object.values(profiles).map((item) => { const user = JSON.parse(item); return { ...user, online: online.has(user.id) }; }),
      groups: Object.values(groups).map((item) => JSON.parse(item))
    };
  }
  async function broadcastDirectory() {
    if (!ready()) return;
    try { io.to('registered').emit('directory:update', await directory()); }
    catch (error) { console.error(`[${instance}] Directory: ${error.message}`); }
  }
  const healthTimer = setInterval(async () => {
    try { redisHealthy = await redis.ping() === 'PONG'; } catch { redisHealthy = false; }
  }, 3000);
  const presenceTimer = setInterval(() => { void broadcastDirectory(); }, 10000);
  healthTimer.unref(); presenceTimer.unref();

  io.use((_socket, next) => next(ready() ? undefined : new Error('Chat is reconnecting. Please try again.')));
  io.on('connection', (socket) => {
    socket.emit('server:info', { instance, version });
    const canSend = makeLimiter();
    const canOpen = makeLimiter(15, 10000);
    const canCreate = makeLimiter(3, 60000);
    const canType = makeLimiter(10, 5000);
    let queue = Promise.resolve();
    function handle(event, action, registrationRequired = true) {
      socket.on(event, (payload, acknowledge) => {
        queue = queue.then(async () => {
          const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
          if (!socket.connected) return;
          try {
            if (!ready()) throw new Error('Chat is temporarily unavailable.');
            if (registrationRequired && !socket.data.userId) throw new Error('Enter a display name first.');
            await action(payload, reply);
          } catch (error) {
            const infrastructure = /redis|socket|connect|timeout|client is closed|offline/i.test(error.message);
            if (infrastructure) console.error(`[${instance}] ${event}: ${error.message}`);
            reply({ ok: false, error: infrastructure ? 'Chat is temporarily unavailable. Please try again.' : error.message });
          }
        }).catch((error) => console.error(`[${instance}] Event: ${error.message}`));
      });
    }

    // The public user ID is a hash of a random private token. Names are not credentials.
    handle('session:join', async (payload, reply) => {
      if (socket.data.userId) throw new Error('This connection already has a session.');
      const username = validateName(payload?.username);
      if (payload?.token !== undefined && !/^[a-f0-9]{64}$/.test(payload.token)) throw new Error('Invalid session. Start a new session.');
      const token = payload?.token || randomBytes(32).toString('hex');
      const userId = createHash('sha256').update(token).digest('hex').slice(0, 32);
      const user = { id: userId, username };
      await redis.hSet(key('users'), userId, JSON.stringify(user));
      socket.data = { userId, username };
      await socket.join(['registered', `user:${userId}`]);
      for (const groupId of await redis.sMembers(key(`user-groups:${userId}`))) await socket.join(`group:${groupId}`);
      reply({ ok: true, user, token, ...await directory(), instance, version });
      void broadcastDirectory();
    }, false);

    async function resolveTarget(target, joinGroup = false) {
      if (target?.type === 'direct') {
        if (!/^[a-f0-9]{32}$/.test(target.id) || target.id === socket.data.userId) throw new Error('Choose another person to message.');
        const profile = await redis.hGet(key('users'), target.id);
        if (!profile) throw new Error('That person is unavailable.');
        return { type: 'direct', id: target.id, conversationId: directId(socket.data.userId, target.id), name: JSON.parse(profile).username };
      }
      if (target?.type === 'group') {
        if (typeof target.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(target.id)) throw new Error('Invalid group.');
        const group = await redis.hGet(key('groups'), target.id);
        if (!group) throw new Error('That group does not exist.');
        const membershipKey = key(`user-groups:${socket.data.userId}`);
        if (joinGroup) {
          await redis.sAdd(membershipKey, target.id);
          await socket.join(`group:${target.id}`);
        } else if (!await redis.sIsMember(membershipKey, target.id)) throw new Error('Open the group before sending a message.');
        return { type: 'group', id: target.id, conversationId: `group:${target.id}`, name: JSON.parse(group).name };
      }
      throw new Error('Select a person or group.');
    }

    handle('conversation:open', async (payload, reply) => {
      if (!canOpen()) throw new Error('Please wait before switching conversations again.');
      const conversation = await resolveTarget(payload, true);
      const history = (await redis.lRange(key(`history:${conversation.conversationId}`), 0, HISTORY_LIMIT - 1)).reverse().map(JSON.parse);
      reply({ ok: true, conversation, history });
    });
    handle('group:create', async (payload, reply) => {
      if (!canCreate()) throw new Error('Please wait before creating another group.');
      const name = validateName(payload?.name, 'Group name', 30);
      const group = { id: randomUUID(), name };
      await redis.hSet(key('groups'), group.id, JSON.stringify(group));
      await redis.sAdd(key(`user-groups:${socket.data.userId}`), group.id);
      await socket.join(`group:${group.id}`);
      reply({ ok: true, group });
      void broadcastDirectory();
    });
    handle('chat:send', async (payload, reply) => {
      if (!canSend()) throw new Error('You are sending quickly. Please wait a few seconds.');
      const text = validateMessage(payload);
      const target = await resolveTarget(payload?.target);
      const message = { id: randomUUID(), conversationId: target.conversationId, type: target.type,
        senderId: socket.data.userId, username: socket.data.username, text,
        timestamp: new Date().toISOString(), instance,
        ...(target.type === 'direct' ? { recipientId: target.id } : { groupId: target.id }) };
      await redis.multi().lPush(key(`history:${target.conversationId}`), JSON.stringify(message))
        .lTrim(key(`history:${target.conversationId}`), 0, HISTORY_LIMIT - 1)
        .expire(key(`history:${target.conversationId}`), HISTORY_TTL).exec();
      if (target.type === 'direct') io.to(`user:${socket.data.userId}`).to(`user:${target.id}`).emit('chat:message', message);
      else io.to(`group:${target.id}`).emit('chat:message', message);
      reply({ ok: true, message });
    });
    handle('chat:typing', async (payload) => {
      if (!canType()) return;
      const target = await resolveTarget(payload?.target);
      const data = { conversationId: target.conversationId, userId: socket.data.userId, username: socket.data.username, active: payload?.active === true };
      if (target.type === 'direct') socket.to(`user:${target.id}`).volatile.emit('chat:typing', data);
      else socket.to(`group:${target.id}`).volatile.emit('chat:typing', data);
    });
    socket.on('disconnect', () => { void broadcastDirectory(); });
  });

  try {
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, '0.0.0.0', resolve); });
  } catch (error) {
    clearInterval(healthTimer); clearInterval(presenceTimer);
    await new Promise((resolve) => io.close(resolve));
    await Promise.all(clients.map((client) => client.isOpen ? client.close() : undefined));
    throw error;
  }
  console.log(`[${instance}] Course Chat ${version} listening on http://localhost:${httpServer.address().port}`);
  let stopping;
  function stop(drainMs = Number(process.env.DRAIN_MS ?? 5000)) {
    stopping ??= (async () => {
      draining = true;
      clearInterval(healthTimer); clearInterval(presenceTimer);
      await sleep(Math.max(0, drainMs));
      await new Promise((resolve) => io.close(resolve));
      await Promise.all(clients.map((client) => client.isOpen ? client.close() : undefined));
    })();
    return stopping;
  }
  return { app, io, httpServer, redis, port: httpServer.address().port, stop };
}
