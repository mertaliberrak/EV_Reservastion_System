/**
 * EVCharge — Reports Routes
 * POST  /api/reports          — Kullanıcı istasyon sorunu bildirir
 * GET   /api/reports          — Kullanıcının kendi bildirimleri
 * GET   /api/reports/admin    — Admin: tüm bildirimleri getirir
 * PATCH /api/reports/:id      — Admin: bildirim durumunu günceller
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');

router.use(auth);

// Geçerli kategoriler
const VALID_CATEGORIES = [
    'broken_charger',      // Arızalı şarj ünitesi
    'payment_issue',       // Ödeme sorunu
    'dirty_station',       // Kirli/bakımsız istasyon
    'access_problem',      // Erişim sorunu
    'wrong_info',          // Yanlış bilgi (fiyat, konum vs.)
    'safety_concern',      // Güvenlik endişesi
    'other',               // Diğer
];

// ══════════════════════════════════════
//  POST /api/reports — Report a problem
// ══════════════════════════════════════
router.post('/', [
    body('stationId').isInt().withMessage('Station ID is required.'),
    body('category').isIn(VALID_CATEGORIES).withMessage('Please select a valid category.'),
    body('description').isLength({ min: 10, max: 1000 }).withMessage('Description must be at least 10 and at most 1000 characters long.'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { stationId, category, description } = req.body;

    // İstasyon var mı?
    const station = db.prepare('SELECT id, name FROM stations WHERE id = ?').get(stationId);
    if (!station) {
        return res.status(404).json({ error: 'Station not found.' });
    }

    // Spam kontrolü: son 1 saat içinde aynı istasyona bildirim var mı?
    const recentReport = db.prepare(
        `SELECT id FROM station_reports 
         WHERE user_id = ? AND station_id = ? AND created_at > datetime('now', '-1 hour')`
    ).get(req.user.id, stationId);

    if (recentReport) {
        return res.status(429).json({ error: 'You have already sent a report for this station in the last 1 hour.' });
    }

    const result = db.prepare(
        `INSERT INTO station_reports (user_id, station_id, category, description)
         VALUES (?, ?, ?, ?)`
    ).run(req.user.id, stationId, category, description);

    // Audit log
    logAction(req.user.id, 'STATION_REPORT', { reportId: result.lastInsertRowid, stationId, category }, req.ip);

    const report = db.prepare('SELECT * FROM station_reports WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
        message: 'Your report has been successfully submitted. Thank you!',
        report,
    });
});

// ══════════════════════════════════════
//  GET /api/reports — Kendi bildirimlerim
// ══════════════════════════════════════
router.get('/', (req, res) => {
    const reports = db.prepare(
        `SELECT r.*, s.name AS station_name
         FROM station_reports r
         JOIN stations s ON r.station_id = s.id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC`
    ).all(req.user.id);

    res.json({ reports });
});

// ══════════════════════════════════════
//  GET /api/reports/admin — Tüm bildirimler (Admin)
// ══════════════════════════════════════
router.get('/admin', (req, res) => {
    // Admin veya Operatör kontrolü
    if (!req.user.is_admin && !req.user.is_operator) {
        return res.status(403).json({ error: 'You do not have permission.' });
    }

    const reports = db.prepare(
        `SELECT r.*, s.name AS station_name, u.name AS user_name, u.email AS user_email
         FROM station_reports r
         JOIN stations s ON r.station_id = s.id
         JOIN users u ON r.user_id = u.id
         ORDER BY r.created_at DESC
         LIMIT 200`
    ).all();

    res.json({ reports });
});

// ══════════════════════════════════════
//  PATCH /api/reports/:id — Update status (Admin)
// ══════════════════════════════════════
router.patch('/:id', [
    body('status').isIn(['open', 'in_progress', 'resolved', 'dismissed']).withMessage('Please select a valid status.'),
], (req, res) => {
    // Admin veya Operatör kontrolü
    if (!req.user.is_admin && !req.user.is_operator) {
        return res.status(403).json({ error: 'You do not have permission.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { status } = req.body;
    const adminNote = req.body.adminNote || null;

    const report = db.prepare('SELECT * FROM station_reports WHERE id = ?').get(req.params.id);
    if (!report) {
        return res.status(404).json({ error: 'Report not found.' });
    }

    db.prepare(
        'UPDATE station_reports SET status = ?, admin_note = ? WHERE id = ?'
    ).run(status, adminNote, req.params.id);

    logAction(req.user.id, 'REPORT_STATUS_CHANGED', { reportId: req.params.id, newStatus: status }, req.ip);

    res.json({ message: 'Report status updated.' });
});

module.exports = router;
