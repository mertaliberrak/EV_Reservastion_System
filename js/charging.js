/**
 * EVCharge — Şarj Oturumu Mantığı (EV-15, EV-16, EV-18)
 * API tabanlı oturum yönetimi + gerçekçi frontend simülasyonu.
 * Canlı izleme: enerji tüketimi, tahmini kalan süre, maliyet, batarya seviyesi.
 */

const Charging = {
    activeSession: null,
    timer: null,
    startedAt: null, // JS timestamp — geçen süre hesabı için

    // ── Şarj oturumu başlat (EV-15) — API üzerinden ──
    async startSession(reservationId, batteryStart = 20, targetBattery = 100) {
        try {
            const data = await API.startSession(reservationId, batteryStart);
            this.startedAt = Date.now();
            this.activeSession = {
                id: data.session.id,
                reservationId,
                startTime: data.session.start_time,
                pricePerKwh: data.session.price_per_kwh,
                batteryStart: batteryStart,
                batteryPercent: batteryStart,
                targetBattery: targetBattery,
                energyConsumed: 0,
                cost: 0,
                status: 'charging',
                // Araç ve şarj ünitesi bilgileri (reservation'dan gelecek)
                chargerPower: data.session.charger_power || 50,   // kW
                batteryCapacity: data.session.battery_capacity || 60, // kWh
                maxChargeRate: data.session.max_charge_rate || 50,  // kW
                vehicleName: data.session.vehicle_name || '',
                stationName: data.session.station_name || '',
                connectorType: data.session.connector_type || '',
            };

            // Gerçek şarj hızı = min(şarj ünitesi gücü, araç max şarj hızı)
            this.activeSession.actualChargeRate = Math.min(
                this.activeSession.chargerPower,
                this.activeSession.maxChargeRate
            );

            return { success: true, session: this.activeSession };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    // ── Geçen süreyi hesapla ──
    getElapsedTime() {
        if (!this.startedAt) return { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 };
        const diff = Math.floor((Date.now() - this.startedAt) / 1000);
        return {
            hours: Math.floor(diff / 3600),
            minutes: Math.floor((diff % 3600) / 60),
            seconds: diff % 60,
            totalSeconds: diff,
        };
    },

    // ── Tahmini kalan süreyi hesapla ──
    getEstimatedRemaining() {
        if (!this.activeSession || this.activeSession.status !== 'charging') {
            return { minutes: 0, text: '-' };
        }
        const s = this.activeSession;
        const remainingPercent = s.targetBattery - s.batteryPercent;
        if (remainingPercent <= 0) return { minutes: 0, text: 'Tamamlandı' };

        // Kalan enerji (kWh) = batarya kapasitesi × kalan yüzde / 100
        const remainingEnergy = s.batteryCapacity * (remainingPercent / 100);

        // Dinamik şarj hızı (batarya %80+ sonrası yavaşlama simülasyonu)
        let effectiveRate = s.actualChargeRate;
        if (s.batteryPercent > 80) {
            effectiveRate *= 0.5; // %80 sonrası tapering
        }

        // Kalan süre (saat) = kalan enerji / etkili güç
        const remainingHours = remainingEnergy / Math.max(effectiveRate, 1);
        const totalMinutes = Math.ceil(remainingHours * 60);

        if (totalMinutes >= 60) {
            const hrs = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            return { minutes: totalMinutes, text: `~${hrs} sa ${mins} dk` };
        }
        return { minutes: totalMinutes, text: `~${totalMinutes} dk` };
    },

    // ── Canlı izleme simülasyonu (EV-16) — gerçekçi fizik ──
    simulateCharging(onUpdate, onComplete) {
        if (!this.activeSession) return;

        const TICK_MS = 1000; // Her 1 saniyede bir güncelle
        // Simülasyon hızlandırma: 1 saniye = 1 dakika gerçek şarj
        const SIM_MINUTES_PER_TICK = 1;

        this.timer = setInterval(() => {
            if (!this.activeSession || this.activeSession.status !== 'charging') {
                clearInterval(this.timer);
                return;
            }

            const s = this.activeSession;

            // Dinamik şarj hızı — %80 üstünde tapering
            let currentRate = s.actualChargeRate;
            if (s.batteryPercent > 80) {
                // Lineer azalma: %80'de tam güç, %100'de %25 güç
                const factor = 1 - 0.75 * ((s.batteryPercent - 80) / 20);
                currentRate = s.actualChargeRate * Math.max(factor, 0.25);
            }

            // Bu tick'te eklenen enerji (kWh)
            const hoursPerTick = SIM_MINUTES_PER_TICK / 60;
            const energyThisTick = currentRate * hoursPerTick;

            s.energyConsumed += energyThisTick;

            // Batarya yüzdesi artışı
            const percentIncrease = (energyThisTick / s.batteryCapacity) * 100;
            s.batteryPercent += percentIncrease;

            // Maliyet hesabı
            s.cost = s.energyConsumed * s.pricePerKwh;

            // Mevcut şarj hızını kaydet (UI için)
            s.currentChargeRate = currentRate;

            // Hedef bataryaya veya %100'e ulaştıysa
            if (s.batteryPercent >= s.targetBattery) {
                s.batteryPercent = s.targetBattery;
                s.cost = s.energyConsumed * s.pricePerKwh;
                clearInterval(this.timer);
                this.timer = null;
                // Son UI güncellemesi — %100 göstermek için
                if (onUpdate) onUpdate(s);
                this.stopSession();
                if (onComplete) onComplete(s);
                return;
            }

            if (onUpdate) onUpdate(s);
        }, TICK_MS);
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
