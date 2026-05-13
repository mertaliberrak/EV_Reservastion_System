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
                throw new Error(data.error || 'An error occurred.');
            }

            return data;
        } catch (err) {
            if (err.message === 'Failed to fetch') {
                throw new Error('Failed to connect to the server. Is the backend running?');
            }
            throw err;
        }
    },

    // ── Kısayol metodları ──
    get(path) { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    delete(path) { return this.request('DELETE', path); },
    patch(path, body) { return this.request('PATCH', path, body); },

    // ══════════════════════════════════════
    //  AUTH
    // ══════════════════════════════════════
    async login(email, password, loginType) {
        const data = await this.post('/auth/login', { email, password, loginType: loginType || 'user' });
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

    async forgotPassword(email) {
        return this.post('/auth/forgot-password', { email });
    },

    async resetPassword(email, code, newPassword) {
        return this.post('/auth/reset-password', { email, code, newPassword });
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
        return this.delete(`/profile/cards/${id}`);
    },

    async getFavorites() {
        return this.get('/profile/favorites');
    },

    async toggleFavorite(stationId) {
        return this.post('/profile/favorites', { stationId });
    },

    async getHistory() {
        const data = await this.get('/profile/history');
        return data.history || [];
    },

    // ── ARAÇLAR ──══════════════════════════════════════
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

    async getAlternatives(reservationId) {
        return this.get('/reservations/' + reservationId + '/alternatives');
    },

    async switchReservation(reservationId, newChargerId, newStationId) {
        return this.post('/reservations/' + reservationId + '/switch', { newChargerId, newStationId });
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

    // ══════════════════════════════════════
    //  ADMIN
    // ══════════════════════════════════════
    async getAdminLogs() {
        const data = await this.get('/admin/logs');
        return data.logs || [];
    },

    async getAdminUsers() {
        const data = await this.get('/admin/users');
        return data.users || [];
    },

    async updateUserRole(id, is_admin) {
        return this.request('PUT', `/admin/users/${id}/role`, { is_admin });
    },

    async deleteAdminUser(id) {
        return this.delete(`/admin/users/${id}`);
    },

    async updateChargerStatus(id, status) {
        return this.request('PUT', `/admin/chargers/${id}/status`, { status });
    },

    // ══════════════════════════════════════
    //  REPORTS (İstasyon Sorun Bildirimleri)
    // ══════════════════════════════════════
    async submitReport(stationId, category, description) {
        return this.post('/reports', { stationId, category, description });
    },

    async getMyReports() {
        const data = await this.get('/reports');
        return data.reports || [];
    },

    async getAdminReports() {
        const data = await this.get('/reports/admin');
        return data.reports || [];
    },

    async updateReportStatus(id, status, adminNote) {
        return this.patch(`/reports/${id}`, { status, adminNote });
    },

    // ══════════════════════════════════════
    //  DESTEK TALEPLERİ (SUPPORT TICKETS)
    // ══════════════════════════════════════
    async createSupportTicket(subject, category, description, related_id) {
        return this.post('/support', { subject, category, description, related_id });
    },

    async getMySupportTickets() {
        const data = await this.get('/support');
        return data.tickets || [];
    },

    async getAdminSupportTickets() {
        const data = await this.get('/support/admin');
        return data.tickets || [];
    },

    async updateSupportTicketStatus(id, status, admin_note) {
        return this.patch(`/support/${id}`, { status, admin_note });
    },

    // ══════════════════════════════════════
    //  KULLANICI ROLLERİ (USER ROLES)
    // ══════════════════════════════════════
    async updateUserOperatorRole(id, is_operator) {
        return this.request('PUT', `/admin/users/${id}/role`, { is_operator });
    },

    // ══════════════════════════════════════
    //  BİLDİRİMLER (NOTIFICATIONS)
    // ══════════════════════════════════════
    async getNotifications() {
        const data = await this.get('/notifications');
        return data.notifications || [];
    },

    async getUnreadNotificationCount() {
        const data = await this.get('/notifications/unread-count');
        return data.count || 0;
    },

    async markNotificationRead(id) {
        return this.patch(`/notifications/${id}/read`, {});
    },

    async markAllNotificationsRead() {
        return this.patch('/notifications/read-all', {});
    }
};
