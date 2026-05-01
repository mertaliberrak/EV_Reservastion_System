/**
 * EVCharge — Admin Sayfası İşlevleri
 */

const Admin = {
    _currentUser: null,
    _confirmActionCb: null,
    _allUsers: [],

    async init() {
        this._currentUser = await App.requireAuth();
        if (!this._currentUser) return;

        if (this._currentUser.is_admin !== 1) {
            App.showToast('Bu sayfayı görüntüleme yetkiniz yok.', 'error');
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
            return;
        }

        App.renderNavbar('admin');
        
        // İlk olarak Logları yükle
        this.loadLogs();

        // Modal onay butonu
        document.getElementById('confirmModalBtn').addEventListener('click', async () => {
            if (this._confirmActionCb) {
                const cb = this._confirmActionCb;
                this.closeConfirmModal();
                await cb();
            }
        });
        
        // Modal dışına tıklayınca kapat
        document.getElementById('confirmModal').addEventListener('click', (e) => {
            if (e.target.id === 'confirmModal') this.closeConfirmModal();
        });

        // Kullanıcı arama input'u dinleyicisi
        const searchInput = document.getElementById('userSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterUsers(e.target.value));
        }
    },

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        document.querySelector(`.tab-btn[onclick="Admin.switchTab('${tabName}')"]`).classList.add('active');
        document.getElementById(`tab-${tabName}`).classList.add('active');

        if (tabName === 'logs') {
            this.loadLogs();
        } else if (tabName === 'users') {
            this.loadUsers();
        } else if (tabName === 'stations') {
            this.loadStations();
        }
    },

    async loadLogs() {
        const tbody = document.getElementById('logsTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Yükleniyor...</td></tr>';

        try {
            const logs = await API.getAdminLogs();
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Kayıt bulunamadı.</td></tr>';
                return;
            }

            tbody.innerHTML = logs.map(log => {
                const date = new Date(log.created_at).toLocaleString('tr-TR');
                const user = log.user_name ? `${log.user_name} (${log.user_email})` : 'Sistem / Misafir';
                let detailsStr = '';
                try {
                    const parsed = JSON.parse(log.details);
                    detailsStr = `<pre style="margin:0; font-size:12px; background:var(--bg); padding:4px; border-radius:4px; max-width: 300px; overflow-x: auto;">${JSON.stringify(parsed, null, 2)}</pre>`;
                } catch {
                    detailsStr = log.details;
                }

                return `
                    <tr>
                        <td style="white-space: nowrap;">${date}</td>
                        <td>${user}</td>
                        <td><span style="font-weight: 600; color: var(--green);">${log.action}</span></td>
                        <td>${detailsStr}</td>
                        <td>${log.ip_address || '-'}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Hata: ' + err.message + '</td></tr>';
        }
    },

    async loadUsers() {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Yükleniyor...</td></tr>';

        try {
            this._allUsers = await API.getAdminUsers();
            this.renderUsers(this._allUsers);
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Hata: ' + err.message + '</td></tr>';
        }
    },

    renderUsers(users) {
        const tbody = document.getElementById('usersTableBody');
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Kayıt bulunamadı.</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => {
            const roleBadge = user.is_admin === 1 
                ? '<span class="badge admin">Admin</span>' 
                : '<span class="badge user">Kullanıcı</span>';
            
            const actionBtn = user.is_admin === 1
                ? `<button class="btn btn-secondary btn-sm" onclick="Admin.promptRoleChange(${user.id}, 0, '${user.name}')">Yetkiyi Al</button>`
                : `<button class="btn btn-primary btn-sm" onclick="Admin.promptRoleChange(${user.id}, 1, '${user.name}')">Admin Yap</button>`;

            // Kendisini adminlikten düşürmesini engelle
            const isSelf = user.id === this._currentUser.id;

            return `
                <tr>
                    <td>#${user.id}</td>
                    <td>${user.name}</td>
                    <td>${user.email}</td>
                    <td>${roleBadge}</td>
                    <td>${App.formatCurrency(user.balance)}</td>
                    <td>
                        ${isSelf ? '<span style="color:var(--muted); font-size:12px;">(Siz)</span>' : actionBtn}
                    </td>
                </tr>
            `;
        }).join('');
    },

    filterUsers(query) {
        if (!query) {
            this.renderUsers(this._allUsers);
            return;
        }
        query = query.toLowerCase().trim();
        const filtered = this._allUsers.filter(u => 
            u.email.toLowerCase().includes(query) || 
            u.name.toLowerCase().includes(query)
        );
        this.renderUsers(filtered);
    },

    promptRoleChange(userId, newRole, userName) {
        const actionText = newRole === 1 ? 'Admin yapmak' : 'Admin yetkisini almak';
        const message = `<b>${userName}</b> adlı kullanıcının rolünü <b>${actionText}</b> istediğinize emin misiniz?`;
        
        document.getElementById('confirmModalText').innerHTML = message;
        this._confirmActionCb = async () => {
            try {
                await API.updateUserRole(userId, newRole);
                App.showToast('Rol başarıyla güncellendi.');
                this.loadUsers();
            } catch (err) {
                App.showToast('Hata: ' + err.message, 'error');
            }
        };
        document.getElementById('confirmModal').classList.add('show');
    },

    async loadStations() {
        const tbody = document.getElementById('stationsTableBody');
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Yükleniyor...</td></tr>';

        try {
            const stations = await API.getStations();
            if (stations.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">İstasyon bulunamadı.</td></tr>';
                return;
            }

            let html = '';
            for (const station of stations) {
                const chargers = station.chargers || [];
                if (chargers.length === 0) continue;

                html += chargers.map(c => {
                    const isOffline = c.status === 'offline';
                    const statusText = isOffline ? 'Çevrimdışı' : (c.status === 'available' ? 'Müsait' : 'Dolu');
                    const badgeClass = isOffline ? 'admin' : (c.status === 'available' ? 'user' : ''); // Using existing badge classes for colors
                    
                    const toggleStatus = isOffline ? 'available' : 'offline';
                    const actionBtnText = isOffline ? 'Aktifleştir' : 'Çevrimdışı Yap';
                    const actionBtnClass = isOffline ? 'btn-primary' : 'btn-danger';

                    return `
                        <tr>
                            <td><strong>${station.name}</strong><br><span style="font-size:12px;color:var(--muted);">${station.address}</span></td>
                            <td>${c.type} / ${c.power}kW<br><span style="font-size:12px;color:var(--muted);">${c.connector_type}</span></td>
                            <td><span class="badge ${badgeClass}" style="${!isOffline && c.status === 'occupied' ? 'background:#ffd700;color:#000;' : ''}">${statusText}</span></td>
                            <td>
                                <button class="btn ${actionBtnClass} btn-sm" onclick="Admin.promptChargerStatusChange(${c.id}, '${toggleStatus}', '${station.name} - Ünite #${String(c.id).slice(-2)}')">${actionBtnText}</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
            tbody.innerHTML = html;
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Hata: ' + err.message + '</td></tr>';
        }
    },

    promptChargerStatusChange(chargerId, newStatus, chargerName) {
        let message = '';
        if (newStatus === 'offline') {
            message = `<b>${chargerName}</b> ünitesini <b>Çevrimdışı</b> yapmak istediğinize emin misiniz?<br><br><span style="color:var(--danger);font-size:14px;">Dikkat: Bu işlem, bu üniteye ait gelecekteki tüm <b>aktif rezervasyonları anında iptal edecek</b> ve kullanıcılara paraları iade edilecektir.</span>`;
        } else {
            message = `<b>${chargerName}</b> ünitesini tekrar <b>Aktif (Müsait)</b> yapmak istediğinize emin misiniz?`;
        }
        
        document.getElementById('confirmModalText').innerHTML = message;
        this._confirmActionCb = async () => {
            try {
                const res = await API.updateChargerStatus(chargerId, newStatus);
                App.showToast(res.message || 'Ünite durumu güncellendi.');
                this.loadStations();
            } catch (err) {
                App.showToast('Hata: ' + err.message, 'error');
            }
        };
        document.getElementById('confirmModal').classList.add('show');
    },

    closeConfirmModal() {
        this._confirmActionCb = null;
        document.getElementById('confirmModal').classList.remove('show');
    }
};

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
    Admin.init();
});
