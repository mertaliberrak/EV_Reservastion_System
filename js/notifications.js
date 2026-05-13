/**
 * EVCharge — Bildirim Sayfası Mantığı
 */

const Notifications = {
    _allNotifs: [],
    _selectedId: null,

    async init() {
        const user = await App.requireAuth();
        if (!user) return;

        App.renderNavbar('notifications');

        const urlParams = new URLSearchParams(window.location.search);
        const urlId = urlParams.get('id');
        if (urlId) {
            this._selectedId = parseInt(urlId, 10);
        }

        await this.loadNotifications();

        if (this._selectedId) {
            this.selectNotification(this._selectedId);
        }
    },

    async loadNotifications() {
        const listContainer = document.getElementById('notifList');
        listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--muted);">Loading...</div>';

        try {
            this._allNotifs = await API.getNotifications();
            this.renderList();
        } catch (err) {
            listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--danger);">Notifications could not be loaded.</div>';
            console.error('Notification loading error:', err);
        }
    },

    renderList() {
        const listContainer = document.getElementById('notifList');

        if (this._allNotifs.length === 0) {
            listContainer.innerHTML = `
                <div style="padding:32px 20px; text-align:center; color:var(--muted);">
                    <div style="font-size:32px; margin-bottom:12px;">📭</div>
                    You don't have any notifications yet.
                </div>
            `;
            return;
        }

        const html = this._allNotifs.map(notif => {
            const isUnread = notif.is_read === 0;
            const styleInfo = this.getNotifIcon(notif.type);
            const activeClass = this._selectedId === notif.id ? 'active' : '';
            const unreadClass = isUnread ? 'unread' : '';

            return `
                <div class="notif-item ${activeClass} ${unreadClass}" onclick="Notifications.selectNotification(${notif.id})">
                    <div class="notif-icon ${styleInfo.cls}">${styleInfo.icon}</div>
                    <div class="notif-info">
                        <div class="notif-title">${notif.title}</div>
                        <div class="notif-date">${App.formatTimeAgo(notif.created_at)}</div>
                    </div>
                </div>
            `;
        }).join('');

        listContainer.innerHTML = html;

        // If a selected id exists, render its details
        if (this._selectedId) {
            this.renderDetail();
        } else {
            this.showEmptyState();
        }
    },

    async selectNotification(id) {
        this._selectedId = id;

        // Update the active one in the list (for quick visual feedback)
        this.renderList();

        // Show the detail
        this.renderDetail();

        // Eğer okunmamışsa API'ye okundu bilgisini gönder
        const notif = this._allNotifs.find(n => n.id === id);
        if (notif && notif.is_read === 0) {
            try {
                await API.markNotificationRead(id);
                notif.is_read = 1;
                this.renderList(); // Rozeti (yeşil nokta) kaldırmak için listeyi tekrar renderla

                // Update the global notification count in the Navbar
                if (window.App && typeof App.updateNotificationCount === 'function') {
                    App.updateNotificationCount();
                }
            } catch (err) {
                console.error('Mark read error:', err);
            }
        }
    },

    renderDetail() {
        const notif = this._allNotifs.find(n => n.id === this._selectedId);
        if (!notif) {
            this.showEmptyState();
            return;
        }

        document.getElementById('detailEmptyState').classList.remove('show');
        document.getElementById('detailEmptyState').style.display = 'none';

        const detailContent = document.getElementById('detailContent');
        detailContent.style.display = 'block';

        const styleInfo = this.getNotifIcon(notif.type);

        const iconEl = document.getElementById('detailIcon');
        iconEl.innerHTML = styleInfo.icon;
        iconEl.className = 'detail-icon ' + styleInfo.cls;

        document.getElementById('detailTitle').textContent = notif.title;

        const dateStr = new Date(notif.created_at).toLocaleString('tr-TR', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        document.getElementById('detailDate').textContent = dateStr;

        document.getElementById('detailMessage').innerHTML = `<p>${notif.message}</p>`;
    },

    showEmptyState() {
        document.getElementById('detailContent').style.display = 'none';
        const emptyState = document.getElementById('detailEmptyState');
        emptyState.style.display = 'flex';
        emptyState.classList.add('show');
    },

    async markAllRead() {
        const hasUnread = this._allNotifs.some(n => n.is_read === 0);
        if (!hasUnread) return;

        try {
            await API.markAllNotificationsRead();

            // Tüm notifleri lokalde okundu işaretle
            this._allNotifs.forEach(n => n.is_read = 1);
            this.renderList();

            // Global güncelleme
            if (window.App && typeof App.updateNotificationCount === 'function') {
                App.updateNotificationCount();
            }

            App.showToast('All notifications marked as read.');
        } catch (err) {
            App.showToast('Operation failed.', 'error');
        }
    },

    getNotifIcon(type) {
        const map = {
            'reservation_created': { icon: '📅', cls: 'created' },
            'reservation_cancelled': { icon: '❌', cls: 'cancelled' },
            'station_offline': { icon: '⚠️', cls: 'offline' },
            'admin_cancelled': { icon: '🛡️', cls: 'admin' },
            'wallet_topup': { icon: '💰', cls: 'topup' },
        };
        return map[type] || { icon: '🔔', cls: 'created' };
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Notifications.init();
});
