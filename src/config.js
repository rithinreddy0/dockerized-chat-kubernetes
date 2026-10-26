export const HISTORY_LIMIT = 100;
export const HISTORY_TTL = 60 * 60 * 24;

export function validateName(value, label = 'Display name', max = 24) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > max || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error(`${label} must be 2–${max} characters without control characters.`);
  }
  return name;
}

export function validateMessage(value) {
  const text = typeof value?.text === 'string' ? value.text.trim() : '';
  if (!text || text.length > 1000) throw new Error('Messages must contain 1–1000 characters.');
  return text;
}

export function directId(first, second) {
  return `direct:${[first, second].sort().join(':')}`;
}

export function makeLimiter(limit = 8, windowMs = 5000) {
  let timestamps = [];
  return (now = Date.now()) => {
    timestamps = timestamps.filter((time) => now - time < windowMs);
    if (timestamps.length >= limit) return false;
    timestamps.push(now);
    return true;
  };
}
