const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const { logAction } = require('../utils/auditLogger');
const { body, validationResult } = require('express-validator');

// Tüm rotalar için auth zorunlu
router.use(auth);

// ══════════════════════════════════════
//  POST /api/support — Yeni talep oluştur
// ══════════════════════════════════════
router.post('/', [
    body('subject').notEmpty().withMessage('Subject is required.'),
    body('category').isIn(['reservation', 'payment', 'charging', 'station', 'other']).withMessage('Please select a valid category.'),
    body('description').notEmpty().withMessage('Description is required.')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { subject, category, description, related_id } = req.body;

    try {
        const info = db.prepare(
            `INSERT INTO support_tickets (user_id, subject, category, related_id, description)
             VALUES (?, ?, ?, ?, ?)`
        ).run(req.user.id, subject, category, related_id || null, description);

        logAction(req.user.id, 'SUPPORT_TICKET_CREATED', { ticketId: info.lastInsertRowid, category }, req.ip);

        res.status(201).json({ message: 'Your support ticket has been created successfully.', id: info.lastInsertRowid });
    } catch (err) {
        console.error('Support ticket creation error:', err);
        res.status(500).json({ error: 'An error occurred while creating the support ticket.' });
    }
});

// ══════════════════════════════════════
//  GET /api/support — Kullanıcının kendi taleplerini getir
// ══════════════════════════════════════
router.get('/', (req, res) => {
    try {
        const tickets = db.prepare(
            `SELECT * FROM support_tickets
             WHERE user_id = ?
             ORDER BY created_at DESC`
        ).all(req.user.id);

        res.json({ tickets });
    } catch (err) {
        console.error('Error fetching support tickets:', err);
        res.status(500).json({ error: 'An error occurred while fetching the tickets.' });
    }
});

// ══════════════════════════════════════
//  GET /api/support/admin — Tüm talepler (Admin/Operator)
// ══════════════════════════════════════
router.get('/admin', isAdmin, (req, res) => {
    try {
        const tickets = db.prepare(
            `SELECT t.*, u.name AS user_name, u.email AS user_email
             FROM support_tickets t
             JOIN users u ON t.user_id = u.id
             ORDER BY t.created_at DESC
             LIMIT 300`
        ).all();

        res.json({ tickets });
    } catch (err) {
        console.error('Error fetching support tickets:', err);
        res.status(500).json({ error: 'An error occurred while fetching the tickets.' });
    }
});

// ══════════════════════════════════════
//  PATCH /api/support/:id — Talep durumu/notu güncelle (Admin/Operator)
// ══════════════════════════════════════
router.patch('/:id', isAdmin, [
    body('status').isIn(['open', 'in_progress', 'resolved', 'closed']).withMessage('Please select a valid status.')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { status, admin_note } = req.body;
    const { id } = req.params;

    try {
        const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }

        db.prepare(
            'UPDATE support_tickets SET status = ?, admin_note = ? WHERE id = ?'
        ).run(status, admin_note || ticket.admin_note, id);

        logAction(req.user.id, 'SUPPORT_TICKET_UPDATED', { ticketId: id, status }, req.ip);

        res.json({ message: 'Ticket updated successfully.' });
    } catch (err) {
        console.error('Error updating ticket:', err);
        res.status(500).json({ error: 'An error occurred while updating the ticket.' });
    }
});

module.exports = router;
