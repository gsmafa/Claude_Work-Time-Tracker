'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

class Store {
  // `now` is a clock function; tests replace it so durations can be asserted exactly
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.data = { employees: [], entries: [] };
    if (fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { throw new Error(`Data file is corrupted: ${file}. Fix or delete it.`); }
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace: a crash mid-write cannot corrupt the data
  }

  employee(id) {
    const e = this.data.employees.find(x => x.id === id);
    if (!e) throw new AppError(404, 'Employee not found', 'emp_not_found');
    return e;
  }

  running(employeeId) {
    return this.data.entries.find(x => x.employeeId === employeeId && x.end === null);
  }

  addEmployee(name) {
    name = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new AppError(400, 'Enter the employee name', 'name_required');
    if (name.length > 80) throw new AppError(400, 'Name is longer than 80 characters', 'name_long');
    if (this.data.employees.some(e => e.name.toLowerCase() === name.toLowerCase()))
      throw new AppError(409, 'An employee with this name already exists', 'name_dup');
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
    if (!task) throw new AppError(400, 'Describe the task', 'task_required');
    if (task.length > 200) throw new AppError(400, 'Description is longer than 200 characters', 'task_long');
    if (this.running(employeeId)) throw new AppError(409, 'The timer is already running. Stop it first', 'timer_running');
    const entry = { id: crypto.randomUUID(), employeeId, task, start: this.now(), end: null };
    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  stopTimer(employeeId) {
    this.employee(employeeId);
    const entry = this.running(employeeId);
    if (!entry) throw new AppError(409, 'The timer is not running', 'timer_not_running');
    entry.end = Math.max(this.now(), entry.start);
    this.save();
    return entry;
  }

  // Period is [from, to) in milliseconds. An entry crossing a boundary counts only inside the period.
  report(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new AppError(400, 'Invalid period', 'bad_period');
    if (to <= from) throw new AppError(400, 'The end of the period must be after the start', 'period_order');
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
