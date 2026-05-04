/**
 * EVCharge — API İstemcisi
 * Tüm backend iletişimi bu modül üzerinden yapılır.
 * localStorage'daki JWT token ile kimlik doğrulama sağlar.
 */

const API = {
    BASE_URL: '/api',

    // ── Token yönetimi ──
    getToken() {
        return localStorage.getItem('evcharge_token');
    },

    setToken(token) {
        localStorage.setItem('evcharge_token', token);
    },

    clearToken() {
        localStorage.removeItem('evcharge_token');
    },

    // ── Genel HTTP istek metodu ──
    async request(method, path, body = null) {
        const headers = { 'Content-Type': 'application/json' };
        const token = this.getToken();
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }

        const options = { method, headers };
        if (body && method !== 'GET') {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(this.BASE_URL + path, options);
            const data = await response.json();

            if (!response.ok) {
                // Token geçersizse login'e yönlendir (login sayfasındayken yönlendirme yapma)
                if (response.status === 401 && !path.includes('/auth/login')) {
                    this.clearToken();
                    if (!window.location.pathname.includes('login.html')) {
                        window.location.href = 'login.html';
                    }
                    return;
                }
                throw new Error(data.error || 'Bir hata oluştu.');
            }

            return data;
        } catch (err) {
            if (err.message === 'Failed to fetch') {
                throw new Error('Sunucuya bağlanılamadı. Backend çalışıyor mu?');
            }
            throw err;
        }
    },

    // ── Kısayol metodları ──
    get(path)        { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    delete(path)     { return this.request('DELETE', path); },
    patch(path, body){ return this.request('PATCH', path, body); },

    // ══════════════════════════════════════
    //  AUTH
    // ══════════════════════════════════════
    async login(email, password) {
        const data = await this.post('/auth/login', { email, password });
        if (data && data.token) {
            this.setToken(data.token);
        }
        return data;
    },

    async register(name, email, password) {
        const data = await this.post('/auth/register', { name, email, password });
        if (data && data.token) {
            this.setToken(data.token);
        }
        return data;
    },

    async getMe() {
        return this.get('/auth/me');
    },

    async addBalance(amount, cardId) {
        return this.post('/profile/add-funds', { amount, cardId });
    },

    // ══════════════════════════════════════
    //  PROFILE
    // ══════════════════════════════════════
    async getProfile() {
        return this.get('/profile');
    },

    async updateProfile(name, oldPassword, password) {
        return this.request('PUT', '/profile', { name, oldPassword, password });
    },

    async getCards() {
        return this.get('/profile/cards');
    },

    async addCard(cardName, cardNumber, expiryDate) {
        return this.post('/profile/cards', { cardName, cardNumber, expiryDate });
    },

    async deleteCard(id) {
        return this.delete('/profile/cards/' + id);
    },

    // ══════════════════════════════════════
    //  VEHICLES
    // ══════════════════════════════════════
    async getVehicles() {
        const data = await this.get('/vehicles');
        return data.vehicles || [];
    },

    async addVehicle(vehicle) {
        return this.post('/vehicles', vehicle);
    },

    async deleteVehicle(id, force = false) {
        const query = force ? '?force=true' : '';
        return this.delete('/vehicles/' + id + query);
    },

    // ══════════════════════════════════════
    //  STATIONS
    // ══════════════════════════════════════
    async getStations() {
        const data = await this.get('/stations');
        return data.stations || [];
    },

    async getStation(id) {
        const data = await this.get('/stations/' + id);
        return data.station || null;
    },

    async getRecommendations({ lat, lng, vehicle_id, max_distance_km } = {}) {
        let query = `/stations/recommend?lat=${lat}&lng=${lng}`;
        if (vehicle_id) query += `&vehicle_id=${vehicle_id}`;
        if (max_distance_km) query += `&max_distance_km=${max_distance_km}`;
        return this.get(query);
    },

    // ══════════════════════════════════════
    //  RESERVATIONS
    // ══════════════════════════════════════
    async getReservations() {
        const data = await this.get('/reservations');
        return data.reservations || [];
    },

    async createReservation(data) {
        return this.post('/reservations', data);
    },

    async cancelReservation(id) {
        return this.delete('/reservations/' + id);
    },

    async getChargerAvailability(chargerId, date) {
        const data = await this.get(`/reservations/charger/${chargerId}/availability?date=${date}`);
        return data.bookedSlots || [];
    },

    // ══════════════════════════════════════
    //  SESSIONS
    // ══════════════════════════════════════
    async getSessions() {
        const data = await this.get('/sessions');
        return data.sessions || [];
    },

    async startSession(reservationId, batteryStart) {
        return this.post('/sessions', { reservationId, batteryStart });
    },

    async stopSession(id, batteryEnd) {
        return this.patch('/sessions/' + id, { batteryEnd });
    },

    // ══════════════════════════════════════
    //  CONFIG
    // ══════════════════════════════════════
    async getMapsKey() {
        const data = await this.request('GET', '/config/maps-key');
        return data.key || '';
    },
};
