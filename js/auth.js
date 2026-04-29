/**
 * EVCharge — Kimlik Doğrulama (EV-04, EV-05, EV-06)
 * API tabanlı kayıt, giriş ve çıkış işlemleri.
 */

const Auth = {
    // ── Kayıt ol (EV-04) ──
    async register(name, email, password) {
        try {
            const data = await API.register(name, email, password);
            return { success: true, user: data.user, token: data.token };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    // ── Giriş yap (EV-05) ──
    async login(email, password) {
        try {
            const data = await API.login(email, password);
            return { success: true, user: data.user, token: data.token };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    // ── Çıkış yap (EV-06) ──
    logout() {
        API.clearToken();
    },

    // ── Oturum kontrolü ──
    isLoggedIn() {
        return API.getToken() !== null;
    },

    // ── Mevcut kullanıcıyı sunucudan doğrula ──
    async getCurrentUser() {
        try {
            const data = await API.getMe();
            return data.user;
        } catch (err) {
            return null;
        }
    },
};
