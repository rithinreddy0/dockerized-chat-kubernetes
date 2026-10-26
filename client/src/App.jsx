import { useRef, useState } from 'react';
import JoinForm from './JoinForm.jsx';
import MessageList from './MessageList.jsx';
import useChat from './useChat.js';

export default function App() {
  const chat = useChat();
  const [draft, setDraft] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const input = useRef(null);
  const connected = chat.status === 'Connected';
  const canUse = connected && chat.registered && !chat.busy;
  const people = chat.users.filter((user) => user.id !== chat.me?.id)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
  const selectedPerson = chat.active?.type === 'direct' ? people.find((user) => user.id === chat.active.id) : null;

  async function choose(target) {
    chat.type('');
    if (await chat.open(target)) setDraft('');
    input.current?.focus();
  }
  async function submitMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !canUse || chat.sending) return;
    if (await chat.send(text)) {
      setDraft((current) => current.trim() === text ? '' : current);
      input.current?.focus();
    }
  }
  async function submitGroup(event) {
    event.preventDefault(); setCreating(true);
    if (await chat.createGroup(groupName.trim())) { setShowGroupForm(false); setGroupName(''); setDraft(''); }
    setCreating(false);
  }
  function conversationButton(target, label, status) {
    const count = chat.unreadFor(target);
    const selected = chat.active?.type === target.type && chat.active?.id === target.id;
    return <button key={target.id} className={selected ? 'selected' : ''} disabled={!canUse || chat.sending}
      aria-current={selected ? 'true' : undefined} onClick={() => { void choose(target); }}>
      <span className="contact-name">{label}</span>
      {status && <small>{status}</small>}
      {count > 0 && <span className="unread" aria-label={`${count} unread messages`}>{count}</span>}
    </button>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Course Chat</h1>
        <span className={`connection ${connected ? 'connected' : ''}`} role="status">{chat.status}</span>
        {chat.me && <div className="account"><span>{chat.me.username}</span>
          <button disabled={!canUse || creating} onClick={() => setShowGroupForm(!showGroupForm)}>New group</button>
          <button onClick={() => { chat.leave(); setDraft(''); setShowGroupForm(false); }}>Leave</button>
        </div>}
      </header>
      {chat.error && <p className="error" role="alert">{chat.error}</p>}
      {!chat.me ? <JoinForm connected={connected} busy={chat.busy} onJoin={chat.join} /> : <>
        {showGroupForm && <form className="group-form" onSubmit={submitGroup}>
          <label htmlFor="group-name">Group name</label>
          <input id="group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} minLength={2} maxLength={30} autoFocus required />
          <button className="primary" disabled={!canUse || creating}>{creating ? 'Creating…' : 'Create'}</button>
          <button type="button" onClick={() => setShowGroupForm(false)}>Cancel</button>
          <small>Groups are open to everyone using this app.</small>
        </form>}
        <div className="mobile-picker">
          <label htmlFor="conversation">Conversation</label>
          <select id="conversation" disabled={!canUse || chat.sending} value={chat.active ? `${chat.active.type}|${chat.active.id}` : ''}
            onChange={(event) => { const [type, id] = event.target.value.split('|'); if (id) void choose({ type, id }); }}>
            <option value="">Choose a person or group</option>
            <optgroup label="People">{people.map((person) => <option key={person.id} value={`direct|${person.id}`}>{person.username}{person.online ? ' (online)' : ''}{chat.unreadFor({ type: 'direct', id: person.id }) ? ' · unread' : ''}</option>)}</optgroup>
            <optgroup label="Groups">{chat.groups.map((group) => <option key={group.id} value={`group|${group.id}`}>{group.name}{chat.unreadFor({ type: 'group', id: group.id }) ? ' · unread' : ''}</option>)}</optgroup>
          </select>
        </div>
        <div className="chat-layout">
          <aside className="sidebar">
            <h2>People</h2>
            <nav aria-label="People">{people.map((person) => conversationButton({ type: 'direct', id: person.id }, person.username, person.online ? 'Online' : 'Offline'))}</nav>
            {people.length === 0 && <p className="sidebar-note">No other users yet. Open another browser tab to try a direct message.</p>}
            <h2 className="groups-heading">Groups</h2>
            <nav aria-label="Groups">{chat.groups.map((group) => conversationButton({ type: 'group', id: group.id }, group.name))}</nav>
            <details className="server-details"><summary>Server details</summary><p>Replica: <code>{chat.server?.instance || '—'}</code></p><p>Version: {chat.server?.version || '—'}</p></details>
          </aside>
          <main className="chat-panel">
            {chat.active ? <>
              <header className="room-header"><div><h2>{selectedPerson?.username || chat.active.name}</h2>
                <p>{chat.active.type === 'direct' ? `Direct message · ${selectedPerson?.online ? 'Online' : 'Offline'}` : 'Group chat · Open to everyone'}</p></div>
                {chat.busy && <span>Loading…</span>}
              </header>
              <MessageList messages={chat.messages} conversationId={chat.active.conversationId} />
              <form className="message-form" onSubmit={submitMessage}>
                <div className="typing" aria-live="polite">{chat.typing.length > 0 && `${chat.typing.slice(0, 2).join(', ')} ${chat.typing.length > 1 ? 'are' : 'is'} typing…`}</div>
                <label htmlFor="message">Message</label>
                <div className="message-input">
                  <textarea id="message" ref={input} rows={2} maxLength={1000} value={draft} disabled={!canUse}
                    placeholder={canUse ? 'Write a message' : 'Waiting for connection…'}
                    onChange={(event) => { setDraft(event.target.value); chat.type(event.target.value); }}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} />
                  <button className="primary" disabled={!canUse || chat.sending || !draft.trim()}>{chat.sending ? 'Sending…' : 'Send'}</button>
                </div>
                <div className="input-help"><span>Enter to send · Shift + Enter for a new line</span><span>{draft.length}/1000</span></div>
              </form>
            </> : <div className="choose-conversation"><h2>Select a conversation</h2><p>Choose a person for a direct message, or open a group chat.</p></div>}
          </main>
        </div>
      </>}
    </div>
  );
}
