/**
 * EVCharge — Station Routes
 * GET /api/stations     — Tüm istasyonlar (şarj üniteleriyle)
 * GET /api/stations/:id — Tek istasyon detay
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Tüm route'lar auth gerektirir
router.use(auth);

// ── Yardımcı: İstasyona şarj ünitelerini ekle ──
function attachChargers(station) {
    station.chargers = db.prepare(
        'SELECT * FROM chargers WHERE station_id = ?'
    ).all(station.id);
    return station;
}

// ══════════════════════════════════════
//  GET /api/stations
// ══════════════════════════════════════
router.get('/', (req, res) => {
    const stations = db.prepare('SELECT * FROM stations').all();

    // Her istasyona şarj ünitelerini ekle
    stations.forEach(attachChargers);

    res.json({ stations });
});

// ══════════════════════════════════════
//  GET /api/stations/:id
// ══════════════════════════════════════
router.get('/:id', (req, res) => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);

    if (!station) {
        return res.status(404).json({ error: 'İstasyon bulunamadı.' });
    }

    attachChargers(station);

    res.json({ station });
});

module.exports = router;
