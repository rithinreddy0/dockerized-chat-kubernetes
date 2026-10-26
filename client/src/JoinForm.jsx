import { useState } from 'react';

export default function JoinForm({ connected, busy, onJoin }) {
  const [name, setName] = useState('');
  return (
    <form className="join-form" onSubmit={(event) => { event.preventDefault(); onJoin(name.trim()); }}>
      <h2>Start chatting</h2>
      <p>Enter your name. Then choose a person or a group.</p>
      <label htmlFor="name">Display name</label>
      <input id="name" value={name} onChange={(event) => setName(event.target.value)}
        minLength={2} maxLength={24} autoComplete="nickname" autoFocus required />
      <button className="primary" disabled={!connected || busy || name.trim().length < 2}>{busy ? 'Connecting…' : 'Continue'}</button>
      <small>Your session stays active in this tab. Display names are not verified identities.</small>
    </form>
  );
}
