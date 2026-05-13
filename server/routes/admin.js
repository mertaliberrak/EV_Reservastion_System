/**
 * EVCharge — Admin Routes
 * GET /api/admin/logs — Denetim kayıtlarını (Audit logs) getirir
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const isOperatorOrAdmin = require('../middleware/isOperatorOrAdmin');
const { logAction } = require('../utils/auditLogger');
const { createNotification } = require('../utils/notificationHelper');

// Tüm route'larda auth kontrolü yap
router.use(auth);

// ══════════════════════════════════════
// ══════════════════════════════════════
//  GET /api/admin/logs
// ══════════════════════════════════════
router.get('/logs', isAdmin, (req, res) => {
    try {
        const logs = db.prepare(`
            SELECT a.id, a.user_id, u.name as user_name, u.email as user_email, 
                   a.action, a.details, a.ip_address, a.created_at
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC
            LIMIT 500
        `).all();

        res.json({ logs });
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        res.status(500).json({ error: 'Error fetching audit logs.' });
    }
});

// ══════════════════════════════════════
// ══════════════════════════════════════
//  GET /api/admin/users
// ══════════════════════════════════════
router.get('/users', isAdmin, (req, res) => {
    try {
        const users = db.prepare(`
            SELECT id, name, email, balance, is_admin, is_operator, created_at
            FROM users
            ORDER BY created_at DESC
        `).all();
        res.json({ users });
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Error fetching users.' });
    }
});

// ══════════════════════════════════════
// ══════════════════════════════════════
//  PUT /api/admin/users/:id/role
// ══════════════════════════════════════
router.put('/users/:id/role', isAdmin, (req, res) => {
    const { is_admin, is_operator } = req.body;
    const { id } = req.params;

    if (is_admin === undefined && is_operator === undefined) {
        return res.status(400).json({ error: 'Role (is_admin or is_operator) must be specified.' });
    }

    try {
        let query = 'UPDATE users SET ';
        let params = [];
        let newRoleStr = '';

        if (is_admin !== undefined) {
            query += 'is_admin = ?, is_operator = 0';
            params.push(is_admin ? 1 : 0);
            newRoleStr = is_admin ? 'ADMIN' : 'USER';
        } else if (is_operator !== undefined) {
            query += 'is_operator = ?, is_admin = 0';
            params.push(is_operator ? 1 : 0);
            newRoleStr = is_operator ? 'OPERATOR' : 'USER';
        }

        query += ' WHERE id = ?';
        params.push(id);

        const info = db.prepare(query).run(...params);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Audit log
        logAction(req.user.id, 'ROLE_CHANGED', { targetUserId: id, newRole: newRoleStr }, req.ip);

        res.json({ message: 'User role updated successfully.' });
    } catch (err) {
        console.error('Error updating user role:', err);
        res.status(500).json({ error: 'Error updating user role.' });
    }
});

// ══════════════════════════════════════
// ══════════════════════════════════════
//  PUT /api/admin/chargers/:id/status
// ══════════════════════════════════════
router.put('/chargers/:id/status', isOperatorOrAdmin, (req, res) => {
    const { status } = req.body;
    const chargerId = req.params.id;

    if (!['available', 'occupied', 'offline'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    try {
        const performUpdate = db.transaction(() => {
            // 1. Durumu güncelle
            const info = db.prepare('UPDATE chargers SET status = ? WHERE id = ?').run(status, chargerId);
            if (info.changes === 0) {
                throw new Error('ChargerNotFound');
            }

            let cancelledCount = 0;

            // 2. Eğer offline olduysa, aktif ve gelecek rezervasyonları iptal et
            if (status === 'offline') {
                const now = new Date();
                const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                // Bugün ve gelecekteki aktif rezervasyonları bul
                const activeReservations = db.prepare(`
                    SELECT * FROM reservations 
                    WHERE charger_id = ? AND status = 'active' AND date >= ?
                `).all(chargerId, localDateStr);

                const cancelStmt = db.prepare('UPDATE reservations SET status = ? WHERE id = ?');
                const refundStmt = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');

                for (const r of activeReservations) {
                    // İptal et
                    cancelStmt.run('cancelled', r.id);

                    // Para iadesi (Tamamı)
                    if (r.total_price > 0) {
                        refundStmt.run(r.total_price, r.user_id);
                    }

                    // İstasyon adını al
                    const stationInfo = db.prepare('SELECT s.name FROM stations s JOIN chargers c ON c.station_id = s.id WHERE c.id = ?').get(chargerId);
                    const stationName = stationInfo ? stationInfo.name : 'İstasyon';

                    // Kullanıcıya bildirim gönder
                    createNotification(
                        r.user_id,
                        'station_offline',
                        '⚠️ Station Breakdown — Reservation Cancelled',
                        `The charging unit at ${stationName} station has been taken offline, so your reservation for ${r.date} between ${r.start_slot} - ${r.end_slot} has been automatically cancelled. The full amount of your payment has been refunded to your wallet.`,
                        { reservationId: r.id, stationName }
                    );

                    // Audit Log (Sistem tarafından iptal edildiğini belirtmek için admin ID kullanıyoruz)
                    logAction(req.user.id, 'AUTO_CANCEL_RESERVATION', { reservationId: r.id, reason: 'Charger marked offline', refunded: r.total_price }, req.ip);
                    cancelledCount++;
                }
            }
            return cancelledCount;
        });

        const cancelledCount = performUpdate();
        logAction(req.user.id, 'CHARGER_STATUS_CHANGED', { chargerId, newStatus: status, cancelledReservations: cancelledCount }, req.ip);

        let msg = 'Charger status updated successfully.';
        if (cancelledCount > 0) msg += ` ${cancelledCount} active reservations for this unit have been automatically cancelled and their fees refunded.`;

        res.json({ message: msg });
    } catch (err) {
        if (err.message === 'ChargerNotFound') {
            return res.status(404).json({ error: 'Charger not found.' });
        }
        console.error('Error updating charger:', err);
        res.status(500).json({ error: 'Error updating charger.' });
    }
});

// ══════════════════════════════════════
// ══════════════════════════════════════
//  DELETE /api/admin/users/:id
// ══════════════════════════════════════
router.delete('/users/:id', isAdmin, (req, res) => {
    const userId = req.params.id;

    try {
        // Super admin'i silmeyi engelle (örneğin id=1 ise veya özel bir flag varsa)
        // Eğer böyle bir kuralınız varsa buraya ekleyebilirsiniz.
        if (userId === req.user.id.toString()) {
            return res.status(400).json({ error: 'You cannot delete your own account.' });
        }

        const info = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Audit log
        logAction(req.user.id, 'USER_DELETED', { targetUserId: userId }, req.ip);

        res.json({ message: 'User deleted successfully.' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: 'Error deleting user.' });
    }
});

module.exports = router;
