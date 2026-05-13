/**
 * EVCharge — Bildirim Yardımcısı
 * Bildirim oluşturma işlemleri için merkezi modül.
 */

const db = require('../db');

/**
 * Kullanıcıya bildirim oluştur
 * @param {number} userId - Notification recipient user ID
 * @param {string} type - Notification type: 'reservation_created', 'reservation_cancelled', 'station_offline', 'admin_cancelled'
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} options - Optional fields { reservationId, stationName }
 */
function createNotification(userId, type, title, message, options = {}) {
    try {
        db.prepare(`
            INSERT INTO notifications (user_id, type, title, message, reservation_id, station_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            type,
            title,
            message,
            options.reservationId || null,
            options.stationName || null
        );
    } catch (err) {
        console.error('Notification creation error:', err);
    }
}

module.exports = { createNotification };
