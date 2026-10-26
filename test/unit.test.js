import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseAllDocuments } from 'yaml';
import { validateName, validateMessage, directId, makeLimiter } from '../src/config.js';

test('display names and group names reject malformed values', () => {
  assert.equal(validateName('  Alex  '), 'Alex');
  for (const value of [null, {}, 'A', 'x'.repeat(25), 'A\nB']) assert.throws(() => validateName(value));
  assert.equal(validateName('Project team', 'Group name', 30), 'Project team');
  assert.throws(() => validateName('x'.repeat(31), 'Group name', 30));
});
test('direct conversation IDs are symmetric and unique to each pair', () => {
  assert.equal(directId('alice', 'bob'), directId('bob', 'alice'));
  assert.notEqual(directId('alice', 'bob'), directId('eve', 'bob'));
});
test('messages preserve plain text and enforce meaningful length limits', () => {
  assert.equal(validateMessage({ text: '  <script>alert(1)</script>  ' }), '<script>alert(1)</script>');
  assert.equal(validateMessage({ text: 'hi\nthere' }), 'hi\nthere');
  assert.equal(validateMessage({ text: 'a'.repeat(1000) }).length, 1000);
  for (const value of [null, {}, { text: '   ' }, { text: 12 }, { text: 'a'.repeat(1001) }]) assert.throws(() => validateMessage(value));
});
test('rate limiter caps a burst and recovers after the window', () => {
  const allowed = makeLimiter(2, 1000);
  assert.equal(allowed(0), true); assert.equal(allowed(1), true); assert.equal(allowed(999), false);
  assert.equal(allowed(1000), true); assert.equal(allowed(1001), true); assert.equal(allowed(1002), false);
});
test('deployment manifests have matching selectors, real probes, Redis DNS and two replicas', () => {
  const docs = readdirSync(new URL('../k8s/', import.meta.url)).flatMap((name) => {
    const source = readFileSync(new URL(`../k8s/${name}`, import.meta.url), 'utf8');
    return parseAllDocuments(source).map((doc) => { assert.equal(doc.errors.length, 0); return doc.toJSON(); });
  });
  const chat = docs.find((doc) => doc.kind === 'Deployment' && doc.metadata.name === 'chat');
  const service = docs.find((doc) => doc.kind === 'Service' && doc.metadata.name === 'chat');
  const container = chat.spec.template.spec.containers[0];
  assert.deepEqual(service.spec.selector, chat.spec.template.metadata.labels);
  assert.deepEqual(chat.spec.selector.matchLabels, chat.spec.template.metadata.labels);
  assert.equal(chat.spec.replicas, 2); assert.equal(chat.spec.strategy.rollingUpdate.maxUnavailable, 0);
  assert.equal(container.readinessProbe.httpGet.path, '/health/ready');
  assert.equal(container.livenessProbe.httpGet.path, '/health/live');
  assert.equal(service.spec.ports[0].targetPort, container.ports[0].name);
  assert.equal(docs.find((doc) => doc.kind === 'ConfigMap').data.REDIS_URL, 'redis://redis:6379');
  assert.ok(docs.some((doc) => doc.kind === 'PersistentVolumeClaim'));
});
