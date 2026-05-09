/**
 * EVCharge — Session Routes
 * GET   /api/sessions     — Kullanıcının şarj oturumları
 * POST  /api/sessions     — Şarj başlat
 * PATCH /api/sessions/:id — Şarj durdur + maliyet kaydet
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const auth = require('../middleware/auth');
const { createNotification } = require('../utils/notificationHelper');

router.use(auth);

// ══════════════════════════════════════
//  GET /api/sessions
// ══════════════════════════════════════
router.get('/', (req, res) => {
    const sessions = db.prepare(
        `SELECT ss.*, r.station_id, r.charger_id, r.date,
                s.name AS station_name,
                c.type AS charger_type, c.power AS charger_power, c.price_per_kwh AS charger_price
         FROM sessions ss
         LEFT JOIN reservations r ON ss.reservation_id = r.id
         LEFT JOIN stations s ON r.station_id = s.id
         LEFT JOIN chargers c ON r.charger_id = c.id
         WHERE ss.user_id = ?
         ORDER BY ss.start_time DESC`
    ).all(req.user.id);

    res.json({ sessions });
});

// ══════════════════════════════════════
//  POST /api/sessions — Şarj başlat
// ══════════════════════════════════════
router.post('/', [
    body('reservationId').isInt().withMessage('Rezervasyon ID gerekli.'),
    body('batteryStart').isFloat({ min: 0, max: 100 }).withMessage('Başlangıç batarya yüzdesi gerekli.'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { reservationId, batteryStart } = req.body;

    // Rezervasyon kontrolü
    const reservation = db.prepare(
        'SELECT * FROM reservations WHERE id = ? AND user_id = ?'
    ).get(reservationId, req.user.id);

    if (!reservation) {
        return res.status(404).json({ error: 'Rezervasyon bulunamadı.' });
    }

    if (reservation.status !== 'active') {
        return res.status(400).json({ error: 'Sadece aktif rezervasyonlar için şarj başlatılabilir.' });
    }

    // ── ZAMAN KONTROLÜ (Time Constraints) ──
    const now = new Date();
    const resStart = new Date(`${reservation.date}T${reservation.start_slot}:00`);
    let resEnd = new Date(`${reservation.date}T${reservation.end_slot}:00`);
    
    if (resEnd <= resStart) {
        resEnd.setDate(resEnd.getDate() + 1); // Gece yarısı geçişi
    }

    // 15 dakika erken başlama opsiyonu
    const allowedStart = new Date(resStart.getTime() - 15 * 60 * 1000);

    if (now < allowedStart) {
        return res.status(400).json({ error: `Şarj işlemine rezervasyon saatinizden en fazla 15 dakika önce başlayabilirsiniz. (Randevu: ${reservation.start_slot})` });
    }

    if (now > resEnd) {
        return res.status(400).json({ error: 'Rezervasyon süreniz sona ermiş. Bu rezervasyon için şarj başlatılamaz.' });
    }

    // Şarj ünitesinin fiyatını al
    const charger = db.prepare('SELECT * FROM chargers WHERE id = ?').get(reservation.charger_id);

    // Araç ve istasyon bilgilerini al (frontend izleme için)
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(reservation.vehicle_id);
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(reservation.station_id);

    // Oturumu oluştur
    const result = db.prepare(
        `INSERT INTO sessions (user_id, reservation_id, start_time, price_per_kwh, battery_start, status)
         VALUES (?, ?, ?, ?, ?, 'charging')`
    ).run(req.user.id, reservationId, new Date().toISOString(), charger.price_per_kwh, batteryStart);

    // Rezervasyonu 'in_progress' yap
    db.prepare("UPDATE reservations SET status = 'in_progress' WHERE id = ?").run(reservationId);

    // Şarj ünitesini 'occupied' yap
    db.prepare("UPDATE chargers SET status = 'occupied' WHERE id = ?").run(reservation.charger_id);

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid);

    // Frontend'e araç, istasyon ve şarj ünitesi bilgilerini de gönder
    session.vehicle_name = vehicle ? `${vehicle.brand} ${vehicle.model}` : '';
    session.battery_capacity = vehicle ? vehicle.battery_capacity : 60;
    session.max_charge_rate = vehicle ? vehicle.max_charge_rate : 50;
    session.charger_power = charger.power;
    session.connector_type = charger.connector_type;
    session.station_name = station ? station.name : '';

    res.status(201).json({ message: 'Şarj oturumu başlatıldı.', session });
});

// ══════════════════════════════════════
//  PATCH /api/sessions/:id — Şarj durdur
//  energyConsumed backend tarafından hesaplanır (güvenlik)
// ══════════════════════════════════════
router.patch('/:id', [
    body('batteryEnd').isFloat({ min: 0, max: 100 }).withMessage('Bitiş batarya yüzdesi gerekli.'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { batteryEnd } = req.body;

    // Oturum kontrolü (tüm ilişkili tablolarla birlikte)
    const session = db.prepare(
        `SELECT s.*, r.start_slot, r.end_slot, r.date, c.power, v.max_charge_rate, v.battery_capacity
         FROM sessions s
         LEFT JOIN reservations r ON s.reservation_id = r.id
         LEFT JOIN chargers c ON r.charger_id = c.id
         LEFT JOIN vehicles v ON r.vehicle_id = v.id
         WHERE s.id = ? AND s.user_id = ?`
    ).get(req.params.id, req.user.id);

    if (!session) {
        return res.status(404).json({ error: 'Oturum bulunamadı.' });
    }

    if (session.status !== 'charging') {
        return res.status(400).json({ error: 'Bu oturum zaten tamamlanmış.' });
    }

    if (batteryEnd < session.battery_start) {
        return res.status(400).json({ error: 'Bitiş bataryası başlangıç bataryasından düşük olamaz.' });
    }

    // ── ENERJİ TÜKETİMİNİ BACKEND HESAPLAR ──
    // Şarj süresi = şu an - oturum başlangıcı (Simülasyon hızı faktörü ile çarpılmış)
    const SIM_SPEED_FACTOR = 30; // Frontend ile aynı olmalı
    const now = new Date();
    const startTime = new Date(session.start_time);
    const realDurationMs = Math.max(now - startTime, 0);
    const chargingDurationHours = (realDurationMs * SIM_SPEED_FACTOR) / (1000 * 60 * 60);

    // Gerçek güç = min(istasyon gücü, araç kapasitesi)
    const actualPower = Math.min(session.power || 50, session.max_charge_rate || 50);

    // Tüketilen enerji = güç × süre (kWh)
    let energyConsumed = actualPower * chargingDurationHours;

    // Batarya kapasitesini aşamaz (fiziksel sınır)
    if (session.battery_capacity) {
        const maxPossibleEnergy = session.battery_capacity * ((batteryEnd - session.battery_start) / 100);
        energyConsumed = Math.min(energyConsumed, Math.max(maxPossibleEnergy, 0));
    }

    // En az 0 kWh
    energyConsumed = Math.max(energyConsumed, 0);

    // Gerçek maliyet
    const cost = energyConsumed * session.price_per_kwh;

    // Depozitoyu Yeniden Hesapla ve Mahsuplaşma Tutarını Bul
    let refundAmount = 0;
    if (session.start_slot && session.end_slot && session.power && session.max_charge_rate) {
        function timeToMins(t) {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        }
        let startMins = timeToMins(session.start_slot);
        let endMins = timeToMins(session.end_slot);
        if (endMins <= startMins) endMins += 24 * 60;
        const durationHours = (endMins - startMins) / 60;
        
        const depositPaid = durationHours * actualPower * session.price_per_kwh;
        
        refundAmount = depositPaid - cost;
    }

    try {
        db.transaction(() => {
            // Oturumu güncelle
            db.prepare(
                `UPDATE sessions SET
                    end_time = ?,
                    energy_consumed = ?,
                    cost = ?,
                    battery_end = ?,
                    status = 'completed'
                 WHERE id = ?`
            ).run(new Date().toISOString(), energyConsumed, cost, batteryEnd, req.params.id);

            // Bakiye mahsuplaşması (Artan para iade edilir, eksiyse kesilir)
            if (refundAmount !== 0) {
                db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refundAmount, req.user.id);
            }

            // Rezervasyonu tamamla
            if (session.reservation_id) {
                db.prepare("UPDATE reservations SET status = 'completed' WHERE id = ?").run(session.reservation_id);

                // Şarj ünitesini tekrar available yap
                const reservation = db.prepare('SELECT charger_id FROM reservations WHERE id = ?').get(session.reservation_id);
                if (reservation) {
                    db.prepare("UPDATE chargers SET status = 'available' WHERE id = ?").run(reservation.charger_id);
                }
            }
        })();
    } catch (e) {
        return res.status(500).json({ error: 'Şarj durdurulurken bir hata oluştu.' });
    }

    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

    // Bildirim gönder
    let notifMessage = `Şarj işleminiz tamamlandı. Toplam Tüketim: ${energyConsumed.toFixed(2)} kWh, Maliyet: ${cost.toFixed(2)} ₺.`;
    if (refundAmount > 0) {
        notifMessage += ` İade Edilen Tutar: ${refundAmount.toFixed(2)} ₺ cüzdanınıza eklendi.`;
    } else if (refundAmount < 0) {
        notifMessage += ` Ek Tutar: ${Math.abs(refundAmount).toFixed(2)} ₺ cüzdanınızdan tahsil edildi.`;
    }

    createNotification(
        req.user.id,
        'wallet_topup', // Bakiye işlemi olduğu için veya yeni bir tip eklenebilir 'charging_completed'
        '⚡ Şarj İşlemi Tamamlandı',
        notifMessage,
        { sessionId: req.params.id, energyConsumed, cost, refundAmount }
    );

    res.json({
        message: 'Şarj tamamlandı.',
        session: updated,
        receipt: {
            receiptNo: 'RCP-' + Date.now(),
            chargingDuration: (chargingDurationHours * 60).toFixed(0) + ' dk',
            energyConsumed: energyConsumed.toFixed(2) + ' kWh',
            pricePerKwh: session.price_per_kwh.toFixed(2) + ' ₺',
            totalCost: cost.toFixed(2) + ' ₺',
            depositRefund: refundAmount > 0 ? refundAmount.toFixed(2) + ' ₺' : '0.00 ₺',
            batteryStart: session.battery_start + '%',
            batteryEnd: batteryEnd + '%',
        },
    });
});

module.exports = router;
