/**
 * EVCharge — Bildirim Yardımcısı
 * Bildirim oluşturma işlemleri için merkezi modül.
 */

const db = require('../db');

/**
 * Kullanıcıya bildirim oluştur
 * @param {number} userId - Bildirim alacak kullanıcı ID
 * @param {string} type - Bildirim tipi: 'reservation_created', 'reservation_cancelled', 'station_offline', 'admin_cancelled'
 * @param {string} title - Bildirim başlığı
 * @param {string} message - Bildirim mesajı
 * @param {object} options - Opsiyonel alanlar { reservationId, stationName }
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
        console.error('Bildirim oluşturma hatası:', err);
    }
}

module.exports = { createNotification };
