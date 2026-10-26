import { useEffect, useRef } from 'react';

export default function MessageList({ messages, conversationId }) {
  const list = useRef(null);
  const followLatest = useRef(true);

  useEffect(() => { followLatest.current = true; }, [conversationId]);
  useEffect(() => {
    if (followLatest.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, conversationId]);

  function trackScroll() {
    const element = list.current;
    followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }

  return (
    <div className="messages" ref={list} onScroll={trackScroll} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions">
      {messages.length === 0 && <p className="empty">No messages yet. Start the conversation.</p>}
      {messages.map((message) => (
        <article className="message" key={message.id}>
          <header>
            <strong>{message.username}</strong>
            <time dateTime={message.timestamp} title={new Date(message.timestamp).toLocaleString()}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </time>
          </header>
          <p>{message.text}</p>
        </article>
      ))}
    </div>
  );
}
