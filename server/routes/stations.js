/**
 * EVCharge — Station Routes
 * GET /api/stations           — Tüm istasyonlar (şarj üniteleriyle)
 * GET /api/stations/recommend — Akıllı istasyon tavsiyesi
 * GET /api/stations/:id       — Tek istasyon detay
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Tüm route'lar auth gerektirir
router.use(auth);

// ── Yardımcı: İstasyona şarj ünitelerini ekle ──
function attachChargers(station) {
    station.chargers = db.prepare(
        'SELECT * FROM chargers WHERE station_id = ?'
    ).all(station.id);
    return station;
}

// ── Mesafe Hesaplama Yardımcı Fonksiyonu (Haversine) ──
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Dünya'nın yarıçapı (km)
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ══════════════════════════════════════
//  GET /api/stations
// ══════════════════════════════════════
router.get('/', (req, res) => {
    const stations = db.prepare('SELECT * FROM stations').all();

    // Her istasyona şarj ünitelerini ekle
    stations.forEach(attachChargers);

    res.json({ stations });
});

// ══════════════════════════════════════
//  GET /api/stations/recommend
//  Akıllı Tavsiye Motoru — Mesafe, müsaitlik,
//  konnektör uyumluluğu ve fiyata göre sıralama
// ══════════════════════════════════════
router.get('/recommend', (req, res) => {
    const { lat, lng, vehicle_id, max_distance_km } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ error: 'Enlem (lat) ve boylam (lng) parametreleri zorunludur.' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxDist = max_distance_km ? parseFloat(max_distance_km) : null;

    // Ağırlık katsayıları (mesafe=0.40, fiyat=0.30, müsaitlik=0.30)
    const weights = { distance: 0.40, price: 0.30, availability: 0.30 };

    // Araç bilgisi varsa soket tipini al
    let userVehicle = null;
    if (vehicle_id) {
        userVehicle = db.prepare(
            'SELECT id, brand, model, connector_type, max_charge_rate, battery_capacity FROM vehicles WHERE id = ? AND user_id = ?'
        ).get(vehicle_id, req.user.id);
    }
    const userConnectorType = userVehicle ? userVehicle.connector_type : null;

    const stations = db.prepare('SELECT * FROM stations').all();
    const candidates = [];

    stations.forEach(station => {
        const allChargers = db.prepare('SELECT * FROM chargers WHERE station_id = ?').all(station.id);

        // 1. Uyumluluk Filtresi
        let compatibleChargers = userConnectorType
            ? allChargers.filter(c => c.connector_type === userConnectorType)
            : allChargers;

        if (compatibleChargers.length === 0) return;

        // 2. Müsaitlik Filtresi
        const availableChargers = compatibleChargers.filter(c => c.status === 'available');
        if (availableChargers.length === 0) return;

        // 3. Mesafe
        const distance = getDistanceFromLatLonInKm(userLat, userLng, station.lat, station.lng);
        if (maxDist && distance > maxDist) return;

        // 4. Fiyat
        const minPrice = Math.min(...availableChargers.map(c => c.price_per_kwh));

        // 5. En iyi şarj cihazı
        const bestCharger = availableChargers.reduce((best, c) =>
            c.price_per_kwh < best.price_per_kwh ? c : best
        , availableChargers[0]);

        candidates.push({
            id: station.id,
            name: station.name,
            address: station.address,
            lat: station.lat,
            lng: station.lng,
            operating_hours: station.operating_hours,
            chargers: allChargers,
            available_chargers_count: availableChargers.length,
            total_chargers_count: allChargers.length,
            compatible_chargers_count: compatibleChargers.length,
            distance_km: Math.round(distance * 100) / 100,
            min_price: minPrice,
            max_power: Math.max(...availableChargers.map(c => c.power)),
            best_charger: {
                id: bestCharger.id,
                type: bestCharger.type,
                power: bestCharger.power,
                connector_type: bestCharger.connector_type,
                price_per_kwh: bestCharger.price_per_kwh,
            },
        });
    });

    if (candidates.length === 0) {
        return res.json({
            recommendations: [],
            vehicle: userVehicle || null,
            weights,
            message: 'Kriterlere uygun istasyon bulunamadı.',
        });
    }

    // ── Normalizasyon ──
    const dists  = candidates.map(c => c.distance_km);
    const prices = candidates.map(c => c.min_price);
    const avails = candidates.map(c => c.available_chargers_count);

    const minDistV  = Math.min(...dists);
    const maxDistV  = Math.max(...dists);
    const minPriceV = Math.min(...prices);
    const maxPriceV = Math.max(...prices);
    const minAvail  = Math.min(...avails);
    const maxAvail  = Math.max(...avails);

    function normalize(val, min, max, invert = false) {
        if (max === min) return 1;
        const norm = (val - min) / (max - min);
        return invert ? (1 - norm) : norm;
    }

    // ── Skor hesapla (0-100, yüksek = daha iyi) ──
    candidates.forEach(c => {
        const distScore  = normalize(c.distance_km, minDistV, maxDistV, true);
        const priceScore = normalize(c.min_price, minPriceV, maxPriceV, true);
        const availScore = normalize(c.available_chargers_count, minAvail, maxAvail, false);

        const rawScore = (distScore * weights.distance)
                       + (priceScore * weights.price)
                       + (availScore * weights.availability);

        c.recommendation_score = Math.round(rawScore * 100);
        c.score_details = {
            distance_score:     Math.round(distScore * 100),
            price_score:        Math.round(priceScore * 100),
            availability_score: Math.round(availScore * 100),
        };
    });

    candidates.sort((a, b) => b.recommendation_score - a.recommendation_score);

    if (candidates.length > 0) {
        candidates[0].is_top_pick = true;
    }

    res.json({
        recommendations: candidates,
        vehicle: userVehicle || null,
        weights,
        total_found: candidates.length,
    });
});

// ══════════════════════════════════════
//  GET /api/stations/:id
// ══════════════════════════════════════
router.get('/:id', (req, res) => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);

    if (!station) {
        return res.status(404).json({ error: 'İstasyon bulunamadı.' });
    }

    attachChargers(station);

    res.json({ station });
});

module.exports = router;
