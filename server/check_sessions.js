const db = require('./db');
const sessions = db.prepare('SELECT id, reservation_id, start_time, status FROM sessions').all();
console.log(JSON.stringify(sessions, null, 2));
