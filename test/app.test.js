'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../store');
const { createServer } = require('../server');

const H = 3600_000;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tt-')), 'db.json');
function make(file = tmp()) {
  const clock = { t: Date.UTC(2026, 0, 5, 9) };
  return { store: new Store(file, () => clock.t), clock, file };
}

test('adding an employee: whitespace is normalized, empty and duplicate names are rejected', () => {
  const { store } = make();
  assert.equal(store.addEmployee('  Anna   Orlova ').name, 'Anna Orlova');
  assert.throws(() => store.addEmployee('   '), { status: 400 });
  assert.throws(() => store.addEmployee('anna orlova'), { status: 409 });
});

test('timer: start, stop, and the duration shows up in the report', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Anna Orlova');
  store.startTimer(a.id, 'Layout');
  clock.t += 2 * H + 30 * 60_000;
  store.stopTimer(a.id);
  const r = store.report(clock.t - 24 * H, clock.t + H);
  assert.equal(r.employees[0].totalMs, 2.5 * H);
  assert.equal(r.totalMs, 2.5 * H);
});

test('starting a timer twice for the same employee is rejected and the first entry is untouched', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Anna Orlova');
  store.startTimer(a.id, 'Task 1');
  assert.throws(() => store.startTimer(a.id, 'Task 2'), { status: 409, code: 'timer_running' });
  assert.equal(store.data.entries.length, 1);
  assert.equal(store.running(a.id).task, 'Task 1');
  clock.t += H;
  store.stopTimer(a.id);
  store.startTimer(a.id, 'Task 2'); // allowed again after stopping
  assert.equal(store.data.entries.length, 2);
});

test('stopping without a running timer, an empty task, and an unknown employee are rejected', () => {
  const { store } = make();
  const a = store.addEmployee('Boris Vetrov');
  assert.throws(() => store.stopTimer(a.id), { status: 409 });
  assert.throws(() => store.startTimer(a.id, '  '), { status: 400 });
  assert.throws(() => store.startTimer('no-such-id', 'x'), { status: 404 });
});

test('empty report: no employees; a period without entries', () => {
  const { store, clock } = make();
  assert.deepEqual(store.report(0, H).employees, []);
  const a = store.addEmployee('Anna Orlova');
  store.startTimer(a.id, 'Layout'); clock.t += H; store.stopTimer(a.id);
  const r = store.report(clock.t + 10 * H, clock.t + 20 * H);
  assert.equal(r.totalMs, 0);
  assert.deepEqual(r.employees[0].entries, []);
});

test('period: an entry on the boundary counts partially, the end is exclusive', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Anna Orlova');
  const start = clock.t;
  store.startTimer(a.id, 'Night task'); clock.t += 4 * H; store.stopTimer(a.id);
  assert.equal(store.report(start + 2 * H, start + 10 * H).totalMs, 2 * H);
  assert.equal(store.report(start + 4 * H, start + 9 * H).totalMs, 0);
  assert.throws(() => store.report(10, 10), { status: 400 });
  assert.throws(() => store.report(NaN, 10), { status: 400 });
});

test('a running timer is included in the report up to the current moment', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Anna Orlova');
  store.startTimer(a.id, 'Long task'); clock.t += 3 * H;
  const r = store.report(clock.t - 24 * H, clock.t + 24 * H);
  assert.equal(r.employees[0].totalMs, 3 * H);
  assert.equal(r.employees[0].entries[0].end, null);
});

test('data survives a restart, including a running timer', () => {
  const { store, clock, file } = make();
  const a = store.addEmployee('Anna Orlova');
  store.addEmployee('Boris Vetrov');
  store.startTimer(a.id, 'Layout');
  const again = new Store(file, () => clock.t + H);
  assert.equal(again.listEmployees().length, 2);
  assert.equal(again.running(a.id).task, 'Layout');
  again.stopTimer(a.id);
  assert.equal(again.report(0, clock.t + 5 * H).totalMs, H);
});

test('a corrupted data file gives a clear error instead of an empty database', () => {
  const file = tmp(); fs.writeFileSync(file, '{ not json');
  assert.throws(() => new Store(file), /corrupted/);
});

test('HTTP: full scenario and error codes', async () => {
  const { store } = make();
  const srv = createServer(store).listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, body) => {
    const res = await fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: res.status, body: await res.json() };
  };
  try {
    const emp = await call('/api/employees', { name: 'Anna Orlova' });
    assert.equal(emp.status, 201);
    assert.equal((await call('/api/timers/start', { employeeId: emp.body.id, task: 'Test' })).status, 201);
    assert.equal((await call('/api/timers/start', { employeeId: emp.body.id, task: 'Again' })).status, 409);
    assert.equal((await call('/api/timers/stop', { employeeId: emp.body.id })).status, 200);
    assert.equal((await call('/api/report?from=abc&to=1')).status, 400);
    assert.equal((await call('/api/report?from=0&to=99999999999999')).body.employees.length, 1);
    const bad = await fetch(base + '/api/employees', { method: 'POST', body: '{oops' });
    assert.equal(bad.status, 400);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('HTTP: the home page is served as HTML, not as a JSON buffer', async () => {
  const { store } = make();
  const srv = createServer(store).listen(0);
  await new Promise(r => srv.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.ok(text.startsWith('<!doctype html>'), 'response must start with <!doctype html>');
    assert.ok(text.includes('Time tracker'));
  } finally { srv.closeAllConnections(); srv.close(); }
});
