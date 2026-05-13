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
            console.warn('Session timeout.');
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
        const isOperator = this._cachedUser && this._cachedUser.is_operator === 1;
        const showAdminPanel = isAdmin || isOperator;
        const adminLabel = isAdmin ? 'Admin' : 'Operator';

        nav.innerHTML = `
            <a href="dashboard.html" class="nav-logo">
                <div class="nav-logo-icon">⚡</div>
                <div class="nav-logo-text">EV<span>Charge</span></div>
            </a>
            <nav class="nav-links">
                <a href="dashboard.html" ${activePage === 'dashboard' ? 'class="active"' : ''}>🏠 <span>Dashboard</span></a>
                <a href="wallet.html" ${activePage === 'wallet' ? 'class="active"' : ''}>💳 <span>Wallet</span></a>
                <a href="map.html" ${activePage === 'map' ? 'class="active"' : ''}>🗺️ <span>Map</span></a>
                <a href="recommend.html" ${activePage === 'recommend' ? 'class="active"' : ''}>🎯 <span>Recommendation</span></a>
                <a href="reservation.html" ${activePage === 'reservation' ? 'class="active"' : ''}>📅 <span>Reservation</span></a>
                <a href="charging.html" ${activePage === 'charging' ? 'class="active"' : ''}>⚡ <span>Charging</span></a>
                <a href="profile.html" ${activePage === 'profile' ? 'class="active"' : ''}>👤 <span>Profile</span></a>
                ${showAdminPanel ? `<a href="admin.html" ${activePage === 'admin' ? 'class="active"' : ''}>🛡️ <span>${adminLabel}</span></a>` : ''}
                <button class="btn-logout" onclick="App.logout()">🚪 Logout</button>
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

    // ── Zaman Biçimlendirme (Time Ago) ──
    formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        const now = new Date();
        const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
        const diffSec = Math.floor((now - date) / 1000);

        if (diffSec < 60) return 'Az önce';
        if (diffSec < 3600) return `${Math.floor(diffSec / 60)} dk önce`;
        if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} saat önce`;
        if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} gün önce`;
        return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
    },
};

// ── Global Aktivite Takibi ──
window.addEventListener('mousemove', () => App.updateActivity());
window.addEventListener('keydown', () => App.updateActivity());
window.addEventListener('click', () => App.updateActivity());
window.addEventListener('scroll', () => App.updateActivity());
