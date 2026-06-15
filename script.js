// ================= CONFIG =================
const BASE_URL = "https://projectno1-1.onrender.com";

// ================= STATE =================
let user_id = Number(localStorage.getItem("user_id")) || null;
let currentChatUser = null;
let currentChatName = null;

// ================= API =================
async function api(url, method = "GET", body = null) {
    try {
        const res = await fetch(BASE_URL + url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : null
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || "Server error");
        }

        return data;

    } catch (err) {
        console.error("API Error:", err.message);
        throw err;
    }
}

// ================= TOAST =================
function showToast(message, type = "success") {
    const toast = document.getElementById("appToast");
    const msg   = document.getElementById("toastMsg");

    toast.className = `toast align-items-center text-white border-0 bg-${type}`;
    msg.textContent = message;

    const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
    bsToast.show();
}

// ================= LOGOUT =================
function logout() {
    if (window.google && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }

    localStorage.clear();
    user_id = null;
    currentChatUser = null;
    currentChatName = null;

    document.getElementById("app").style.display = "none";
    document.getElementById("loginSection").classList.remove("d-none");
    document.getElementById("navUser").textContent = "";

    setTimeout(() => location.reload(), 200);
}

// ================= GOOGLE LOGIN =================
async function handleCredentialResponse(response) {
    try {
        const result = await api("/google-login", "POST", {
            token: response.credential
        });

        const user = result.user;
        user_id = user.id;

        localStorage.setItem("user_id", user.id);
        localStorage.setItem("name", user.name);
        localStorage.setItem("email", user.email);
        localStorage.setItem("phone", user.phone || "");

        checkLogin();
        loadProfile();

        if (!user.phone) {
            setTimeout(askPhoneNumber, 500);
        }

    } catch (err) {
        showToast("Login failed. Please try again.", "danger");
    }
}

// ================= PHONE =================
async function askPhoneNumber() {
    const phone = prompt("Enter your phone number:");
    if (!phone) return;

    try {
        await api("/updatePhone", "POST", { user_id, phone });
        localStorage.setItem("phone", phone);
        loadProfile();
        showToast("Phone number updated!");
    } catch {
        showToast("Failed to update phone.", "danger");
    }
}

// ================= LOGIN CHECK =================
function checkLogin() {
    const login = document.getElementById("loginSection");
    const app   = document.getElementById("app");

    if (user_id) {
        login.classList.add("d-none");
        app.style.display = "block";
        document.getElementById("navUser").textContent = "👤 " + (localStorage.getItem("name") || "");
        showSection("home");
    } else {
        login.classList.remove("d-none");
        app.style.display = "none";
    }
}

// ================= NAV =================
function showSection(section) {
    const sections = ["home", "current", "suggestions", "requests", "friends", "profile", "history"];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = "none";
    });

    const target = document.getElementById(section);
    if (target) target.style.display = "block";

    if (section === "current")     loadCurrentRides();
    if (section === "suggestions") loadSuggestions();
    if (section === "requests")    loadRideRequests();
    if (section === "history")     loadHistory();
    if (section === "friends")     loadFriends();
    if (section === "profile")     loadProfile();
}

// ================= TEAM MEMBERS =================
function addMemberField() {
    const container = document.getElementById("teamMembers");
    const count = container.querySelectorAll(".member-row").length;

    if (count >= 3) {
        showToast("Max 4 people per rickshaw (including you).", "warning");
        return;
    }

    const div = document.createElement("div");
    div.className = "row g-2 mt-1 member-row";
    div.innerHTML = `
        <div class="col-md-3">
            <input class="form-control form-control-sm name" placeholder="Name">
        </div>
        <div class="col-md-3">
            <input class="form-control form-control-sm phone" placeholder="Phone">
        </div>
        <div class="col-md-4">
            <input class="form-control form-control-sm email" placeholder="Email">
        </div>
        <div class="col-md-2">
            <button class="btn btn-danger btn-sm w-100" onclick="removeMember(this)">
                <i class="fa fa-times"></i>
            </button>
        </div>
    `;

    container.appendChild(div);
    updateRequiredMembers();
}

function removeMember(btn) {
    btn.closest(".member-row").remove();
    updateRequiredMembers();
}

function updateRequiredMembers() {
    const count = document.querySelectorAll("#teamMembers .member-row").length;
    document.getElementById("addedCount").textContent = count;
    document.getElementById("requiredMembers").textContent = Math.max(0, 3 - count);
}

