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
        console.error('Audit logs getirme hatası:', err);
        res.status(500).json({ error: 'Denetim kayıtları alınırken bir hata oluştu.' });
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
        console.error('Kullanıcıları getirme hatası:', err);
        res.status(500).json({ error: 'Kullanıcılar alınırken bir hata oluştu.' });
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
        return res.status(400).json({ error: 'Rol (is_admin veya is_operator) belirtilmelidir.' });
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
            return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        }
        
        // Audit log
        logAction(req.user.id, 'ROLE_CHANGED', { targetUserId: id, newRole: newRoleStr }, req.ip);

        res.json({ message: 'Kullanıcı rolü başarıyla güncellendi.' });
    } catch (err) {
        console.error('Kullanıcı rolü güncelleme hatası:', err);
        res.status(500).json({ error: 'Rol güncellenirken bir hata oluştu.' });
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
        return res.status(400).json({ error: 'Geçersiz durum.' });
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
                    
                    // Audit Log (Sistem tarafından iptal edildiğini belirtmek için admin ID kullanıyoruz)
                    logAction(req.user.id, 'AUTO_CANCEL_RESERVATION', { reservationId: r.id, reason: 'Charger marked offline', refunded: r.total_price }, req.ip);
                    cancelledCount++;
                }
            }
            return cancelledCount;
        });

        const cancelledCount = performUpdate();
        logAction(req.user.id, 'CHARGER_STATUS_CHANGED', { chargerId, newStatus: status, cancelledReservations: cancelledCount }, req.ip);
        
        let msg = 'Şarj ünitesi durumu başarıyla güncellendi.';
        if (cancelledCount > 0) msg += ` Bu üniteye ait ${cancelledCount} adet aktif rezervasyon otomatik olarak iptal edildi ve ücretleri iade edildi.`;
        
        res.json({ message: msg });
    } catch (err) {
        if (err.message === 'ChargerNotFound') {
            return res.status(404).json({ error: 'Şarj ünitesi bulunamadı.' });
        }
        console.error('Şarj ünitesi güncellenirken hata:', err);
        res.status(500).json({ error: 'İşlem sırasında bir hata oluştu.' });
    }
});

module.exports = router;
