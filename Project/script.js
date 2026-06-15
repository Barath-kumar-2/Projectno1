// ================= CONFIG =================
const BASE_URL = "https://projectno1-1.onrender.com";

// ================= STATE =================
let user_id = Number(localStorage.getItem("user_id")) || null;
let currentChatUser = null;
let currentChatName = null;

// ================= API =================
async function api(url, method = "GET", body = null) {
    const res = await fetch(BASE_URL + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : null
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("API ERROR:", text);
        throw new Error("Server error");
    }

    return res.json();
}

// ================= LOGOUT =================
function logout() {
    if (window.google && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }

    localStorage.removeItem("user_id");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    localStorage.removeItem("phone");

    user_id = null;
    currentChatUser = null;
    currentChatName = null;

    document.getElementById("app").style.display = "none";
    document.getElementById("loginSection").classList.remove("d-none");

    const navUser = document.getElementById("navUser");
    if (navUser) navUser.textContent = "";

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
        alert("Login failed");
        console.error(err);
    }
}

// ================= PHONE =================
async function askPhoneNumber() {
    const phone = prompt("Enter your phone number:");
    if (!phone) return;

    await api("/updatePhone", "POST", { user_id, phone });
    localStorage.setItem("phone", phone);
    loadProfile();
}

// ================= LOGIN CHECK =================
function checkLogin() {
    const login = document.getElementById("loginSection");
    const app = document.getElementById("app");

    if (user_id) {
        login.classList.add("d-none");
        app.style.display = "block";

        document.getElementById("navUser").textContent =
            "👤 " + (localStorage.getItem("name") || "");

        showSection("home");
    } else {
        login.classList.remove("d-none");
        app.style.display = "none";
    }
}

// ================= NAV =================
function showSection(section) {
    const sections = ["home", "current", "suggestions", "invites", "friends", "profile", "history"];

    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = "none";
    });

    const target = document.getElementById(section);
    if (target) target.style.display = "block";

    if (section === "current")     loadCurrentRides();
    if (section === "suggestions") loadSuggestions();
    if (section === "history")     loadHistory();
    if (section === "invites")     loadInvites();
    if (section === "friends")     loadFriends();
    if (section === "profile")     loadProfile();
}

