/**
 * EVCharge — Veritabanı Seed
 * Demo istasyonlar + test kullanıcısı oluşturur.
 * Kullanım: node seed.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

console.log('🌱 Begin database seed...\n');

// ══════════════════════════════════════
//  DEMO KULLANICI
// ══════════════════════════════════════

const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get('test@evcharge.com');
if (!existingUser) {
    const hash = bcrypt.hashSync('Sarj2024', 10);
    db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run('Test User', 'test@evcharge.com', hash);
    console.log('✅ Demo user created: test@evcharge.com / Sarj2024');
} else {
    console.log('ℹ️  Demo user already exists.');
}

// ══════════════════════════════════════
//  İSTASYONLAR + ŞARJ ÜNİTELERİ
// ══════════════════════════════════════

const existingStations = db.prepare('SELECT COUNT(*) AS count FROM stations').get();
if (existingStations.count === 0) {
    const stations = [
        {
            name: 'Karşıyaka Hub',
            address: 'Karşıyaka, Bostanlı Mah., İzmir',
            lat: 38.4637, lng: 27.1065,
            operatingHours: '07:00 - 23:00',
            chargers: [
                { type: 'AC', power: 22, connectorType: 'Type 2', pricePerKwh: 3.50, status: 'available' },
                { type: 'DC', power: 50, connectorType: 'CCS', pricePerKwh: 4.00, status: 'available' },
                { type: 'DC', power: 50, connectorType: 'CCS', pricePerKwh: 4.00, status: 'occupied' },
            ]
        },
        {
            name: 'Bornova Station',
            address: 'Bornova, Erzene Mah., İzmir',
            lat: 38.4580, lng: 27.2167,
            operatingHours: '00:00 - 24:00',
            chargers: [
                { type: 'DC', power: 150, connectorType: 'CCS', pricePerKwh: 5.00, status: 'available' },
                { type: 'AC', power: 22, connectorType: 'Type 2', pricePerKwh: 3.00, status: 'occupied' },
                { type: 'DC', power: 50, connectorType: 'CHAdeMO', pricePerKwh: 4.50, status: 'available' },
            ]
        },
        {
            name: 'Buca Point',
            address: 'Buca, Adatepe Mah., İzmir',
            lat: 38.3925, lng: 27.1753,
            operatingHours: '06:00 - 22:00',
            chargers: [
                { type: 'AC', power: 22, connectorType: 'Type 2', pricePerKwh: 3.50, status: 'offline' },
                { type: 'DC', power: 50, connectorType: 'CCS', pricePerKwh: 4.00, status: 'offline' },
            ]
        },
        {
            name: 'Alsancak Merkez',
            address: 'Konak, Alsancak, 1453 Sok., İzmir',
            lat: 38.4362, lng: 27.1427,
            operatingHours: '00:00 - 24:00',
            chargers: [
                { type: 'DC', power: 150, connectorType: 'CCS', pricePerKwh: 5.50, status: 'available' },
                { type: 'DC', power: 50, connectorType: 'CHAdeMO', pricePerKwh: 4.50, status: 'available' },
                { type: 'AC', power: 22, connectorType: 'Type 2', pricePerKwh: 3.00, status: 'available' },
                { type: 'AC', power: 22, connectorType: 'Type 2', pricePerKwh: 3.00, status: 'occupied' },
            ]
        },
        {
            name: 'Çiğli Park',
            address: 'Çiğli, Atatürk Mah., İzmir',
            lat: 38.4950, lng: 27.0630,
            operatingHours: '08:00 - 22:00',
            chargers: [
                { type: 'DC', power: 50, connectorType: 'CCS', pricePerKwh: 4.00, status: 'available' },
                { type: 'AC', power: 22, connectorType: 'Type 2', pricePerKwh: 3.50, status: 'available' },
            ]
        }
    ];

    const insertStation = db.prepare(
        'INSERT INTO stations (name, address, lat, lng, operating_hours) VALUES (?, ?, ?, ?, ?)'
    );
    const insertCharger = db.prepare(
        'INSERT INTO chargers (station_id, type, power, connector_type, price_per_kwh, status) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const seedAll = db.transaction(() => {
        for (const st of stations) {
            const result = insertStation.run(st.name, st.address, st.lat, st.lng, st.operatingHours);
            const stationId = result.lastInsertRowid;
            for (const ch of st.chargers) {
                insertCharger.run(stationId, ch.type, ch.power, ch.connectorType, ch.pricePerKwh, ch.status);
            }
            console.log(`  📍 ${st.name} — ${st.chargers.length} charger units`);
        }
    });

    seedAll();
    console.log(`\n✅ ${stations.length} stations created.`);
} else {
    console.log('ℹ️  Stations already exist.');
}

console.log('\n🎉 Seed completed!\n');
