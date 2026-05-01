/**
 * EVCharge — Ortak Yardımcı Fonksiyonlar
 * Navigasyon, toast bildirimleri ve sayfa yardımcıları.
 * API tabanlı — backend ile iletişim kurar.
 */

const App = {
    // Önbelleklenmiş kullanıcı bilgisi
    _cachedUser: null,
    // 3 saatlik (ms) zaman aşımı
    _INACTIVITY_LIMIT: 3 * 60 * 60 * 1000,

    // ── Aktivite zamanını güncelle (Throttled: 5 saniyede bir) ──
    _lastUpdate: 0,
    updateActivity() {
        const now = Date.now();
        if (now - this._lastUpdate > 5000) {
            localStorage.setItem('lastActivity', now);
            this._lastUpdate = now;
        }
    },

    // ── Zaman aşımını kontrol et ──
    checkInactivity() {
        const last = localStorage.getItem('lastActivity');
        if (last && (Date.now() - parseInt(last) > this._INACTIVITY_LIMIT)) {
            console.warn('Oturum zaman aşımına uğradı.');
            this.logout();
            return true;
        }
        return false;
    },

    // ── Navbar'ı oluştur ──
    renderNavbar(activePage) {
        const nav = document.getElementById('navbar');
        if (!nav) return;

        const isAdmin = this._cachedUser && this._cachedUser.is_admin === 1;

        nav.innerHTML = `
            <a href="dashboard.html" class="nav-logo">
                <div class="nav-logo-icon">⚡</div>
                <div class="nav-logo-text">EV<span>Charge</span></div>
            </a>
            <nav class="nav-links">
                <a href="dashboard.html" ${activePage === 'dashboard' ? 'class="active"' : ''}>🏠 <span>Panel</span></a>
                <a href="wallet.html" ${activePage === 'wallet' ? 'class="active"' : ''}>💳 <span>Cüzdan</span></a>
                <a href="map.html" ${activePage === 'map' ? 'class="active"' : ''}>🗺️ <span>Harita</span></a>
                <a href="reservation.html" ${activePage === 'reservation' ? 'class="active"' : ''}>📅 <span>Rezervasyon</span></a>
                <a href="charging.html" ${activePage === 'charging' ? 'class="active"' : ''}>⚡ <span>Şarj</span></a>
                <a href="profile.html" ${activePage === 'profile' ? 'class="active"' : ''}>👤 <span>Profil</span></a>
                ${isAdmin ? `<a href="admin.html" ${activePage === 'admin' ? 'class="active"' : ''}>🛡️ <span>Admin</span></a>` : ''}
                <button class="btn-logout" onclick="App.logout()">🚪 Çıkış</button>
            </nav>
        `;
    },

    // ── Oturum kontrolü (async — sunucu doğrulaması) ──
    async requireAuth() {
        // Zaman aşımı kontrolü
        if (this.checkInactivity()) return null;

        if (!Auth.isLoggedIn()) {
            window.location.href = 'login.html';
            return null;
        }

        // Aktiviteyi güncelle
        this.updateActivity();

        try {
            const user = await Auth.getCurrentUser();
            if (!user) {
                API.clearToken();
                window.location.href = 'login.html';
                return null;
            }
            this._cachedUser = user;
            return user;
        } catch (err) {
            API.clearToken();
            window.location.href = 'login.html';
            return null;
        }
    },

    // ── Çıkış yap (EV-06) ──
    logout() {
        Auth.logout();
        window.location.href = 'login.html';
    },

    // ── Toast bildirimi göster ──
    showToast(message, type = 'success') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // ── Tarih formatlama ──
    formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    },

    formatCurrency(amount) {
        return Number(amount).toFixed(2) + ' ₺';
    },
};

// ── Global Aktivite Takibi ──
window.addEventListener('mousemove', () => App.updateActivity());
window.addEventListener('keydown', () => App.updateActivity());
window.addEventListener('click', () => App.updateActivity());
window.addEventListener('scroll', () => App.updateActivity());