// ================= TEAM MEMBERS =================
function addMemberField() {
    const container = document.getElementById("teamMembers");
    const count = container.querySelectorAll(".member-row").length;

    // User is member 1, so max 3 additional members (total = 4)
    if (count >= 3) {
        alert("Max 4 people per rickshaw (including you). Cannot add more.");
        return;
    }

    const div = document.createElement("div");
    div.className = "row mt-2 member-row";

    div.innerHTML = `
        <div class="col-md-3"><input class="form-control name" placeholder="Name"></div>
        <div class="col-md-3"><input class="form-control phone" placeholder="Phone"></div>
        <div class="col-md-4"><input class="form-control email" placeholder="Email"></div>
        <div class="col-md-2">
            <button class="btn btn-danger w-100" onclick="removeMember(this)">X</button>
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

    if (!start || !destination)   return alert("Please select start and destination.");
    if (start === destination)    return alert("Start and destination cannot be the same.");
    if (!date)                    return alert("Please select a date.");

    // ---- Fix #4: Prevent past rides ----
    const now = new Date();
    const selectedDate = new Date(date);
    // zero out time for date-only comparison
    const todayStr = now.toISOString().split("T")[0];
    if (date < todayStr) return alert("Cannot post a ride in the past.");

    if (strictness !== "low" && !time) return alert("Please select a time.");

    // ---- Fix #8: Build datetime in local time ----
    let hour = strictness === "low" ? "00" : time;
    const datetime = `${date}T${hour}:00:00`; // ISO local-time string

    // ---- Fix #4b: If today, ensure hour is not in the past ----
    if (strictness !== "low" && date === todayStr) {
        const selectedHour = parseInt(hour, 10);
        const currentHour  = now.getHours();
        if (selectedHour < currentHour) {
            return alert("Selected time is in the past. Please choose a future time.");
        }
    }

    // ---- Fix #9: Ensure total team <= 4 ----
    const memberRows = document.querySelectorAll("#teamMembers .member-row");
    if (memberRows.length > 3) {
        return alert("Too many members. Max 4 total (including you).");
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
            user_id,
            start,
            destination,
            datetime,
            strictness,
            team_members
        });

        alert("Ride posted!");
        document.getElementById("teamMembers").innerHTML = "";
        updateRequiredMembers();
        showSection("current");

    } catch {
        alert("Error posting ride.");
    }
}

// ================= CURRENT RIDES =================
async function loadCurrentRides() {
    const data = await api(`/currentRides/${user_id}`);
    const list = document.getElementById("currentList");
    list.innerHTML = "";

    if (!data.rides.length) {
        list.innerHTML = "<li class='list-group-item text-muted'>No active rides</li>";
        return;
    }

    data.rides.forEach(r => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center";

        li.innerHTML = `
            <div>
                <strong>${r.start_location} → ${r.destination}</strong><br>
                <small>${formatTime(r.ride_datetime)}</small><br>
                <small class="text-muted">Strictness: ${r.strictness} | Members: ${r.current_members}/4</small>
            </div>
            <button class="btn btn-danger btn-sm" onclick="cancelRide(${r.id})">Cancel ❌</button>
        `;

        list.appendChild(li);
    });
}

// ================= CANCEL =================
async function cancelRide(id) {
    if (!confirm("Cancel this ride?")) return;
    await api("/cancelRide", "POST", { ride_id: id });
    alert("Ride cancelled.");
    loadCurrentRides();
}

// ================= HISTORY =================
async function loadHistory() {
    const data = await api(`/myRides/${user_id}`);
    const list = document.getElementById("historyList");
    list.innerHTML = "";

    if (!data.rides.length) {
        list.innerHTML = "<li class='list-group-item text-muted'>No rides yet</li>";
        return;
    }

    data.rides.forEach(r => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.innerHTML = `
            <strong>${r.start_location} → ${r.destination}</strong>
            <span class="badge bg-${r.status === 'active' ? 'success' : r.status === 'cancelled' ? 'danger' : 'secondary'} ms-2">${r.status}</span>
            <br><small class="text-muted">${formatTime(r.ride_datetime)}</small>
        `;
        list.appendChild(li);
    });
}

// ================= SUGGESTIONS =================
async function loadSuggestions() {
    const data = await api(`/suggestions/${user_id}`);
    const table = document.getElementById("results");
    table.innerHTML = "";

    if (!data.matches || !data.matches.length) {
        table.innerHTML = `<tr><td colspan="10" class="text-muted">No matches found</td></tr>`;
        return;
    }

    data.matches.forEach(row => {
        const tr = document.createElement("tr");

        const matchPct = row.match_percent ?? 0;
        const badgeColor = matchPct >= 70 ? "success" : matchPct >= 40 ? "warning" : "secondary";

        tr.innerHTML = `
            <td>${row.start_location}</td>
            <td>${row.destination}</td>
            <td>${formatTime(row.ride_datetime)}</td>
            <td>${(row.your_members || []).map(m => m.name).join(", ") || "-"}</td>
            <td>${(row.their_members || []).map(m => m.name).join(", ") || "-"}</td>
            <td><strong>${row.total_members}/4</strong></td>
            <td>${formatTime(row.matched_time)}</td>
            <td>
                <span class="badge bg-${row.remark === 'Friends' ? 'primary' : row.remark === 'Mutual Friends' ? 'info' : 'secondary'}">
                    ${row.remark}
                </span>
            </td>
            <td><span class="badge bg-${badgeColor}">${matchPct}%</span></td>
            <td>
                ${
                    row.remark === "Friends"
                    ? `<button class="btn btn-primary btn-sm" onclick="startChatFromSuggestion(${row.matched_user_id}, '${row.matched_user_name}')">Message 💬</button>`
                    : `<button class="btn btn-success btn-sm" onclick="sendInvite(${row.matched_user_id})">Connect</button>`
                }
            </td>
        `;

        table.appendChild(tr);
    });
}

// ================= CHAT from suggestion =================
function startChatFromSuggestion(userId, userName) {
    showSection("friends");
    loadFriends();

    setTimeout(() => {
        currentChatUser = userId;
        currentChatName = userName || "Friend";
        document.getElementById("chatTitle").textContent = "Chat with " + currentChatName;
        loadMessages();
    }, 400);
}

// ================= INVITES =================
async function sendInvite(receiver_id) {
    try {
        const res = await api("/sendInvite", "POST", {
            sender_id: user_id,
            receiver_id
        });
        alert(res.message);
    } catch {
        alert("Could not send invite (maybe already sent).");
    }
}

async function loadInvites() {
    const data = await api(`/invites/${user_id}`);
    const list = document.getElementById("inviteList");
    list.innerHTML = "";

    if (!data.invites.length) {
        list.innerHTML = "<li class='list-group-item text-muted'>No pending invitations</li>";
        return;
    }

    data.invites.forEach(inv => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center";

        li.innerHTML = `
            <span>${inv.name}</span>
            <button class="btn btn-success btn-sm" onclick="acceptInvite(${inv.id})">Accept ✅</button>
        `;

        list.appendChild(li);
    });
}

async function acceptInvite(id) {
    await api("/acceptInvite", "POST", { invite_id: id });
    alert("Friend added!");
    loadInvites();
    loadFriends();
}

// ================= FRIENDS =================
async function loadFriends() {
    const data = await api(`/friends/${user_id}`);
    const list = document.getElementById("friendsList");
    list.innerHTML = "";

    if (!data.friends || !data.friends.length) {
        list.innerHTML = "<li class='list-group-item text-muted'>No friends yet</li>";
        return;
    }

    data.friends.forEach(f => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center";

        // Fix #3: f.name must come from backend with name resolved
        li.innerHTML = `
            <span>${f.name || "Unknown"}</span>
            <button class="btn btn-primary btn-sm" onclick="openChat(${f.id}, '${(f.name || 'Friend').replace(/'/g, "\\'")}')">💬</button>
        `;

        list.appendChild(li);
    });
}

// ================= CHAT =================
function openChat(id, name) {
    currentChatUser = id;
    currentChatName = name;
    document.getElementById("chatTitle").textContent = "Chat with " + name;
    loadMessages();
}

async function loadMessages() {
    if (!currentChatUser) return;

    const data = await api(`/messages/${user_id}/${currentChatUser}`);
    const box = document.getElementById("chatBox");
    box.innerHTML = "";

    if (!data.messages.length) {
        box.innerHTML = "<p class='text-muted text-center mt-3'>No messages yet. Say hi! 👋</p>";
        return;
    }

    data.messages.forEach(msg => {
        const isMe = msg.sender_id == user_id;
        const div = document.createElement("div");
        div.className = `mb-1 d-flex ${isMe ? "justify-content-end" : "justify-content-start"}`;

        div.innerHTML = `
            <span class="badge bg-${isMe ? "primary" : "secondary"} p-2" style="max-width:70%;white-space:normal;text-align:left;">
                ${msg.message}
            </span>
        `;

        box.appendChild(div);
    });

    box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById("chatInput");
    const msg = input.value.trim();
    if (!msg || !currentChatUser) return;

    await api("/sendMessage", "POST", {
        sender_id: user_id,
        receiver_id: currentChatUser,
        message: msg
    });

    input.value = "";
    loadMessages();
}

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
    // Fix #8: always show AM/PM clearly in IST locale
    return d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
    checkLogin();

    // Populate time dropdown with AM/PM labels (Fix #8)
    const select = document.getElementById("time");
    for (let i = 0; i < 24; i++) {
        const h   = i.toString().padStart(2, "0");
        const ampm = i < 12 ? "AM" : "PM";
        const h12  = i === 0 ? 12 : i > 12 ? i - 12 : i;
        const opt  = document.createElement("option");
        opt.value       = h;
        opt.textContent = `${h12}:00 ${ampm} (${h}:00 - ${h}:59)`;
        select.appendChild(opt);
    }

    // Fix #4: Set min date to today
    const dateInput = document.getElementById("date");
    if (dateInput) {
        dateInput.min = new Date().toISOString().split("T")[0];
    }

    // Fix #5: Strictness toggle
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
        const currentVisible = document.getElementById("current").style.display !== "none";
        const sugVisible     = document.getElementById("suggestions").style.display !== "none";
        if (currentVisible) loadCurrentRides();
        if (sugVisible)     loadSuggestions();
    }, 30000);

    setInterval(() => {
        if (currentChatUser) loadMessages();
    }, 3000);
});