// ================= ADD RIDE =================
async function addRide() {
    const start       = document.getElementById("start").value;
    const destination = document.getElementById("destination").value;
    const date        = document.getElementById("date").value;
    const time        = document.getElementById("time").value;
    const strictness  = document.getElementById("strictness").value;

    if (!start || !destination) return showToast("Please select start and destination.", "warning");
    if (start === destination)  return showToast("Start and destination cannot be the same.", "warning");
    if (!date)                  return showToast("Please select a date.", "warning");

    const todayStr = new Date().toISOString().split("T")[0];
    if (date < todayStr) return showToast("Cannot post a ride in the past.", "warning");

    if (strictness !== "low" && !time) return showToast("Please select a time.", "warning");

    let hour = strictness === "low" ? "00" : time;
    const datetime = `${date}T${hour}:00:00`;

    if (strictness !== "low" && date === todayStr) {
        const selectedHour = parseInt(hour, 10);
        const currentHour  = new Date().getHours();
        if (selectedHour < currentHour) {
            return showToast("Selected time is in the past.", "warning");
        }
    }

    const memberRows = document.querySelectorAll("#teamMembers .member-row");
    if (memberRows.length > 3) {
        return showToast("Max 4 total members including you.", "warning");
    }

    const team_members = [];
    for (const row of memberRows) {
        const name  = row.querySelector(".name").value.trim();
        const phone = row.querySelector(".phone").value.trim();
        const email = row.querySelector(".email").value.trim();
        if (name && phone && email) {
            team_members.push({ name, phone, email });
        }
    }

    try {
        await api("/addRide", "POST", {
            user_id, start, destination, datetime, strictness, team_members
        });

        showToast("Ride posted successfully! 🚕");
        document.getElementById("teamMembers").innerHTML = "";
        updateRequiredMembers();
        showSection("current");

    } catch (err) {
        showToast(err.message || "Error posting ride.", "danger");
    }
}

