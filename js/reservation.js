/**
 * EVCharge — Rezervasyon Mantığı (EV-12, EV-13)
 * API tabanlı — tüm kontroller backend'de yapılır.
 */

const Reservation = {
    // ── Araç-şarj uyumluluk kontrolü (EV-13) — frontend tarafı ──
    checkCompatibility(vehicle, charger) {
        if (!vehicle || !charger) return false;
        return vehicle.connector_type === charger.connector_type;
    },

    // ── Rezervasyon oluştur (EV-12) — API üzerinden ──
    async create(data) {
        try {
            const result = await API.createReservation(data);
            return { success: true, reservation: result.reservation };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    // ── Rezervasyon iptal — API üzerinden ──
    async cancel(reservationId) {
        try {
            await API.cancelReservation(reservationId);
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    // ── Aktif rezervasyonları getir — API üzerinden ──
    async getActiveReservations() {
        try {
            const reservations = await API.getReservations();
            return reservations.filter(r => r.status === 'active');
        } catch (err) {
            return [];
        }
    },
};
