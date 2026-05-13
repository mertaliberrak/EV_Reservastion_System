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

        if (this._currentUser.is_admin !== 1 && this._currentUser.is_operator !== 1) {
            App.showToast('You do not have permission to view this page.', 'error');
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
            return;
        }

        App.renderNavbar('admin');

        // Operatörler için sekmeleri gizle
        if (this._currentUser.is_admin !== 1 && this._currentUser.is_operator === 1) {
            document.getElementById('btn-tab-logs').style.display = 'none';
            document.getElementById('btn-tab-users').style.display = 'none';
            document.getElementById('btn-tab-support').style.display = 'none';
            document.getElementById('adminDesc').textContent = 'Manage stations and review issue reports.';
            this.switchTab('stations');
        } else {
            // Adminler için varsayılan Loglar
            this.loadLogs();
        }

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
        } else if (tabName === 'reports') {
            this.loadReports();
        } else if (tabName === 'support') {
            this.loadSupportTickets();
        }
    },

    async loadLogs() {
        const tbody = document.getElementById('logsTableBody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading...</td></tr>';

        try {
            const logs = await API.getAdminLogs();
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No records found.</td></tr>';
                return;
            }

            tbody.innerHTML = logs.map(log => {
                const date = new Date(log.created_at).toLocaleString('tr-TR');
                const user = log.user_name ? `${log.user_name} (${log.user_email})` : 'System / Guest';
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
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error: ' + err.message + '</td></tr>';
        }
    },

    async loadUsers() {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading...</td></tr>';

        try {
            this._allUsers = await API.getAdminUsers();
            this.renderUsers(this._allUsers);
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error: ' + err.message + '</td></tr>';
        }
    },

    renderUsers(users) {
        const tbody = document.getElementById('usersTableBody');
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No users found.</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => {
            let roleBadge = '<span class="badge user">User</span>';
            if (user.is_admin === 1) {
                roleBadge = '<span class="badge admin">Admin</span>';
            } else if (user.is_operator === 1) {
                roleBadge = '<span class="badge" style="background:#f39c12; color:white;">Operator</span>';
            }

            let actionBtns = '';
            if (user.is_admin === 1) {
                actionBtns = `<button class="btn btn-secondary btn-sm" onclick="Admin.promptRoleChange(${user.id}, 0, '${user.name}')">Remove Admin</button>`;
            } else if (user.is_operator === 1) {
                actionBtns = `
                    <button class="btn btn-secondary btn-sm" onclick="Admin.promptOperatorRoleChange(${user.id}, 0, '${user.name}')">Remove Operator</button>
                `;
            } else {
                actionBtns = `
                    <button class="btn btn-secondary btn-sm" style="margin-right:4px;" onclick="Admin.promptOperatorRoleChange(${user.id}, 1, '${user.name}')">Make Operator</button>
                    <button class="btn btn-primary btn-sm" style="margin-right:4px;" onclick="Admin.promptRoleChange(${user.id}, 1, '${user.name}')">Make Admin</button>
                    <button class="btn btn-danger btn-sm" onclick="Admin.promptDeleteUser(${user.id}, '${user.name}')">Delete</button>
                `;
            }

            // Kendisini düşürmesini engelle
            const isSelf = user.id === this._currentUser.id;

            // Eğer adminse, diğer adminleri ve operatörleri silebilsin (veya butonları düzenle)
            if (user.is_admin === 1 && !isSelf) {
                actionBtns += `<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="Admin.promptDeleteUser(${user.id}, '${user.name}')">Delete</button>`;
            } else if (user.is_operator === 1 && !isSelf) {
                actionBtns += `<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="Admin.promptDeleteUser(${user.id}, '${user.name}')">Delete</button>`;
            }

            return `
                <tr>
                    <td>#${user.id}</td>
                    <td>${user.name}</td>
                    <td>${user.email}</td>
                    <td>${roleBadge}</td>
                    <td>${App.formatCurrency(user.balance)}</td>
                    <td>
                        ${isSelf ? '<span style="color:var(--muted); font-size:12px;">(Siz)</span>' : actionBtns}
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
        const actionText = newRole === 1 ? 'Make Admin' : 'Remove Admin';
        const message = `Are you sure you want to <b>${actionText}</b> role of user <b>${userName}</b>?`;

        document.getElementById('confirmModalText').innerHTML = message;
        this._confirmActionCb = async () => {
            try {
                await API.updateUserRole(userId, newRole);
                App.showToast('Role updated successfully.');
                this.loadUsers();
            } catch (err) {
                App.showToast('Error: ' + err.message, 'error');
            }
        };
        document.getElementById('confirmModal').classList.add('show');
    },

    promptOperatorRoleChange(userId, newRole, userName) {
        const actionText = newRole === 1 ? 'Make Operator' : 'Remove Operator';
        const message = `Are you sure you want to <b>${actionText}</b> role of user <b>${userName}</b>?`;

        document.getElementById('confirmModalText').innerHTML = message;
        this._confirmActionCb = async () => {
            try {
                await API.updateUserOperatorRole(userId, newRole);
                App.showToast('Role updated successfully.');
                this.loadUsers();
            } catch (err) {
                App.showToast('Error: ' + err.message, 'error');
            }
        };
        document.getElementById('confirmModal').classList.add('show');
    },

    promptDeleteUser(userId, userName) {
        const message = `Are you sure you want to <b>delete user</b> <b>${userName}</b> completely?<br><br><span style="color:var(--danger);font-size:14px;">This action cannot be undone!</span>`;

        document.getElementById('confirmModalText').innerHTML = message;
        this._confirmActionCb = async () => {
            try {
                await API.deleteAdminUser(userId);
                App.showToast('User deleted successfully.');
                this.loadUsers();
            } catch (err) {
                App.showToast('Error: ' + err.message, 'error');
            }
        };
        document.getElementById('confirmModal').classList.add('show');
    },

    async loadStations() {
        const tbody = document.getElementById('stationsTableBody');
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Loading...</td></tr>';

        try {
            const stations = await API.getStations();
            if (stations.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No stations found.</td></tr>';
                return;
            }

            let html = '';
            for (const station of stations) {
                const chargers = station.chargers || [];
                if (chargers.length === 0) continue;

                html += chargers.map(c => {
                    const isOffline = c.status === 'offline';
                    const statusText = isOffline ? 'Offline' : (c.status === 'available' ? 'Available' : 'Busy');
                    const badgeClass = isOffline ? 'admin' : (c.status === 'available' ? 'user' : ''); // Using existing badge classes for colors

                    const toggleStatus = isOffline ? 'available' : 'offline';
                    const actionBtnText = isOffline ? 'Activate' : 'Deactivate';
                    const actionBtnClass = isOffline ? 'btn-primary' : 'btn-danger';

                    return `
                        <tr>
                            <td><strong>${station.name}</strong><br><span style="font-size:12px;color:var(--muted);">${station.address}</span></td>
                            <td>${c.type} / ${c.power}kW<br><span style="font-size:12px;color:var(--muted);">${c.connector_type}</span></td>
                            <td><span class="badge ${badgeClass}" style="${!isOffline && c.status === 'occupied' ? 'background:#ffd700;color:#000;' : ''}">${statusText}</span></td>
                            <td>
                                <button class="btn ${actionBtnClass} btn-sm" onclick="Admin.promptChargerStatusChange(${c.id}, '${toggleStatus}', '${station.name} - Unit #${String(c.id).slice(-2)}')">${actionBtnText}</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
            tbody.innerHTML = html;
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Error: ' + err.message + '</td></tr>';
        }
    },

    promptChargerStatusChange(chargerId, newStatus, chargerName) {
        let message = '';
        if (newStatus === 'offline') {
            message = `Are you sure you want to <b>deactivate</b> charger <b>${chargerName}</b>?<br><br><span style="color:var(--danger);font-size:14px;">Warning: This action will instantly cancel all future <b>active reservations</b> for this charger and refund the users.</span>`;
        } else {
            message = `Are you sure you want to <b>activate</b> charger <b>${chargerName}</b> again?`;
        }

        document.getElementById('confirmModalText').innerHTML = message;
        this._confirmActionCb = async () => {
            try {
                const res = await API.updateChargerStatus(chargerId, newStatus);
                App.showToast(res.message || 'Charger status updated successfully.');
                this.loadStations();
            } catch (err) {
                App.showToast('Error: ' + err.message, 'error');
            }
        };
        document.getElementById('confirmModal').classList.add('show');
    },

    closeConfirmModal() {
        this._confirmActionCb = null;
        document.getElementById('confirmModal').classList.remove('show');
    },

    // ══ Reports (Bildirimler) ══
    async loadReports() {
        const tbody = document.getElementById('reportsTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Loading...</td></tr>';

        const categoryLabels = {
            broken_charger: '🔧 Broken Charger',
            payment_issue: '💳 Payment Issue',
            dirty_station: '🧹 Dirty Station',
            access_problem: '🚧 Access Problem',
            wrong_info: 'ℹ️ Wrong Information',
            safety_concern: '🛑 Safety',
            other: '📝 Other',
        };
        const statusLabels = {
            open: 'Open',
            in_progress: 'In Progress',
            resolved: 'Resolved',
            dismissed: 'Dismissed',
        };

        try {
            const reports = await API.getAdminReports();
            if (reports.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No reports found.</td></tr>';
                return;
            }

            tbody.innerHTML = reports.map(r => {
                const date = new Date(r.created_at).toLocaleString('en-US');
                const catLabel = categoryLabels[r.category] || r.category;
                const stLabel = statusLabels[r.status] || r.status;
                const desc = r.description.length > 80 ? r.description.substring(0, 80) + '...' : r.description;

                let actions = '';
                if (r.status === 'open') {
                    actions = `
                        <button class="btn btn-primary btn-sm" style="margin-right:4px;" onclick="Admin.updateReportStatus(${r.id}, 'resolved')">Resolved</button>
                        <button class="btn btn-secondary btn-sm" onclick="Admin.updateReportStatus(${r.id}, 'dismissed')">Dismiss</button>
                    `;
                } else if (r.status === 'in_progress') {
                    actions = `<button class="btn btn-primary btn-sm" onclick="Admin.updateReportStatus(${r.id}, 'resolved')">Resolved</button>`;
                } else {
                    actions = `<span style="font-size:12px;color:var(--muted);">—</span>`;
                }

                return `
                    <tr>
                        <td style="white-space:nowrap;">${date}</td>
                        <td>${r.station_name}</td>
                        <td>${r.user_name}<br><span style="font-size:12px;color:var(--muted);">${r.user_email}</span></td>
                        <td>${catLabel}</td>
                        <td style="max-width:200px;" title="${r.description}">${desc}</td>
                        <td><span class="badge ${r.status}">${stLabel}</span></td>
                        <td>${actions}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: red;">Error: ' + err.message + '</td></tr>';
        }
    },

    async updateReportStatus(reportId, status) {
        try {
            await API.updateReportStatus(reportId, status);
            App.showToast('✅ Report status updated successfully.');
            this.loadReports();
        } catch (err) {
            App.showToast('Error: ' + err.message, 'error');
        }
    },

    // ══════════════════════════════════════
    //  DESTEK TALEPLERİ (SUPPORT TICKETS)
    // ══════════════════════════════════════
    async loadSupportTickets() {
        const tbody = document.getElementById('supportTableBody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading...</td></tr>';

        const statusLabels = {
            open: 'Open',
            in_progress: 'In Progress',
            resolved: 'Resolved',
            closed: 'Closed'
        };

        const categoryLabels = {
            reservation: 'Reservation',
            payment: 'Payment/Wallet',
            charging: 'Charging',
            station: 'Station',
            other: 'Other'
        };

        try {
            const tickets = await API.getAdminSupportTickets();
            if (tickets.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No support tickets yet.</td></tr>';
                return;
            }

            // Save tickets to a local array for modal access
            this._allSupportTickets = tickets;

            tbody.innerHTML = tickets.map(t => {
                const date = new Date(t.created_at).toLocaleString('tr-TR');
                const catLabel = categoryLabels[t.category] || t.category;
                const stLabel = statusLabels[t.status] || t.status;
                const desc = t.description.length > 50 ? t.description.substring(0, 50) + '...' : t.description;

                return `
                    <tr>
                        <td style="white-space:nowrap;">${date}</td>
                        <td>${t.user_name}<br><span style="font-size:12px;color:var(--muted);">${t.user_email}</span></td>
                        <td><strong>${t.subject}</strong><br><span style="font-size:12px;color:var(--muted);">${catLabel}</span></td>
                        <td style="max-width:200px;" title="${t.description}">${desc}</td>
                        <td><span class="badge ${t.status === 'open' ? 'admin' : (t.status === 'resolved' ? 'user' : '')}">${stLabel}</span></td>
                        <td>
                            <button class="btn btn-secondary btn-sm" onclick="Admin.promptUpdateSupport(${t.id})">Update</button>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error: ' + err.message + '</td></tr>';
        }
    },

    promptUpdateSupport(ticketId) {
        const ticket = (this._allSupportTickets || []).find(t => t.id === ticketId);
        if (!ticket) return;

        document.getElementById('usTicketId').value = ticket.id;
        document.getElementById('usUserName').textContent = ticket.user_name;
        document.getElementById('usDescription').textContent = ticket.description;
        document.getElementById('usStatus').value = ticket.status;
        document.getElementById('usAdminNote').value = ticket.admin_note || '';

        document.getElementById('updateSupportModal').classList.add('show');
    },

    closeUpdateSupportModal() {
        document.getElementById('updateSupportModal').classList.remove('show');
    },

    async handleUpdateSupport(e) {
        e.preventDefault();
        const btn = document.getElementById('updateSupportBtn');
        const ticketId = document.getElementById('usTicketId').value;
        const status = document.getElementById('usStatus').value;
        const adminNote = document.getElementById('usAdminNote').value;

        btn.disabled = true;
        btn.textContent = 'Updating...';

        try {
            await API.updateSupportTicketStatus(ticketId, status, adminNote);
            App.showToast('✅ Support ticket updated successfully.');
            this.closeUpdateSupportModal();
            this.loadSupportTickets();
        } catch (err) {
            App.showToast('Error: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Update';
        }
    }
};

// Page loaded
document.addEventListener('DOMContentLoaded', () => {
    Admin.init();
});
