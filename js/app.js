/**
 * EVCharge — Ortak Yardımcı Fonksiyonlar
 * Navigasyon, toast bildirimleri ve sayfa yardımcıları.
 * API tabanlı — backend ile iletişim kurar.
 */

const App = {
    // Önbelleklenmiş kullanıcı bilgisi
    _cachedUser: null,

    // ── Navbar'ı oluştur ──
    renderNavbar(activePage) {
        const nav = document.getElementById('navbar');
        if (!nav) return;

        nav.innerHTML = `
            <a href="dashboard.html" class="nav-logo">
                <div class="nav-logo-icon">⚡</div>
                <div class="nav-logo-text">EV<span>Charge</span></div>
            </a>
            <nav class="nav-links">
                <a href="dashboard.html" ${activePage === 'dashboard' ? 'class="active"' : ''}>🏠 <span>Panel</span></a>
                <a href="wallet.html" ${activePage === 'wallet' ? 'class="active"' : ''}>💳 <span>Cüzdan</span></a>
                <a href="map.html" ${activePage === 'map' ? 'class="active"' : ''}>🗺️ <span>Harita</span></a>
                <a href="map.html?action=reserve" ${activePage === 'reservation' ? 'class="active"' : ''}>📅 <span>Rezervasyon</span></a>
                <a href="charging.html" ${activePage === 'charging' ? 'class="active"' : ''}>⚡ <span>Şarj</span></a>
                <a href="profile.html" ${activePage === 'profile' ? 'class="active"' : ''}>👤 <span>Profil</span></a>
                <button class="btn-logout" onclick="App.logout()">🚪 Çıkış</button>
            </nav>
        `;
    },

    // ── Oturum kontrolü (async — sunucu doğrulaması) ──
    async requireAuth() {
        if (!Auth.isLoggedIn()) {
            window.location.href = 'login.html';
            return null;
        }

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

    // ── ID üretici ──
    generateId(prefix = '') {
        return prefix + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    },

    // ── Tarih formatlama ──
    formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    },

    formatTime(timeStr) {
        return timeStr;
    },

    formatCurrency(amount) {
        return Number(amount).toFixed(2) + ' ₺';
    },
};
