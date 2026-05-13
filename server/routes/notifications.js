/**
 * EVCharge — Notification Routes
 * GET    /api/notifications         — Kullanıcının bildirimlerini getir
 * PATCH  /api/notifications/:id/read — Bildirimi okundu olarak işaretle
 * PATCH  /api/notifications/read-all — Tüm bildirimleri okundu işaretle
 * GET    /api/notifications/unread-count — Okunmamış bildirim sayısı
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Tüm route'lar auth gerektirir
router.use(auth);

// ══════════════════════════════════════
//  GET /api/notifications
// ══════════════════════════════════════
router.get('/', (req, res) => {
    try {
        const notifications = db.prepare(`
            SELECT * FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 50
        `).all(req.user.id);

        res.json({ notifications });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: 'Error fetching notifications.' });
    }
});

// ══════════════════════════════════════
//  GET /api/notifications/unread-count
// ══════════════════════════════════════
router.get('/unread-count', (req, res) => {
    try {
        const result = db.prepare(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
        ).get(req.user.id);

        res.json({ count: result.count });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching notification count.' });
    }
});

// ══════════════════════════════════════
//  PATCH /api/notifications/:id/read
// ══════════════════════════════════════
router.patch('/:id/read', (req, res) => {
    try {
        const info = db.prepare(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
        ).run(req.params.id, req.user.id);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Notification not found.' });
        }

        res.json({ message: 'Notification marked as read.' });
    } catch (err) {
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

// ══════════════════════════════════════
//  PATCH /api/notifications/read-all
// ══════════════════════════════════════
router.patch('/read-all', (req, res) => {
    try {
        db.prepare(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
        ).run(req.user.id);

        res.json({ message: 'All notifications marked as read.' });
    } catch (err) {
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

module.exports = router;
