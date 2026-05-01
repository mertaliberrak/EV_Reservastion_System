const db = require('./db');

const stations = [
    {
        name: 'ZES - Alsancak',
        address: 'Atatürk Cd. No:1, Konak, İzmir',
        lat: 38.4388,
        lng: 27.1422,
        operating_hours: '7/24 Açık'
    },
    {
        name: 'Eşarj - Balçova Kipa',
        address: 'İnciraltı Cd. No:11, Balçova, İzmir',
        lat: 38.3905,
        lng: 27.0396,
        operating_hours: '08:00 - 22:00'
    },
    {
        name: 'Voltrun - Karşıyaka İskele',
        address: 'Cemal Gürsel Cd. No:123, Karşıyaka, İzmir',
        lat: 38.4566,
        lng: 27.1130,
        operating_hours: '7/24 Açık'
    },
    {
        name: 'Trugo - Forum Bornova',
        address: 'Kazımdirik Mah. Üniversite Cd., Bornova, İzmir',
        lat: 38.4625,
        lng: 27.2185,
        operating_hours: '10:00 - 22:00'
    }
];

const insertStation = db.prepare('INSERT INTO stations (name, address, lat, lng, operating_hours) VALUES (?, ?, ?, ?, ?)');
const insertCharger = db.prepare('INSERT INTO chargers (station_id, type, power, connector_type, price_per_kwh, status) VALUES (?, ?, ?, ?, ?, ?)');

db.transaction(() => {
    for (const st of stations) {
        const info = insertStation.run(st.name, st.address, st.lat, st.lng, st.operating_hours);
        const stationId = info.lastInsertRowid;
        
        // Şarj Üniteleri Ekleniyor
        insertCharger.run(stationId, 'AC', 22, 'Type 2', 5.5, 'available');
        insertCharger.run(stationId, 'DC', 120, 'CCS', 9.5, 'available');
        
        // ZES ve Trugo istasyonlarına ekstra güçlü üniteler
        if (st.name.includes('ZES') || st.name.includes('Trugo')) {
            insertCharger.run(stationId, 'DC', 180, 'CCS', 10.5, 'available');
            insertCharger.run(stationId, 'DC', 50, 'CHAdeMO', 8.5, 'available');
        }
    }
})();

console.log('İzmir test istasyonları başarıyla eklendi!');
