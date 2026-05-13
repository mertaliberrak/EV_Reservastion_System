/**
 * EVCharge — Harita İşlemleri (Google Maps API)
 * GM-01 ~ GM-06: Haritada istasyonları göster, filtreleme, navigasyon.
 */

const MapModule = {
    map: null,
    markers: [],
    userMarker: null,
    infoWindow: null,
    stations: [],
    userPosition: null,

    // ── Haritayı başlat (GM-04) ──
    init(mapElementId) {
        // İzmir merkez koordinatları
        const izmir = { lat: 38.4237, lng: 27.1428 };

        this.map = new google.maps.Map(document.getElementById(mapElementId), {
            center: izmir,
            zoom: 12,
            styles: this.getMapStyles(),
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true,
        });

        this.infoWindow = new google.maps.InfoWindow();

        // Kullanıcı konumunu göster
        this.showUserLocation();
    },

    // ── Tüm istasyonları haritada göster (GM-01) ──
    displayStations(stations) {
        // Önceki marker'ları temizle
        this.clearMarkers();
        this.stations = stations;

        stations.forEach(station => {
            const overallStatus = this.getStationOverallStatus(station);
            const marker = new google.maps.Marker({
                position: { lat: station.lat, lng: station.lng },
                map: this.map,
                title: station.name,
                icon: this.getMarkerIcon(overallStatus),
                animation: google.maps.Animation.DROP,
            });

            // Marker'a tıklanınca bilgi penceresi aç (EV-10)
            marker.addListener('click', () => {
                this.showStationInfo(station, marker);
            });

            marker.stationData = station;
            this.markers.push(marker);
        });
    },

    // ── İstasyon genel durumu ──
    getStationOverallStatus(station) {
        const chargers = station.chargers || [];
        if (chargers.length === 0) return 'offline';
        const hasAvailable = chargers.some(c => c.status === 'available');
        const allOffline = chargers.every(c => c.status === 'offline');
        if (allOffline) return 'offline';
        if (hasAvailable) return 'available';
        return 'occupied';
    },

    // ── Renk kodlu marker ikonları (GM-03) ──
    getMarkerIcon(status) {
        const colors = {
            available: '#00e5a0',   // Yeşil
            occupied: '#ffd700',    // Sarı
            offline: '#ff4466',     // Kırmızı
        };
        const color = colors[status] || '#7a8aab';

        return {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#0a0e1a',
            strokeWeight: 3,
            scale: 12,
        };
    },

    // ── Kullanıcı konumunu göster (GM-02) ──
    showUserLocation() {
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.userPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };

                this.userMarker = new google.maps.Marker({
                    position: this.userPosition,
                    map: this.map,
                    title: 'Your Location',
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        fillColor: '#4285F4',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 3,
                        scale: 10,
                    },
                    zIndex: 999,
                });

                // Harita konumuna odakla
                this.map.setCenter(this.userPosition);
            },
            () => {
                console.log('Location access denied, using Izmir center.');
            }
        );
    },

    // ── Marker tıklama — bilgi penceresi (EV-10, EV-08) ──
    showStationInfo(station, marker) {
        const chargers = station.chargers || [];
        const available = chargers.filter(c => c.status === 'available').length;
        const total = chargers.length;

        // Mesafe hesapla
        let distanceText = '';
        if (this.userPosition) {
            const dist = this.calculateDistance(
                this.userPosition.lat, this.userPosition.lng,
                station.lat, station.lng
            );
            distanceText = `<div style="color:#00a8e8;font-size:13px;margin-top:4px;">📍 ${dist.toFixed(1)} km away</div>`;
        }

        const statusBadge = this.getStatusBadgeHTML(this.getStationOverallStatus(station));

        const content = `
            <div style="font-family:Outfit,sans-serif;min-width:220px;padding:4px;">
                <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${station.name}</div>
                <div style="font-size:13px;color:#666;margin-bottom:6px;">${station.address}</div>
                ${distanceText}
                <div style="margin:8px 0;">${statusBadge}</div>
                <div style="font-size:13px;color:#555;margin-bottom:8px;">
                    ⚡ ${available}/${total} chargers available<br>
                    🕐 ${station.operating_hours || station.operatingHours}
                </div>
                <div style="display:flex;gap:8px; flex-wrap:wrap;">
                    <a href="station-detail.html?id=${station.id}" 
                       style="background:#00e5a0;color:#0a0e1a;padding:7px 14px;border-radius:8px;
                              font-size:13px;font-weight:600;text-decoration:none;display:inline-block;">
                        See Details
                    </a>
                    ${this.getStationOverallStatus(station) === 'offline' ? `
                    <button onclick="App.showToast('This station is currently offline. Please select another station.', 'error')" 
                       style="background:#666;color:#ccc;padding:7px 14px;border-radius:8px;
                              font-size:13px;font-weight:600;border:none;cursor:not-allowed;display:inline-block;">
                        📅 Reservation Closed
                    </button>
                    ` : `
                    <a href="reservation.html?station=${station.id}" 
                       style="background:#00a8e8;color:#fff;padding:7px 14px;border-radius:8px;
                              font-size:13px;font-weight:600;text-decoration:none;display:inline-block;">
                        📅 Reservation
                    </a>
                    `}
                    <a href="https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}" 
                       target="_blank"
                       style="background:#4285F4;color:#fff;padding:7px 14px;border-radius:8px;
                              font-size:13px;font-weight:600;text-decoration:none;display:inline-block;">
                        🧭 Get Directions
                    </a>
                </div>
            </div>
        `;

        this.infoWindow.setContent(content);
        this.infoWindow.open(this.map, marker);
    },

    getStatusBadgeHTML(status) {
        const map = {
            available: { text: '● Available', color: '#00e5a0', bg: 'rgba(0,229,160,.1)' },
            occupied: { text: '● Occupied', color: '#ffd700', bg: 'rgba(255,215,0,.1)' },
            offline: { text: '● Offline', color: '#ff4466', bg: 'rgba(255,68,102,.1)' },
        };
        const s = map[status] || map.offline;
        return `<span style="background:${s.bg};color:${s.color};padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">${s.text}</span>`;
    },

    // ── Calculate distance (Haversine) ──
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    // ── Filtering (GM-05) ──
    filterStations(filters) {
        const { connectorType, minPower, maxPrice, statusFilter } = filters;

        this.markers.forEach(marker => {
            const station = marker.stationData;
            const chargers = station.chargers || [];

            // First, narrow down chargers by connector/power/price filters
            let matchingChargers = [...chargers];

            if (connectorType) {
                matchingChargers = matchingChargers.filter(c => c.connector_type === connectorType || c.connectorType === connectorType);
            }
            if (minPower) {
                matchingChargers = matchingChargers.filter(c => c.power >= Number(minPower));
            }
            if (maxPrice) {
                matchingChargers = matchingChargers.filter(c => (c.price_per_kwh || c.pricePerKwh) <= Number(maxPrice));
            }

            let visible = matchingChargers.length > 0;

            // Status filter: check within the already-filtered chargers
            if (visible && statusFilter && statusFilter !== 'all') {
                visible = matchingChargers.some(c => c.status === statusFilter);
            }

            marker.setVisible(visible);

            // Update marker icon color based on filtered chargers' status
            if (visible) {
                const filteredStatus = this.getFilteredStatus(matchingChargers);
                marker.setIcon(this.getMarkerIcon(filteredStatus));
            }
        });
    },

    // ── Determine status from a subset of chargers ──
    getFilteredStatus(chargers) {
        if (chargers.length === 0) return 'offline';
        const allOffline = chargers.every(c => c.status === 'offline');
        if (allOffline) return 'offline';
        const hasAvailable = chargers.some(c => c.status === 'available');
        if (hasAvailable) return 'available';
        return 'occupied';
    },

    // ── Navigasyon yönlendirmesi (GM-06) ──
    navigateToStation(stationLat, stationLng) {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${stationLat},${stationLng}`;
        window.open(url, '_blank');
    },

    // ── Marker'ları temizle ──
    clearMarkers() {
        this.markers.forEach(m => m.setMap(null));
        this.markers = [];
    },

    // ── Dark mode harita stili ──
    getMapStyles() {
        return [
            { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
            { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
            { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1b3a5c' }] },
            { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6fbb' }] },
            { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a2744' }] },
            { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ];
    },
};
