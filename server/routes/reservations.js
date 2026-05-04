/**
 * EVCharge — Reservation Routes
 * GET    /api/reservations     — Kullanıcının rezervasyonları
 * POST   /api/reservations     — Yeni rezervasyon (çakışma + uyumluluk kontrolü)
 * DELETE /api/reservations/:id — Rezervasyon iptal
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const auth = require('../middleware/auth');

// Tüm route'lar auth gerektirir
router.use(auth);

// ══════════════════════════════════════
//  GET /api/reservations
// ══════════════════════════════════════
router.get('/', (req, res) => {
    const reservations = db.prepare(
        `SELECT r.*, s.name AS station_name, s.address AS station_address,
                c.type AS charger_type, c.power AS charger_power, c.connector_type AS charger_connector,
                v.brand AS vehicle_brand, v.model AS vehicle_model
         FROM reservations r
         JOIN stations s ON r.station_id = s.id
         JOIN chargers c ON r.charger_id = c.id
         JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC`
    ).all(req.user.id);

    res.json({ reservations });
});

// ══════════════════════════════════════
//  GET /api/reservations/charger/:chargerId/availability
// ══════════════════════════════════════
router.get('/charger/:chargerId/availability', (req, res) => {
    const { chargerId } = req.params;
    const today = new Date();
    const localDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const date = req.query.date || localDateStr; // Default: today (Local Timezone safe)

    const bookedSlots = db.prepare(
        `SELECT start_slot, end_slot FROM reservations
         WHERE charger_id = ? AND date = ? AND status = 'active'`
    ).all(chargerId, date);

    res.json({ bookedSlots });
});

// ══════════════════════════════════════
//  POST /api/reservations
// ══════════════════════════════════════
router.post('/', [
    body('stationId').isInt().withMessage('İstasyon ID gerekli.'),
    body('chargerId').isInt().withMessage('Şarj ünitesi ID gerekli.'),
    body('vehicleId').isInt().withMessage('Araç ID gerekli.'),
    body('date').notEmpty().withMessage('Tarih gerekli.'),
    body('startSlot').notEmpty().withMessage('Başlangıç saati gerekli.'),
    body('endSlot').notEmpty().withMessage('Bitiş saati gerekli.'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { stationId, chargerId, vehicleId, date, startSlot, endSlot } = req.body;

    // 1. Araç sahibi mi?
    const vehicle = db.prepare(
        'SELECT * FROM vehicles WHERE id = ? AND user_id = ?'
    ).get(vehicleId, req.user.id);
    if (!vehicle) {
        return res.status(404).json({ error: 'Araç bulunamadı veya size ait değil.' });
    }

    // 2. Şarj ünitesi var mı?
    const charger = db.prepare(
        'SELECT * FROM chargers WHERE id = ? AND station_id = ?'
    ).get(chargerId, stationId);
    if (!charger) {
        return res.status(404).json({ error: 'Şarj ünitesi bulunamadı.' });
    }

    // Çevrimdışı kontrolü
    if (charger.status === 'offline') {
        return res.status(400).json({ error: 'Bu şarj ünitesi şu anda çevrimdışı.' });
    }

    // 3. Araç-şarj uyumluluk kontrolü (EV-13)
    if (vehicle.connector_type !== charger.connector_type) {
        return res.status(400).json({
            error: `Uyumsuz konnektör: Aracınız ${vehicle.connector_type}, şarj ünitesi ${charger.connector_type}.`
        });
    }

    // Zaman kısıtlamaları (Geçmiş veya 24 saat sonrası)
    const now = new Date();
    const reservationStart = new Date(`${date}T${startSlot}:00`);
    const diffMins = (reservationStart - now) / (1000 * 60);

    if (diffMins < 0) {
        return res.status(400).json({ error: 'Geçmiş bir zamana rezervasyon yapılamaz.' });
    }
    if (diffMins > 24 * 60) {
        return res.status(400).json({ error: 'Sadece önümüzdeki 24 saat için rezervasyon yapılabilir.' });
    }

    function timeToMins(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    }
    const newStartMins = timeToMins(startSlot);
    let newEndMins = timeToMins(endSlot);

    // Gece yarısı geçişi (Örn: 23:00 - 01:00)
    if (newEndMins <= newStartMins) {
        newEndMins += 24 * 60;
    }

    // Süre kısıtlamaları kontrolü (Min 15, Max 120 dk)
    const durationMins = newEndMins - newStartMins;
    if (durationMins < 15) {
        return res.status(400).json({ error: 'Rezervasyon süresi en az 15 dakika olmalıdır.' });
    }
    if (durationMins > 120) {
        return res.status(400).json({ error: 'Rezervasyon süresi en fazla 2 saat (120 dakika) olabilir.' });
    }

    // 4. Zaman çakışması ve 15 dk boşluk kontrolü
    const activeReservations = db.prepare(
        `SELECT start_slot, end_slot FROM reservations
         WHERE station_id = ? AND charger_id = ? AND date = ? AND status = 'active'`
    ).all(stationId, chargerId, date);

    let isConflict = false;
    for (let r of activeReservations) {
        const bStartMins = timeToMins(r.start_slot);
        let bEndMins = timeToMins(r.end_slot);
        if (bEndMins <= bStartMins) bEndMins += 24 * 60;
        
        // 15 dakika boşluk kuralı için mevcut rezervasyonu 15 dk genişletiyoruz
        if (Math.max(bStartMins - 15, newStartMins) < Math.min(bEndMins + 15, newEndMins)) {
            isConflict = true;
            break;
        }
    }

    if (isConflict) {
        return res.status(409).json({ error: 'Bu saat dilimi dolu veya iki rezervasyon arasında en az 15 dakika boşluk olmalıdır.' });
    }

    // 5. Çifte Rezervasyon Kontrolü (Aynı kullanıcının aynı saatte başka rezervasyonu var mı?)
    const userActiveReservations = db.prepare(
        `SELECT start_slot, end_slot FROM reservations
         WHERE user_id = ? AND date = ? AND status = 'active'`
    ).all(req.user.id, date);

    let userConflict = false;
    for (let r of userActiveReservations) {
        const bStart = timeToMins(r.start_slot);
        let bEnd = timeToMins(r.end_slot);
        if (bEnd <= bStart) bEnd += 24 * 60;

        if (Math.max(bStart, newStartMins) < Math.min(bEnd, newEndMins)) {
            userConflict = true;
            break;
        }
    }

    if (userConflict) {
        return res.status(409).json({ error: 'Bu saat diliminde zaten başka bir aktif rezervasyonunuz bulunuyor.' });
    }

    // 6. Cüzdan Bakiyesi Kontrolü
    const durationHours = durationMins / 60;
    const actualPower = Math.min(charger.power, vehicle.max_charge_rate);
    const estimatedCost = durationHours * actualPower * charger.price_per_kwh;

    const userRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
    if (!userRow || userRow.balance < estimatedCost) {
        return res.status(402).json({ 
            error: `Bakiyeniz yetersiz. Tahmini tutar: ${estimatedCost.toFixed(2)} ₺, Bakiyeniz: ${userRow ? userRow.balance.toFixed(2) : 0} ₺` 
        });
    }

    // 7. Rezervasyonu oluştur ve Bakiyeden düş (Transaction)
    let resId;
    try {
        const insertTx = db.transaction(() => {
            const result = db.prepare(
                `INSERT INTO reservations (user_id, station_id, charger_id, vehicle_id, date, start_slot, end_slot)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(req.user.id, stationId, chargerId, vehicleId, date, startSlot, endSlot);
            
            db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(estimatedCost, req.user.id);
            return result.lastInsertRowid;
        });
        resId = insertTx();
    } catch (err) {
        return res.status(500).json({ error: 'Rezervasyon oluşturulurken bir hata oluştu.' });
    }

    // Oluşturulan rezervasyonu detaylı getir
    const reservation = db.prepare(
        `SELECT r.*, s.name AS station_name, c.type AS charger_type, c.power AS charger_power,
                c.connector_type AS charger_connector, c.price_per_kwh,
                v.brand AS vehicle_brand, v.model AS vehicle_model
         FROM reservations r
         JOIN stations s ON r.station_id = s.id
         JOIN chargers c ON r.charger_id = c.id
         JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.id = ?`
    ).get(resId);

    res.status(201).json({ message: 'Rezervasyon oluşturuldu.', reservation });
});

// ── Mesafe Hesaplama (Haversine) ──
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ── Zaman çakışma kontrolü yardımcısı ──
function hasTimeConflict(startSlot, endSlot, date, chargerId) {
    function timeToMins(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    }
    const newStartMins = timeToMins(startSlot);
    let newEndMins = timeToMins(endSlot);
    if (newEndMins <= newStartMins) newEndMins += 24 * 60;

    const existing = db.prepare(
        `SELECT start_slot, end_slot FROM reservations
         WHERE charger_id = ? AND date = ? AND status = 'active'`
    ).all(chargerId, date);

    for (const r of existing) {
        const bStart = timeToMins(r.start_slot);
        let bEnd = timeToMins(r.end_slot);
        if (bEnd <= bStart) bEnd += 24 * 60;
        if (Math.max(bStart - 15, newStartMins) < Math.min(bEnd + 15, newEndMins)) {
            return true;
        }
    }
    return false;
}

// ══════════════════════════════════════
//  GET /api/reservations/:id/alternatives
//  Şarj cihazı müsait değilse alternatifleri öner
//  (aynı istasyon + yakın istasyonlar)
// ══════════════════════════════════════
router.get('/:id/alternatives', (req, res) => {
    const reservation = db.prepare(
        `SELECT r.*, s.name AS station_name, s.lat, s.lng,
                c.connector_type AS charger_connector, c.status AS charger_status,
                v.connector_type AS vehicle_connector, v.brand AS vehicle_brand, v.model AS vehicle_model
         FROM reservations r
         JOIN stations s ON r.station_id = s.id
         JOIN chargers c ON r.charger_id = c.id
         JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.id = ? AND r.user_id = ?`
    ).get(req.params.id, req.user.id);

    if (!reservation) {
        return res.status(404).json({ error: 'Rezervasyon bulunamadı.' });
    }

    const charger = db.prepare('SELECT * FROM chargers WHERE id = ?').get(reservation.charger_id);
    const isUnavailable = charger.status !== 'available';

    // ── 1. Aynı istasyondaki uyumlu alternatifler ──
    const sameStationChargers = db.prepare(
        `SELECT * FROM chargers
         WHERE station_id = ? AND id != ? AND connector_type = ? AND status = 'available'`
    ).all(reservation.station_id, reservation.charger_id, reservation.vehicle_connector);

    const sameStationAlts = [];
    for (const alt of sameStationChargers) {
        if (!hasTimeConflict(reservation.start_slot, reservation.end_slot, reservation.date, alt.id)) {
            sameStationAlts.push({
                charger_id: alt.id,
                station_id: reservation.station_id,
                station_name: reservation.station_name,
                type: alt.type,
                power: alt.power,
                connector_type: alt.connector_type,
                price_per_kwh: alt.price_per_kwh,
                distance_km: 0,
                same_station: true,
            });
        }
    }

    // ── 2. Yakın istasyonlardaki uyumlu alternatifler ──
    const nearbyAlts = [];
    const allStations = db.prepare('SELECT * FROM stations WHERE id != ?').all(reservation.station_id);

    for (const station of allStations) {
        const dist = getDistanceKm(reservation.lat, reservation.lng, station.lat, station.lng);
        if (dist > 15) continue; // Maks 15 km

        const compatibleChargers = db.prepare(
            `SELECT * FROM chargers
             WHERE station_id = ? AND connector_type = ? AND status = 'available'`
        ).all(station.id, reservation.vehicle_connector);

        for (const alt of compatibleChargers) {
            if (!hasTimeConflict(reservation.start_slot, reservation.end_slot, reservation.date, alt.id)) {
                nearbyAlts.push({
                    charger_id: alt.id,
                    station_id: station.id,
                    station_name: station.name,
                    station_address: station.address,
                    type: alt.type,
                    power: alt.power,
                    connector_type: alt.connector_type,
                    price_per_kwh: alt.price_per_kwh,
                    distance_km: Math.round(dist * 100) / 100,
                    same_station: false,
                    lat: station.lat,
                    lng: station.lng,
                });
            }
        }
    }

    // Yakın istasyonları mesafeye göre sırala
    nearbyAlts.sort((a, b) => a.distance_km - b.distance_km);

    res.json({
        reservation_id: reservation.id,
        current_charger_status: charger.status,
        is_unavailable: isUnavailable,
        vehicle: `${reservation.vehicle_brand} ${reservation.vehicle_model} (${reservation.vehicle_connector})`,
        date: reservation.date,
        time_slot: `${reservation.start_slot} - ${reservation.end_slot}`,
        same_station_alternatives: sameStationAlts,
        nearby_station_alternatives: nearbyAlts.slice(0, 10),
        total_alternatives: sameStationAlts.length + Math.min(nearbyAlts.length, 10),
    });
});

// ══════════════════════════════════════
//  POST /api/reservations/:id/switch
//  Rezervasyonu alternatif bir cihaza taşı
// ══════════════════════════════════════
router.post('/:id/switch', [
    body('newChargerId').isInt().withMessage('Yeni şarj ünitesi ID gerekli.'),
    body('newStationId').isInt().withMessage('Yeni istasyon ID gerekli.'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { newChargerId, newStationId } = req.body;

    // Mevcut rezervasyonu bul
    const reservation = db.prepare(
        `SELECT r.*, v.connector_type AS vehicle_connector, v.max_charge_rate,
                c.power AS old_power, c.price_per_kwh AS old_price
         FROM reservations r
         JOIN vehicles v ON r.vehicle_id = v.id
         JOIN chargers c ON r.charger_id = c.id
         WHERE r.id = ? AND r.user_id = ? AND r.status = 'active'`
    ).get(req.params.id, req.user.id);

    if (!reservation) {
        return res.status(404).json({ error: 'Aktif rezervasyon bulunamadı.' });
    }

    // Yeni cihaz kontrolü
    const newCharger = db.prepare(
        'SELECT * FROM chargers WHERE id = ? AND station_id = ?'
    ).get(newChargerId, newStationId);

    if (!newCharger) {
        return res.status(404).json({ error: 'Alternatif şarj ünitesi bulunamadı.' });
    }

    if (newCharger.status !== 'available') {
        return res.status(400).json({ error: 'Alternatif şarj ünitesi şu anda müsait değil.' });
    }

    // Uyumluluk kontrolü
    if (newCharger.connector_type !== reservation.vehicle_connector) {
        return res.status(400).json({ error: 'Alternatif şarj ünitesi aracınızla uyumlu değil.' });
    }

    // Zaman çakışması kontrolü
    if (hasTimeConflict(reservation.start_slot, reservation.end_slot, reservation.date, newChargerId)) {
        return res.status(409).json({ error: 'Alternatif ünite bu saat diliminde dolu.' });
    }

    // Fiyat farkı hesapla
    function timeToMins(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    }
    let startMins = timeToMins(reservation.start_slot);
    let endMins = timeToMins(reservation.end_slot);
    if (endMins <= startMins) endMins += 24 * 60;
    const durationHours = (endMins - startMins) / 60;

    const oldPower = Math.min(reservation.old_power, reservation.max_charge_rate);
    const newPower = Math.min(newCharger.power, reservation.max_charge_rate);
    const oldCost = durationHours * oldPower * reservation.old_price;
    const newCost = durationHours * newPower * newCharger.price_per_kwh;
    const priceDiff = newCost - oldCost;

    // Fiyat farkı artıyorsa bakiye kontrolü
    if (priceDiff > 0) {
        const userRow = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
        if (!userRow || userRow.balance < priceDiff) {
            return res.status(402).json({
                error: `Bakiye yetersiz. Fiyat farkı: ${priceDiff.toFixed(2)} ₺, Bakiyeniz: ${userRow ? userRow.balance.toFixed(2) : '0.00'} ₺`
            });
        }
    }

    // Rezervasyonu güncelle (transaction)
    try {
        db.transaction(() => {
            db.prepare(
                `UPDATE reservations SET station_id = ?, charger_id = ? WHERE id = ?`
            ).run(newStationId, newChargerId, req.params.id);

            // Fiyat farkını uygula
            if (priceDiff !== 0) {
                db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(priceDiff, req.user.id);
            }
        })();
    } catch (e) {
        return res.status(500).json({ error: 'Rezervasyon aktarımı sırasında hata oluştu.' });
    }

    // Güncellenmiş rezervasyonu getir
    const updated = db.prepare(
        `SELECT r.*, s.name AS station_name, s.address AS station_address,
                c.type AS charger_type, c.power AS charger_power, c.connector_type AS charger_connector
         FROM reservations r
         JOIN stations s ON r.station_id = s.id
         JOIN chargers c ON r.charger_id = c.id
         WHERE r.id = ?`
    ).get(req.params.id);

    res.json({
        message: `Rezervasyon başarıyla aktarıldı! ${priceDiff > 0 ? `Fark: ${priceDiff.toFixed(2)} ₺ tahsil edildi.` : priceDiff < 0 ? `İade: ${Math.abs(priceDiff).toFixed(2)} ₺` : ''}`,
        reservation: updated,
        price_difference: priceDiff,
    });
});

// ══════════════════════════════════════
//  DELETE /api/reservations/:id
// ══════════════════════════════════════
router.delete('/:id', (req, res) => {
    const reservation = db.prepare(
        `SELECT r.*, c.power, c.price_per_kwh, v.max_charge_rate 
         FROM reservations r
         JOIN chargers c ON r.charger_id = c.id
         JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.id = ? AND r.user_id = ?`
    ).get(req.params.id, req.user.id);

    if (!reservation) {
        return res.status(404).json({ error: 'Rezervasyon bulunamadı veya size ait değil.' });
    }

    if (reservation.status !== 'active') {
        return res.status(400).json({ error: 'Sadece aktif rezervasyonlar iptal edilebilir.' });
    }

    // İptal Politikası: 1 Saat kala tam iade, aksi halde %50 iade. Geçmiş zamansa iade yok.
    const now = new Date();
    const resStart = new Date(`${reservation.date}T${reservation.start_slot}:00`);
    const diffMins = (resStart - now) / (1000 * 60);

    let refundRatio = 0;
    if (diffMins >= 60) {
        refundRatio = 1.0; // %100 iade
    } else if (diffMins >= 0) {
        refundRatio = 0.5; // %50 iade (Depozito kesintisi)
    }

    function timeToMins(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    }
    let startMins = timeToMins(reservation.start_slot);
    let endMins = timeToMins(reservation.end_slot);
    if (endMins <= startMins) endMins += 24 * 60;
    const durationHours = (endMins - startMins) / 60;
    
    const actualPower = Math.min(reservation.power, reservation.max_charge_rate);
    const estimatedCost = durationHours * actualPower * reservation.price_per_kwh;
    const refundAmount = estimatedCost * refundRatio;

    try {
        db.transaction(() => {
            db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(req.params.id);
            if (refundAmount > 0) {
                db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refundAmount, req.user.id);
            }
        })();
    } catch (e) {
        return res.status(500).json({ error: 'İptal işlemi sırasında bir hata oluştu.' });
    }

    res.json({ message: `Rezervasyon iptal edildi. Cüzdanınıza iade edilen tutar: ${refundAmount.toFixed(2)} ₺` });
});

module.exports = router;
