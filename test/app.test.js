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

test('добавление сотрудника: пробелы убираются, пустое и дубликат отклоняются', () => {
  const { store } = make();
  assert.equal(store.addEmployee('  Анна   Орлова ').name, 'Анна Орлова');
  assert.throws(() => store.addEmployee('   '), { status: 400 });
  assert.throws(() => store.addEmployee('анна орлова'), { status: 409 });
});

test('таймер: запуск, остановка, длительность попадает в отчёт', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Анна Орлова');
  store.startTimer(a.id, 'Вёрстка');
  clock.t += 2 * H + 30 * 60_000;
  store.stopTimer(a.id);
  const r = store.report(clock.t - 24 * H, clock.t + H);
  assert.equal(r.employees[0].totalMs, 2.5 * H);
  assert.equal(r.totalMs, 2.5 * H);
});

test('повторный запуск таймера у того же сотрудника отклоняется, первая запись не страдает', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Анна Орлова');
  store.startTimer(a.id, 'Задача 1');
  assert.throws(() => store.startTimer(a.id, 'Задача 2'), { status: 409 });
  assert.equal(store.data.entries.length, 1);
  assert.equal(store.running(a.id).task, 'Задача 1');
  clock.t += H;
  store.stopTimer(a.id);
  store.startTimer(a.id, 'Задача 2'); // после остановки — можно
  assert.equal(store.data.entries.length, 2);
});

test('остановка без запуска и пустое описание задачи отклоняются', () => {
  const { store } = make();
  const a = store.addEmployee('Борис Ветров');
  assert.throws(() => store.stopTimer(a.id), { status: 409 });
  assert.throws(() => store.startTimer(a.id, '  '), { status: 400 });
  assert.throws(() => store.startTimer('нет-такого', 'x'), { status: 404 });
});

test('пустой отчёт: нет сотрудников; период без записей', () => {
  const { store, clock } = make();
  assert.deepEqual(store.report(0, H).employees, []);
  const a = store.addEmployee('Анна Орлова');
  store.startTimer(a.id, 'Вёрстка'); clock.t += H; store.stopTimer(a.id);
  const r = store.report(clock.t + 10 * H, clock.t + 20 * H);
  assert.equal(r.totalMs, 0);
  assert.deepEqual(r.employees[0].entries, []);
});

test('период: запись на границе учитывается частично, конец не включается', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Анна Орлова');
  const start = clock.t;
  store.startTimer(a.id, 'Ночная задача'); clock.t += 4 * H; store.stopTimer(a.id);
  assert.equal(store.report(start + 2 * H, start + 10 * H).totalMs, 2 * H);
  assert.equal(store.report(start + 4 * H, start + 9 * H).totalMs, 0);
  assert.throws(() => store.report(10, 10), { status: 400 });
  assert.throws(() => store.report(NaN, 10), { status: 400 });
});

test('идущий таймер входит в отчёт до текущего момента', () => {
  const { store, clock } = make();
  const a = store.addEmployee('Анна Орлова');
  store.startTimer(a.id, 'Долгая задача'); clock.t += 3 * H;
  const r = store.report(clock.t - 24 * H, clock.t + 24 * H);
  assert.equal(r.employees[0].totalMs, 3 * H);
  assert.equal(r.employees[0].entries[0].end, null);
});

test('данные сохраняются после перезапуска, в том числе идущий таймер', () => {
  const { store, clock, file } = make();
  const a = store.addEmployee('Анна Орлова');
  store.addEmployee('Борис Ветров');
  store.startTimer(a.id, 'Вёрстка');
  const again = new Store(file, () => clock.t + H);
  assert.equal(again.listEmployees().length, 2);
  assert.equal(again.running(a.id).task, 'Вёрстка');
  again.stopTimer(a.id);
  assert.equal(again.report(0, clock.t + 5 * H).totalMs, H);
});

test('повреждённый файл данных даёт понятную ошибку, а не пустую базу', () => {
  const file = tmp(); fs.writeFileSync(file, '{ не json');
  assert.throws(() => new Store(file), /повреждён/);
});

test('HTTP: полный сценарий и коды ошибок', async () => {
  const { store } = make();
  const srv = createServer(store).listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, body) => {
    const res = await fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: res.status, body: await res.json() };
  };
  try {
    const emp = await call('/api/employees', { name: 'Анна Орлова' });
    assert.equal(emp.status, 201);
    assert.equal((await call('/api/timers/start', { employeeId: emp.body.id, task: 'Тест' })).status, 201);
    assert.equal((await call('/api/timers/start', { employeeId: emp.body.id, task: 'Ещё' })).status, 409);
    assert.equal((await call('/api/timers/stop', { employeeId: emp.body.id })).status, 200);
    assert.equal((await call('/api/report?from=abc&to=1')).status, 400);
    assert.equal((await call('/api/report?from=0&to=99999999999999')).body.employees.length, 1);
    const bad = await fetch(base + '/api/employees', { method: 'POST', body: '{oops' });
    assert.equal(bad.status, 400);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('HTTP: главная страница отдаётся как HTML, а не как JSON-буфер', async () => {
  const { store } = make();
  const srv = createServer(store).listen(0);
  await new Promise(r => srv.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.ok(text.startsWith('<!doctype html>'), 'ответ должен начинаться с <!doctype html>');
    assert.ok(text.includes('Учёт рабочего времени'));
  } finally { srv.closeAllConnections(); srv.close(); }
});