// ================= CURRENT RIDES =================
async function loadCurrentRides() {
    const list = document.getElementById("currentList");
    list.innerHTML = `<div class="text-center text-muted py-3"><i class="fa fa-spinner fa-spin me-2"></i>Loading...</div>`;

    try {
        const data = await api(`/currentRides/${user_id}`);

        if (!data.rides.length) {
            list.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fa fa-car fa-2x mb-2"></i>
                    <p>No active rides. Post one!</p>
                </div>`;
            return;
        }

        list.innerHTML = "";
        data.rides.forEach(r => {
            const div = document.createElement("div");
            div.className = "card mb-3 border-0 shadow-sm";
            div.innerHTML = `
                <div class="card-body d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">
                            <i class="fa fa-map-marker-alt text-danger me-1"></i>
                            ${r.start_location} → ${r.destination}
                        </h6>
                        <small class="text-muted">
                            <i class="fa fa-clock me-1"></i>${formatTime(r.ride_datetime)}
                        </small><br>
                        <small class="text-muted">
                            Strictness: <strong>${r.strictness}</strong> &nbsp;|&nbsp;
                            Members: <strong>${r.current_members}/4</strong>
                        </small>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="cancelRide(${r.id})">
                        <i class="fa fa-times me-1"></i>Cancel
                    </button>
                </div>
            `;
            list.appendChild(div);
        });

    } catch {
        list.innerHTML = `<div class="text-danger">Failed to load rides.</div>`;
    }
}

// ================= CANCEL =================
async function cancelRide(id) {
    if (!confirm("Cancel this ride?")) return;

    try {
        await api("/cancelRide", "POST", { ride_id: id, user_id });
        showToast("Ride cancelled.");
        loadCurrentRides();
    } catch (err) {
        showToast(err.message || "Error cancelling ride.", "danger");
    }
}

// ================= HISTORY =================
async function loadHistory() {
    const list = document.getElementById("historyList");
    list.innerHTML = `<div class="text-center text-muted py-3"><i class="fa fa-spinner fa-spin me-2"></i>Loading...</div>`;

    try {
        const data = await api(`/myRides/${user_id}`);

        if (!data.rides.length) {
            list.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fa fa-history fa-2x mb-2"></i>
                    <p>No ride history yet.</p>
                </div>`;
            return;
        }

        list.innerHTML = "";
        data.rides.forEach(r => {
            const badgeColor = r.status === "active" ? "success" : r.status === "completed" ? "primary" : "danger";
            const div = document.createElement("div");
            div.className = "card mb-2 border-0 shadow-sm";
            div.innerHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6 class="mb-1">
                            <i class="fa fa-map-marker-alt text-danger me-1"></i>
                            ${r.start_location} → ${r.destination}
                        </h6>
                        <span class="badge bg-${badgeColor}">${r.status}</span>
                    </div>
                    <small class="text-muted">
                        <i class="fa fa-clock me-1"></i>${formatTime(r.ride_datetime)}
                        &nbsp;|&nbsp; Members: ${r.current_members}/4
                    </small>
                </div>
            `;
            list.appendChild(div);
        });

    } catch {
        list.innerHTML = `<div class="text-danger">Failed to load history.</div>`;
    }
}

// ================= SUGGESTIONS =================
async function loadSuggestions() {
    const list = document.getElementById("suggestionsList");
    list.innerHTML = `<div class="text-center text-muted py-3"><i class="fa fa-spinner fa-spin me-2"></i>Finding matches...</div>`;

    try {
        const data = await api(`/suggestions/${user_id}`);

        if (!data.matches || !data.matches.length) {
            list.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fa fa-search fa-2x mb-2"></i>
                    <p>No matches found. Post a ride first!</p>
                </div>`;
            return;
        }

        list.innerHTML = "";
        data.matches.forEach(row => {
            const matchPct    = row.match_percent ?? 0;
            const badgeColor  = matchPct >= 70 ? "success" : matchPct >= 40 ? "warning" : "secondary";
            const remarkColor = row.remark === "Friends" ? "primary" : row.remark === "Mutual Friends" ? "info" : "secondary";

            const actionBtn = row.already_requested
                ? `<button class="btn btn-secondary btn-sm" disabled>Request Sent ✓</button>`
                : `<button class="btn btn-success btn-sm" onclick="sendRideRequest(${row.your_ride_id}, ${row.their_ride_id}, ${row.matched_user_id})">
                        <i class="fa fa-paper-plane me-1"></i>Request Ride
                   </button>`;

            const div = document.createElement("div");
            div.className = "card mb-3 border-0 shadow-sm";
            div.innerHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                        <div>
                            <h6 class="mb-1">
                                <i class="fa fa-map-marker-alt text-danger me-1"></i>
                                ${row.start_location} → ${row.destination}
                            </h6>
                            <small class="text-muted">
                                <i class="fa fa-clock me-1"></i>Your time: ${formatTime(row.ride_datetime)}
                            </small><br>
                            <small class="text-muted">
                                <i class="fa fa-clock me-1"></i>Their time: ${formatTime(row.matched_time)}
                            </small><br>
                            <small class="text-muted">
                                <i class="fa fa-users me-1"></i>
                                Combined: <strong>${row.total_members}/4</strong>
                                &nbsp;|&nbsp;
                                Matched with: <strong>${row.matched_user_name}</strong>
                            </small>
                        </div>
                        <div class="d-flex flex-column align-items-end gap-2">
                            <span class="badge bg-${remarkColor}">${row.remark}</span>
                            <span class="badge bg-${badgeColor}">${matchPct}% Match</span>
                            ${actionBtn}
                        </div>
                    </div>
                </div>
            `;
            list.appendChild(div);
        });

    } catch {
        list.innerHTML = `<div class="text-danger">Failed to load suggestions.</div>`;
    }
}

// ================= SEND RIDE REQUEST =================
async function sendRideRequest(your_ride_id, their_ride_id, receiver_id) {
    try {
        await api("/sendRideRequest", "POST", {
            sender_id: user_id,
            receiver_id,
            sender_ride_id: your_ride_id,
            receiver_ride_id: their_ride_id
        });
        showToast("Ride request sent! 🚕");
        loadSuggestions();
    } catch (err) {
        showToast(err.message || "Could not send request.", "danger");
    }
}

// ================= RIDE REQUESTS =================
async function loadRideRequests() {
    const list = document.getElementById("requestsList");
    list.innerHTML = `<div class="text-center text-muted py-3"><i class="fa fa-spinner fa-spin me-2"></i>Loading...</div>`;

    try {
        const data = await api(`/rideRequests/${user_id}`);

        // Update badge
        const badge = document.getElementById("requestBadge");
        if (data.requests.length > 0) {
            badge.style.display = "inline";
            badge.textContent = data.requests.length;
        } else {
            badge.style.display = "none";
        }

        if (!data.requests.length) {
            list.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fa fa-paper-plane fa-2x mb-2"></i>
                    <p>No pending ride requests.</p>
                </div>`;
            return;
        }

        list.innerHTML = "";
        data.requests.forEach(req => {
            const div = document.createElement("div");
            div.className = "card mb-3 border-0 shadow-sm";
            div.innerHTML = `
                <div class="card-body d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                        <h6 class="mb-1">
                            <i class="fa fa-user text-primary me-1"></i>
                            ${req.sender ? req.sender.name : "Unknown"} wants to share your ride
                        </h6>
                        <small class="text-muted">
                            <i class="fa fa-clock me-1"></i>${formatTime(req.created_at)}
                        </small>
                    </div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-success btn-sm" onclick="acceptRideRequest(${req.id})">
                            <i class="fa fa-check me-1"></i>Accept
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectRideRequest(${req.id})">
                            <i class="fa fa-times me-1"></i>Reject
                        </button>
                    </div>
                </div>
            `;
            list.appendChild(div);
        });

    } catch {
        list.innerHTML = `<div class="text-danger">Failed to load requests.</div>`;
    }
}

async function acceptRideRequest(request_id) {
    try {
        await api("/acceptRideRequest", "POST", { request_id });
        showToast("Ride request accepted! Rides merged 🚕");
        loadRideRequests();
        loadCurrentRides();
    } catch (err) {
        showToast(err.message || "Error accepting request.", "danger");
    }
}

async function rejectRideRequest(request_id) {
    try {
        await api("/rejectRideRequest", "POST", { request_id });
        showToast("Request rejected.", "warning");
        loadRideRequests();
    } catch (err) {
        showToast(err.message || "Error rejecting request.", "danger");
    }
}

// ================= NOTIFICATIONS =================
async function loadNotifications() {
    try {
        const data = await api(`/notifications/${user_id}`);

        const badge = document.getElementById("bellBadge");
        if (data.unread > 0) {
            badge.style.display = "inline";
            badge.textContent = data.unread;
        } else {
            badge.style.display = "none";
        }

        const list = document.getElementById("notifList");
        list.innerHTML = "";

        if (!data.notifications.length) {
            list.innerHTML = `<li class="p-3 text-muted text-center">No notifications</li>`;
            return;
        }

        data.notifications.forEach(n => {
    const li = document.createElement("li");
    li.className = `border-bottom ${!n.is_read ? "bg-light" : ""}`;
    li.style.fontSize = "13px";
    li.style.lineHeight = "1.5";
    li.style.whiteSpace = "normal";
    li.style.wordBreak = "break-word";
    li.style.padding = "10px 12px";
    li.innerHTML = `
        <div class="d-flex align-items-start gap-2">
            <i class="fa fa-${n.type === 'ride_request' ? 'paper-plane text-success' : n.type === 'ride_accepted' ? 'check text-primary' : 'times text-danger'} mt-1"></i>
            <div>
                <div>${n.message}</div>
                <small class="text-muted">${formatTime(n.created_at)}</small>
            </div>
        </div>
    `;
    list.appendChild(li);
});

        // Also update request badge
        loadRequestBadge();

    } catch (err) {
        console.error("Notification error:", err);
    }
}

async function loadRequestBadge() {
    try {
        const data = await api(`/rideRequests/${user_id}`);
        const badge = document.getElementById("requestBadge");
        if (data.requests.length > 0) {
            badge.style.display = "inline";
            badge.textContent = data.requests.length;
        } else {
            badge.style.display = "none";
        }
    } catch {}
}

function toggleNotifications() {
    const dropdown = document.getElementById("notifDropdown");
    dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
}

async function markAllRead() {
    try {
        await api("/markNotificationsRead", "POST", { user_id });
        document.getElementById("bellBadge").style.display = "none";
        loadNotifications();
        showToast("All notifications marked as read.");
    } catch {}
}

// Close notification dropdown when clicking outside
document.addEventListener("click", (e) => {
    const bell = document.getElementById("bellContainer");
    if (bell && !bell.contains(e.target)) {
        const dropdown = document.getElementById("notifDropdown");
        if (dropdown) dropdown.style.display = "none";
    }
});

// ================= FRIENDS =================
async function loadFriends() {
    const list = document.getElementById("friendsList");
    list.innerHTML = "";

    try {
        const data = await api(`/friends/${user_id}`);

        if (!data.friends || !data.friends.length) {
            list.innerHTML = `<li class="list-group-item text-muted text-center">No friends yet</li>`;
            return;
        }

        data.friends.forEach(f => {
            const li = document.createElement("li");
            li.className = "list-group-item d-flex justify-content-between align-items-center";
            li.innerHTML = `
                <span><i class="fa fa-user-circle text-primary me-2"></i>${f.name || "Unknown"}</span>
                <button class="btn btn-primary btn-sm" onclick="openChat(${f.id}, '${(f.name || 'Friend').replace(/'/g, "\\'")}')">
                    <i class="fa fa-comment"></i>
                </button>
            `;
            list.appendChild(li);
        });

    } catch {
        list.innerHTML = `<li class="list-group-item text-danger">Failed to load friends.</li>`;
    }
}

// ================= CHAT =================
function openChat(id, name) {
    currentChatUser = id;
    currentChatName = name;
    document.getElementById("chatTitle").innerHTML = `<i class="fa fa-comment me-2"></i>Chat with ${name}`;
    loadMessages();
}

async function loadMessages() {
    if (!currentChatUser) return;

    const box = document.getElementById("chatBox");

    try {
        const data = await api(`/messages/${user_id}/${currentChatUser}`);

        if (!data.messages.length) {
            box.innerHTML = `<p class="text-muted text-center mt-3">No messages yet. Say hi! 👋</p>`;
            return;
        }

        box.innerHTML = "";
        data.messages.forEach(msg => {
            const isMe = msg.sender_id == user_id;
            const div = document.createElement("div");
            div.className = `mb-2 d-flex ${isMe ? "justify-content-end" : "justify-content-start"}`;
            div.innerHTML = `
                <div class="chat-bubble ${isMe ? "chat-me" : "chat-other"}">
                    ${msg.message}
                    <div class="chat-time">${formatTime(msg.created_at)}</div>
                </div>
            `;
            box.appendChild(div);
        });

        box.scrollTop = box.scrollHeight;

    } catch {
        box.innerHTML = `<p class="text-danger">Failed to load messages.</p>`;
    }
}

async function sendMessage() {
    const input = document.getElementById("chatInput");
    const msg = input.value.trim();
    if (!msg || !currentChatUser) return;

    try {
        await api("/sendMessage", "POST", {
            sender_id: user_id,
            receiver_id: currentChatUser,
            message: msg
        });
        input.value = "";
        loadMessages();
    } catch {
        showToast("Failed to send message.", "danger");
    }
}

// Enter key to send message
document.addEventListener("DOMContentLoaded", () => {
    const chatInput = document.getElementById("chatInput");
    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") sendMessage();
        });
    }
});

