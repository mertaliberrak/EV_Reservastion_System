/**
 * EVCharge — Vehicle Routes
 * GET    /api/vehicles     — Kullanıcının araçlarını listele
 * POST   /api/vehicles     — Araç ekle
 * DELETE /api/vehicles/:id — Araç sil
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const auth = require('../middleware/auth');

// Tüm route'lar auth gerektirir
router.use(auth);

// ══════════════════════════════════════
//  GET /api/vehicles
// ══════════════════════════════════════
router.get('/', (req, res) => {
    const vehicles = db.prepare(
        'SELECT * FROM vehicles WHERE user_id = ?'
    ).all(req.user.id);

    res.json({ vehicles });
});

// ══════════════════════════════════════
//  POST /api/vehicles
// ══════════════════════════════════════
router.post('/', [
    body('brand').trim().notEmpty().withMessage('Marka gereklidir.'),
    body('model').trim().notEmpty().withMessage('Model gereklidir.'),
    body('batteryCapacity').isFloat({ min: 1 }).withMessage('Geçerli batarya kapasitesi giriniz.'),
    body('connectorType').isIn(['Type 2', 'CCS', 'CHAdeMO']).withMessage('Geçerli konnektör tipi seçiniz.'),
    body('maxChargeRate').isFloat({ min: 1 }).withMessage('Geçerli şarj hızı giriniz.'),
    body('plateNumber').trim().matches(/^(0[1-9]|[1-7][0-9]|8[01])\s?[a-zA-Z]{1,3}\s?\d{2,4}$/).withMessage('Lütfen geçerli bir Türkiye plakası giriniz (Örn: 34 ABC 123).'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { brand, model, batteryCapacity, connectorType, maxChargeRate, plateNumber } = req.body;

    const result = db.prepare(
        `INSERT INTO vehicles (user_id, brand, model, battery_capacity, connector_type, max_charge_rate, plate_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, brand, model, batteryCapacity, connectorType, maxChargeRate, plateNumber.toUpperCase());

    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({ message: 'Araç eklendi.', vehicle });
});

// ══════════════════════════════════════
//  DELETE /api/vehicles/:id
// ══════════════════════════════════════
router.delete('/:id', (req, res) => {
    const vehicle = db.prepare(
        'SELECT * FROM vehicles WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!vehicle) {
        return res.status(404).json({ error: 'Araç bulunamadı veya size ait değil.' });
    }

    // Aktif rezervasyon kontrolü
    const activeReservations = db.prepare(
        `SELECT r.*, c.power, c.price_per_kwh
         FROM reservations r
         JOIN chargers c ON r.charger_id = c.id
         WHERE r.vehicle_id = ? AND r.user_id = ? AND r.status = 'active'`
    ).all(req.params.id, req.user.id);

    if (activeReservations.length > 0 && req.query.force !== 'true') {
        return res.status(409).json({
            error: `Bu araca bağlı ${activeReservations.length} aktif rezervasyonunuz var. Aracı silerseniz bu rezervasyonlar iptal politikasına göre otomatik olarak iptal edilecektir.`,
            activeCount: activeReservations.length,
            requiresForce: true
        });
    }

    // force=true ise: Aktif rezervasyonları iade kurallarına göre iptal et ve aracı sil
    try {
        db.transaction(() => {
            const now = new Date();
            function timeToMins(t) {
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
            }

            for (const r of activeReservations) {
                const resStart = new Date(`${r.date}T${r.start_slot}:00`);
                const diffMins = (resStart - now) / (1000 * 60);

                let refundRatio = 0;
                if (diffMins >= 60) {
                    refundRatio = 1.0;
                } else if (diffMins >= 0) {
                    refundRatio = 0.5;
                }

                let startMins = timeToMins(r.start_slot);
                let endMins = timeToMins(r.end_slot);
                if (endMins <= startMins) endMins += 24 * 60;
                const durationHours = (endMins - startMins) / 60;

                const actualPower = Math.min(r.power, vehicle.max_charge_rate);
                const estimatedCost = durationHours * actualPower * r.price_per_kwh;
                const refundAmount = estimatedCost * refundRatio;

                db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(r.id);
                if (refundAmount > 0) {
                    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refundAmount, req.user.id);
                }
            }

            db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
        })();
    } catch (e) {
        return res.status(500).json({ error: 'Araç silinirken bir hata oluştu.' });
    }

    const cancelledCount = activeReservations.length;
    const msg = cancelledCount > 0
        ? `Araç silindi. ${cancelledCount} aktif rezervasyon iptal edildi ve iade kurallarına göre bakiyenize yansıtıldı.`
        : 'Araç silindi.';

    res.json({ message: msg });
});

module.exports = router;
