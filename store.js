'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

class Store {
  // now — функция времени; в тестах подменяется, чтобы проверять длительности точно
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.data = { employees: [], entries: [] };
    if (fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { throw new Error(`Файл данных повреждён: ${file}. Исправьте или удалите его.`); }
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // атомарная замена: сбой посреди записи не портит данные
  }

  employee(id) {
    const e = this.data.employees.find(x => x.id === id);
    if (!e) throw new AppError(404, 'Сотрудник не найден', 'emp_not_found');
    return e;
  }

  running(employeeId) {
    return this.data.entries.find(x => x.employeeId === employeeId && x.end === null);
  }

  addEmployee(name) {
    name = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new AppError(400, 'Укажите имя сотрудника', 'name_required');
    if (name.length > 80) throw new AppError(400, 'Имя длиннее 80 символов', 'name_long');
    if (this.data.employees.some(e => e.name.toLowerCase() === name.toLowerCase()))
      throw new AppError(409, 'Сотрудник с таким именем уже есть', 'name_dup');
    const e = { id: crypto.randomUUID(), name };
    this.data.employees.push(e);
    this.save();
    return e;
  }

  listEmployees() {
    return this.data.employees.map(e => ({ ...e, running: this.running(e.id) || null }));
  }

  startTimer(employeeId, task) {
    this.employee(employeeId);
    task = String(task ?? '').trim();
    if (!task) throw new AppError(400, 'Опишите задачу', 'task_required');
    if (task.length > 200) throw new AppError(400, 'Описание длиннее 200 символов', 'task_long');
    if (this.running(employeeId)) throw new AppError(409, 'Таймер уже запущен — сначала остановите его', 'timer_running');
    const entry = { id: crypto.randomUUID(), employeeId, task, start: this.now(), end: null };
    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  stopTimer(employeeId) {
    this.employee(employeeId);
    const entry = this.running(employeeId);
    if (!entry) throw new AppError(409, 'Таймер не запущен', 'timer_not_running');
    entry.end = Math.max(this.now(), entry.start);
    this.save();
    return entry;
  }

  // Период [from, to) в миллисекундах. Запись, пересекающая границу, учитывается частично.
  report(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new AppError(400, 'Некорректный период', 'bad_period');
    if (to <= from) throw new AppError(400, 'Конец периода должен быть позже начала', 'period_order');
    const now = this.now();
    const rows = this.data.employees.map(emp => {
      const entries = [];
      for (const en of this.data.entries) {
        if (en.employeeId !== emp.id) continue;
        const s = Math.max(en.start, from);
        const e = Math.min(en.end ?? now, to);
        if (e > s) entries.push({ id: en.id, task: en.task, start: en.start, end: en.end, ms: e - s });
      }
      entries.sort((a, b) => a.start - b.start);
      return { id: emp.id, name: emp.name, totalMs: entries.reduce((t, x) => t + x.ms, 0), entries };
    });
    return { from, to, totalMs: rows.reduce((t, r) => t + r.totalMs, 0), employees: rows };
  }
}

module.exports = { Store, AppError };
