const db = require('../db');
const { createNotification } = require('./notificationHelper');
const { logAction } = require('./auditLogger');

function initNoShowCron() {
    console.log('[Cron] No-Show (5 Min) control service started. (Every minute)');

    setInterval(() => {
        try {
            // Get active reservations
            const reservations = db.prepare(`SELECT * FROM reservations WHERE status = 'active'`).all();
            const now = new Date();

            reservations.forEach(res => {
                // Create start time
                const startDateTime = new Date(`${res.date}T${res.start_slot}:00`);

                // Difference in minutes
                const diffMins = (now - startDateTime) / (1000 * 60);

                // If 5 minutes (or more) have passed since the start time
                if (diffMins >= 5) {
                    // Check if charging session has started
                    const sessionExists = db.prepare(`SELECT id FROM sessions WHERE reservation_id = ?`).get(res.id);

                    if (!sessionExists) {
                        // Oturum başlamamış, No-Show işlemini uygula
                        db.transaction(() => {
                            // Durumu no-show yap
                            db.prepare(`UPDATE reservations SET status = 'no-show' WHERE id = ?`).run(res.id);

                            // Station'ı available yapmaya gerek var mı? Hayır, zaten charger tablosunda durumu "available" veya "occupied" oluyor, rezervasyon onu "active" olarak blockluyor map üzerinden.
                            // Biz sadece rezervasyonu iptal ediyoruz ki başkaları rezervasyon yapabilsin.
                        })();

                        // Log oluştur
                        logAction(res.user_id, 'NO_SHOW_AUTO_CANCEL', { reservationId: res.id, reason: 'Charging did not start within 5 minutes' }, 'SYSTEM');

                        // Bildirim gönder
                        const message = `Your reservation on ${res.date} from ${res.start_slot} - ${res.end_slot} has been cancelled due to No-Show (charging did not start within 5 minutes).`;

                        createNotification(
                            res.user_id,
                            'reservation_cancelled',
                            '⏱️ Reservation Cancelled (No-Show)',
                            message,
                            { reservationId: res.id }
                        );

                        console.log(`[Cron] Reservation #${res.id} has been automatically cancelled due to No-Show.`);
                    }
                }
            });
        } catch (err) {
            console.error('[Cron] Error in No-show control:', err);
        }
    }, 60 * 1000); // 1 dakikada bir çalışır
}

module.exports = initNoShowCron;
