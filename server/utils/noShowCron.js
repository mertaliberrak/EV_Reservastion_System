const db = require('../db');
const { createNotification } = require('./notificationHelper');
const { logAction } = require('./auditLogger');

function initNoShowCron() {
    console.log('[Cron] No-Show (5 Dk) kontrol servisi başlatıldı. (Her dakika çalışacak)');

    setInterval(() => {
        try {
            // Aktif rezervasyonları çek
            const reservations = db.prepare(`SELECT * FROM reservations WHERE status = 'active'`).all();
            const now = new Date();

            reservations.forEach(res => {
                // Başlangıç saatini oluştur
                const startDateTime = new Date(`${res.date}T${res.start_slot}:00`);
                
                // Aradaki fark dakika cinsinden
                const diffMins = (now - startDateTime) / (1000 * 60);

                // Eğer başlangıç saatinden 5 dakika (veya daha fazla) geçmişse
                if (diffMins >= 5) {
                    // Şarj oturumu başlamış mı kontrol et
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
                        logAction(res.user_id, 'NO_SHOW_AUTO_CANCEL', { reservationId: res.id, reason: '5 dakika içinde şarj başlatılmadı' }, 'SYSTEM');

                        // Bildirim gönder
                        const message = `${res.date} tarihli ${res.start_slot} - ${res.end_slot} rezervasyonunuzda, başlangıç saatinden itibaren 5 dakika içinde şarj başlatılmadığı için işlem iptal edilmiş (No-Show) ve depozitonuz alıkonulmuştur.`;
                        
                        createNotification(
                            res.user_id,
                            'reservation_cancelled',
                            '⏱️ Rezervasyon İptal Edildi (No-Show)',
                            message,
                            { reservationId: res.id }
                        );
                        
                        console.log(`[Cron] Rezervasyon #${res.id} "No-Show" sebebiyle otomatik iptal edildi.`);
                    }
                }
            });
        } catch (err) {
            console.error('[Cron] No-show kontrolünde hata:', err);
        }
    }, 60 * 1000); // 1 dakikada bir çalışır
}

module.exports = initNoShowCron;
