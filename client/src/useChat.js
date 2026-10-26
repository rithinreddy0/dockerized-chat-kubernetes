import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const recent = (messages) => [...new Map(messages.map((message) => [message.id, message])).values()].slice(-100);
function savedSession() {
  try { return JSON.parse(sessionStorage.getItem('course-chat-session')); } catch { return null; }
}
function conversationId(target, userId) {
  return target.type === 'group' ? `group:${target.id}` : `direct:${[target.id, userId].sort().join(':')}`;
}

export default function useChat() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState({});
  const [typing, setTyping] = useState([]);
  const [server, setServer] = useState(null);
  const [status, setStatus] = useState('Connecting');
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef(null);
  // Socket callbacks read these refs rather than stale render values.
  const current = useRef({ credentials: savedSession(), me: null, active: null, registered: false, busy: false, generation: 0 });
  const pending = useRef(null);
  const typists = useRef(new Map());
  const lastTyping = useRef(0);
  const typingTimeout = useRef(null);

  function refreshTyping() {
    for (const [id, person] of typists.current) if (Date.now() - person.time > 2500) typists.current.delete(id);
    setTyping([...typists.current.values()].map((person) => person.username));
  }
  function applyDirectory(data) { setUsers(data.users); setGroups(data.groups); }

  async function open(target) {
    const state = current.current;
    if (!state.registered || state.busy) return;
    state.busy = true; setBusy(true); setError('');
    const generation = state.generation;
    const waiting = { id: conversationId(target, state.me.id), messages: [] };
    pending.current = waiting;
    try {
      const result = await socketRef.current.timeout(6000).emitWithAck('conversation:open', target);
      if (generation !== state.generation) return;
      if (!result.ok) throw new Error(result.error);
      state.active = result.conversation;
      setActive(result.conversation);
      setMessages(recent([...result.history, ...waiting.messages]));
      setUnread((previous) => ({ ...previous, [waiting.id]: 0 }));
      typists.current.clear(); setTyping([]);
      return true;
    } catch (err) {
      if (generation === state.generation) setError(err.message === 'operation has timed out' ? 'Could not open the conversation. Please try again.' : err.message);
      return false;
    } finally {
      pending.current = null; state.busy = false; setBusy(false);
      if (generation !== state.generation && socketRef.current?.connected && state.credentials && !state.registered) {
        queueMicrotask(() => { void join(state.credentials.username, state.credentials.token); });
      }
    }
  }

  async function join(username, token) {
    const state = current.current;
    if (state.busy) return;
    state.busy = true; setBusy(true); setError('');
    const generation = state.generation;
    try {
      if (!socketRef.current?.connected) throw new Error('Waiting for the server. Please try again.');
      const result = await socketRef.current.timeout(6000).emitWithAck('session:join', { username, ...(token ? { token } : {}) });
      if (generation !== state.generation) return;
      if (!result.ok) throw new Error(result.error);
      state.me = result.user; state.registered = true;
      state.credentials = { username: result.user.username, token: result.token };
      try { sessionStorage.setItem('course-chat-session', JSON.stringify(state.credentials)); } catch { /* Reconnect still works within this page. */ }
      setMe(result.user); setRegistered(true); setServer(result); applyDirectory(result);
    } catch (err) {
      if (generation !== state.generation) return;
      setError(err.message === 'operation has timed out' ? 'Sign-in timed out. Reconnecting…' : err.message);
      if (err.message === 'operation has timed out') { socketRef.current.disconnect(); socketRef.current.connect(); }
    } finally {
      state.busy = false; setBusy(false);
      if (generation === state.generation && state.registered && state.active) void open(state.active);
      else if (generation !== state.generation && socketRef.current?.connected && state.credentials && !state.registered) {
        queueMicrotask(() => { void join(state.credentials.username, state.credentials.token); });
      }
    }
  }

  useEffect(() => {
    const socket = io({ transports: ['websocket'], autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    socketRef.current = socket;
    socket.on('connect', () => {
      setStatus('Connected'); setError('');
      const credentials = current.current.credentials;
      if (credentials) void join(credentials.username, credentials.token);
    });
    socket.on('server:info', setServer);
    socket.on('connect_error', () => setStatus('Server unavailable'));
    socket.on('disconnect', () => {
      current.current.generation++; current.current.registered = false;
      setRegistered(false); setStatus('Reconnecting');
      setUsers((previous) => previous.map((user) => ({ ...user, online: false })));
      typists.current.clear(); setTyping([]);
    });
    socket.on('directory:update', applyDirectory);
    socket.on('chat:message', (message) => {
      const state = current.current;
      if (!state.registered) return;
      if (pending.current?.id === message.conversationId) pending.current.messages.push(message);
      else if (state.active?.conversationId === message.conversationId) setMessages((previous) => recent([...previous, message]));
      if (state.active?.conversationId !== message.conversationId && message.senderId !== state.me.id) {
        setUnread((previous) => ({ ...previous, [message.conversationId]: (previous[message.conversationId] || 0) + 1 }));
      }
      typists.current.delete(message.senderId); refreshTyping();
    });
    socket.on('chat:typing', (data) => {
      if (data.conversationId !== current.current.active?.conversationId) return;
      if (data.active) typists.current.set(data.userId, { username: data.username, time: Date.now() });
      else typists.current.delete(data.userId);
      refreshTyping();
    });
    const timer = setInterval(refreshTyping, 750);
    socket.connect();
    return () => {
      clearInterval(timer); clearTimeout(typingTimeout.current);
      socket.removeAllListeners(); socket.disconnect();
    };
  }, []);

  async function send(text) {
    const state = current.current;
    if (!state.registered || !state.active || state.busy || sending) return false;
    const generation = state.generation;
    setSending(true); setError('');
    try {
      const result = await socketRef.current.timeout(6000).emitWithAck('chat:send', { target: state.active, text });
      if (generation !== state.generation) return false;
      if (!result.ok) throw new Error(result.error);
      if (state.active?.conversationId === result.message.conversationId) setMessages((previous) => recent([...previous, result.message]));
      type('');
      return true;
    } catch (err) {
      if (generation === state.generation) setError(err.message === 'operation has timed out' ? 'Delivery was not confirmed. Check the conversation before retrying.' : err.message);
      return false;
    } finally { setSending(false); }
  }

  function type(text) {
    const state = current.current;
    const socket = socketRef.current;
    if (!state.registered || !state.active || !socket.connected) return;
    clearTimeout(typingTimeout.current);
    const target = state.active;
    if (!text.trim() || Date.now() - lastTyping.current > 900) {
      socket.emit('chat:typing', { target, active: Boolean(text.trim()) }); lastTyping.current = Date.now();
    }
    typingTimeout.current = setTimeout(() => { if (socket.connected) socket.emit('chat:typing', { target, active: false }); }, 1400);
  }

  async function createGroup(name) {
    if (!current.current.registered || current.current.busy) return false;
    setError('');
    try {
      const result = await socketRef.current.timeout(6000).emitWithAck('group:create', { name });
      if (!result.ok) throw new Error(result.error);
      setGroups((previous) => previous.some((group) => group.id === result.group.id) ? previous : [...previous, result.group]);
      await open({ type: 'group', id: result.group.id });
      return true;
    } catch (err) { setError(err.message === 'operation has timed out' ? 'Group creation was not confirmed. Check the group list before retrying.' : err.message); return false; }
  }

  function leave() {
    const state = current.current;
    state.credentials = null; state.me = null; state.active = null; state.registered = false;
    try { sessionStorage.removeItem('course-chat-session'); } catch { /* Optional. */ }
    setMe(null); setActive(null); setMessages([]); setUnread({}); setRegistered(false); setError('');
    socketRef.current.disconnect(); socketRef.current.connect();
  }

  return { me, users, groups, active, messages, unread, typing, server, status, registered, busy, sending, error,
    join, open, send, type, createGroup, leave,
    unreadFor: (target) => me ? unread[conversationId(target, me.id)] || 0 : 0 };
}
