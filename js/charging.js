/**
 * EVCharge — Şarj Oturumu Mantığı (EV-15, EV-16, EV-18)
 * API tabanlı oturum yönetimi + frontend simülasyonu.
 */

const Charging = {
    activeSession: null,
    timer: null,

    // ── Şarj oturumu başlat (EV-15) — API üzerinden ──
    async startSession(reservationId, batteryStart = 20) {
        try {
            const data = await API.startSession(reservationId, batteryStart);
            this.activeSession = {
                id: data.session.id,
                reservationId,
                startTime: data.session.start_time,
                pricePerKwh: data.session.price_per_kwh,
                batteryPercent: batteryStart,
                energyConsumed: 0,
                cost: 0,
                status: 'charging',
            };
            return { success: true, session: this.activeSession };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    // ── Canlı izleme simülasyonu (EV-16) — frontend tarafı ──
    simulateCharging(onUpdate, onComplete) {
        if (!this.activeSession) return;

        this.timer = setInterval(() => {
            if (!this.activeSession || this.activeSession.status !== 'charging') {
                clearInterval(this.timer);
                return;
            }

            // Her saniye ~0.5 kWh ekle (hızlandırılmış simülasyon)
            this.activeSession.energyConsumed += 0.5;
            this.activeSession.batteryPercent += 0.8;
            this.activeSession.cost = this.activeSession.energyConsumed * this.activeSession.pricePerKwh;

            if (this.activeSession.batteryPercent >= 100) {
                this.activeSession.batteryPercent = 100;
                this.stopSession();
                if (onComplete) onComplete(this.activeSession);
                return;
            }

            if (onUpdate) onUpdate(this.activeSession);
        }, 1000);
    },

    // ── Şarjı durdur — API'ye kaydet ──
    async stopSession() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        if (!this.activeSession) return null;

        this.activeSession.status = 'completed';

        try {
            const data = await API.stopSession(
                this.activeSession.id,
                this.activeSession.batteryPercent
            );
            this.activeSession.receipt = data.receipt;
            return this.activeSession;
        } catch (err) {
            console.error('Oturum kaydedilemedi:', err);
            return this.activeSession;
        }
    },

    // ── Dijital makbuz oluştur (EV-18) ──
    generateReceipt(session) {
        if (!session) return null;

        // Backend'den gelen receipt varsa onu kullan
        if (session.receipt) return session.receipt;

        return {
            receiptNo: 'RCP-' + Date.now(),
            energyConsumed: session.energyConsumed.toFixed(2) + ' kWh',
            pricePerKwh: session.pricePerKwh.toFixed(2) + ' ₺',
            totalCost: session.cost.toFixed(2) + ' ₺',
        };
    },
};