// ================= PROFILE =================
function loadProfile() {
    document.getElementById("profileName").textContent  = localStorage.getItem("name")  || "";
    document.getElementById("profileEmail").textContent = localStorage.getItem("email") || "";
    document.getElementById("profilePhone").textContent = localStorage.getItem("phone") || "Not set";
}

// ================= UTIL =================
function formatTime(dt) {
    if (!dt) return "—";
    const d = new Date(dt);
    if (isNaN(d)) return dt;
    return d.toLocaleString("en-IN", {
        day:    "2-digit",
        month:  "short",
        year:   "numeric",
        hour:   "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
    checkLogin();

    // Time dropdown
    const select = document.getElementById("time");
    for (let i = 0; i < 24; i++) {
        const h    = i.toString().padStart(2, "0");
        const ampm = i < 12 ? "AM" : "PM";
        const h12  = i === 0 ? 12 : i > 12 ? i - 12 : i;
        const opt  = document.createElement("option");
        opt.value       = h;
        opt.textContent = `${h12}:00 ${ampm}`;
        select.appendChild(opt);
    }

    // Min date = today
    const dateInput = document.getElementById("date");
    if (dateInput) {
        dateInput.min = new Date().toISOString().split("T")[0];
    }

    // Strictness toggle
    document.getElementById("strictness").addEventListener("change", function () {
        const timeSelect = document.getElementById("time");
        if (this.value === "low") {
            timeSelect.disabled = true;
            timeSelect.value = "00";
        } else {
            timeSelect.disabled = false;
        }
    });

    updateRequiredMembers();

    // Polling
    setInterval(() => {
        if (user_id) loadNotifications();
    }, 15000);

    setInterval(() => {
        const currentVisible     = document.getElementById("current")?.style.display !== "none";
        const suggestionsVisible = document.getElementById("suggestions")?.style.display !== "none";
        const requestsVisible    = document.getElementById("requests")?.style.display !== "none";
        if (currentVisible)     loadCurrentRides();
        if (suggestionsVisible) loadSuggestions();
        if (requestsVisible)    loadRideRequests();
    }, 30000);

    setInterval(() => {
        if (currentChatUser) loadMessages();
    }, 3000);
});