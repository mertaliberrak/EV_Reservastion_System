const db = require('./db');
db.prepare("UPDATE chargers SET status = 'offline' WHERE station_id = (SELECT id FROM stations WHERE name = 'Bornova Station') AND power = 150").run();
console.log('Done');
