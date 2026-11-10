'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store, AppError } = require('./store');

function createServer(store) {
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10_000) { reject(new AppError(413, 'Слишком большой запрос', 'too_large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new AppError(400, 'Некорректный JSON', 'bad_json')); } });
  });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html'))
        return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), 'text/html; charset=utf-8');
      if (req.method === 'GET' && pathname === '/api/employees') return send(res, 200, store.listEmployees());
      if (req.method === 'POST' && pathname === '/api/employees') {
        const b = await readBody(req); return send(res, 201, store.addEmployee(b.name));
      }
      if (req.method === 'POST' && pathname === '/api/timers/start') {
        const b = await readBody(req); return send(res, 201, store.startTimer(b.employeeId, b.task));
      }
      if (req.method === 'POST' && pathname === '/api/timers/stop') {
        const b = await readBody(req); return send(res, 200, store.stopTimer(b.employeeId));
      }
      if (req.method === 'GET' && pathname === '/api/report')
        return send(res, 200, store.report(Number(url.searchParams.get('from')), Number(url.searchParams.get('to'))));
      throw new AppError(404, 'Не найдено', 'not_found');
    } catch (err) {
      if (err instanceof AppError) return send(res, err.status, { error: err.message, code: err.code });
      console.error(err);
      send(res, 500, { error: 'Внутренняя ошибка' });
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const file = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
  const port = Number(process.env.PORT) || 3000;
  createServer(new Store(file)).listen(port, () => console.log(`http://localhost:${port}  (данные: ${file})`));
}
