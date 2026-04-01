// ================= CONFIG =================
const BASE_URL = "https://projectno1-1.onrender.com";

// ================= STATE =================
let user_id = Number(localStorage.getItem("user_id")) || null;
let currentChatUser = null;

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

// ================= 🔥 LOGOUT FIXED =================
function logout() {
    if (window.google && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }

    // clear app data
    localStorage.removeItem("user_id");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    localStorage.removeItem("phone");

    user_id = null;
    currentChatUser = null;

    // reset UI
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
    const phone = prompt("Enter phone number:");
    if (!phone) return;

    await api("/updatePhone", "POST", { user_id, phone });
    localStorage.setItem("phone", phone);
    loadProfile();
}

// ================= LOGIN =================
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

    if (section === "current") loadCurrentRides();
    if (section === "suggestions") loadSuggestions();
    if (section === "history") loadHistory();
    if (section === "invites") loadInvites();
    if (section === "friends") loadFriends();
    if (section === "profile") loadProfile();
}

// ================= TEAM =================
function addMemberField() {
    const container = document.getElementById("teamMembers");
    const count = container.querySelectorAll(".member-row").length;

    if (count >= 3) return alert("Max 4 members");

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
    document.getElementById("requiredMembers").textContent = Math.max(0, 4 - (1 + count));
}

// ================= ADD RIDE =================
async function addRide() {
    const start = document.getElementById("start").value;
    const destination = document.getElementById("destination").value;
    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;
    const strictness = document.getElementById("strictness").value;

    if (!start || !destination || !date) return alert("Fill all fields");
    if (strictness !== "low" && !time) return alert("Select time");

    const finalTime = strictness === "low" ? "00" : time;
    const datetime = `${date} ${finalTime}:00:00`;

    const team_members = [];

    document.querySelectorAll("#teamMembers .member-row").forEach(row => {
        const name = row.querySelector(".name").value.trim();
        const phone = row.querySelector(".phone").value.trim();
        const email = row.querySelector(".email").value.trim();

        if (name && phone && email) {
            team_members.push({ name, phone, email });
        }
    });

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
        alert("Error posting ride");
    }
}

// ================= CURRENT =================
async function loadCurrentRides() {
    const data = await api(`/currentRides/${user_id}`);
    const list = document.getElementById("currentList");

    list.innerHTML = "";

    if (!data.rides.length) {
        list.innerHTML = "No active rides";
        return;
    }

    data.rides.forEach(r => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between";

        li.innerHTML = `
            <div>
                ${r.start_location} → ${r.destination}<br>
                <small>${formatTime(r.ride_datetime)}</small>
            </div>
            <button class="btn btn-danger btn-sm" onclick="cancelRide(${r.id})">
                Cancel ❌
            </button>
        `;

        list.appendChild(li);
    });
}

// ================= CANCEL =================
async function cancelRide(id) {
    await api("/cancelRide", "POST", { ride_id: id });
    alert("Ride cancelled");
    loadCurrentRides();
    loadHistory();
}

// ================= HISTORY =================
async function loadHistory() {
    const data = await api(`/myRides/${user_id}`);
    const list = document.getElementById("historyList");

    list.innerHTML = "";

    if (!data.rides.length) {
        list.innerHTML = "No rides";
        return;
    }

    data.rides.forEach(r => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.textContent = `${r.start_location} → ${r.destination} (${formatTime(r.ride_datetime)})`;
        list.appendChild(li);
    });
}

// ================= SUGGESTIONS =================
async function loadSuggestions() {
    const data = await api(`/suggestions/${user_id}`);
    const table = document.getElementById("results");

    table.innerHTML = "";

    if (!data.matches.length) {
        table.innerHTML = `<tr><td colspan="8">No matches</td></tr>`;
        return;
    }

    data.matches.forEach(row => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${row.start_location}</td>
            <td>${row.destination}</td>
            <td>${formatTime(row.ride_datetime)}</td>
            <td>${row.your_members.map(m => m.name).join(", ")}</td>
            <td>${row.their_members.map(m => m.name).join(", ")}</td>
            <td><strong>${row.total_members}/4</strong></td>
            <td>${formatTime(row.matched_time)}</td>
           <td>${row.remark}</td>
            <td><strong>${row.match_percent}%</strong></td>

<td>
    ${
        row.remark === "Friends"
        ? `<button class="btn btn-primary btn-sm"
              onclick="startChatFromSuggestion(${row.matched_user_id})">
              Message 💬
           </button>`
        : `<button class="btn btn-success btn-sm"
              onclick="sendInvite(${row.matched_user_id})">
              Connect
           </button>`
    }
</td>
        `;

        table.appendChild(tr);
    });
}

// ========= START CHAT From suggestion =============
function startChatFromSuggestion(userId) {
    // go to friends section
    showSection("friends");

    // load friends list
    loadFriends();

    // small delay to ensure UI loads
    setTimeout(() => {
        currentChatUser = userId;

        document.getElementById("chatTitle").textContent = "Chat";

        loadMessages();
    }, 300);
}

// ================= INVITES =================
async function sendInvite(receiver_id) {
    const res = await api("/sendInvite", "POST", {
        sender_id: user_id,
        receiver_id
    });
    alert(res.message);
}

async function loadInvites() {
    const data = await api(`/invites/${user_id}`);
    const list = document.getElementById("inviteList");

    list.innerHTML = "";

    if (!data.invites.length) return list.innerHTML = "No invites";

    data.invites.forEach(inv => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between";

        li.innerHTML = `
            ${inv.name}
            <button class="btn btn-success btn-sm" onclick="acceptInvite(${inv.id})">
                Accept
            </button>
        `;

        list.appendChild(li);
    });
}

async function acceptInvite(id) {
    await api("/acceptInvite", "POST", { invite_id: id });
    loadInvites();
    loadFriends();
}

// ================= FRIENDS =================
async function loadFriends() {
    const data = await api(`/friends/${user_id}`);
    const list = document.getElementById("friendsList");

    list.innerHTML = "";

    if (!data.friends.length) return list.innerHTML = "No friends";

    data.friends.forEach(f => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between";

        li.innerHTML = `
            ${f.name}
            <button class="btn btn-primary btn-sm" onclick="openChat(${f.id}, '${f.name}')">
                💬
            </button>
        `;

        list.appendChild(li);
    });
}

// ================= CHAT =================
function openChat(id, name) {
    currentChatUser = id;
    document.getElementById("chatTitle").textContent = "Chat with " + name;
    loadMessages();
}

async function loadMessages() {
    if (!currentChatUser) return;

    const data = await api(`/messages/${user_id}/${currentChatUser}`);
    const box = document.getElementById("chatBox");

    box.innerHTML = "";

    data.messages.forEach(msg => {
        const div = document.createElement("div");
        div.style.textAlign = msg.sender_id == user_id ? "right" : "left";

        div.innerHTML = `
            <span class="badge bg-${msg.sender_id == user_id ? "primary" : "secondary"}">
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

    if (!msg) return;

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
    document.getElementById("profileName").textContent = localStorage.getItem("name") || "";
    document.getElementById("profileEmail").textContent = localStorage.getItem("email") || "";
    document.getElementById("profilePhone").textContent = localStorage.getItem("phone") || "Not set";
}

// ================= UTIL =================
function formatTime(dt) {
    return new Date(dt).toLocaleString("en-IN");
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
    checkLogin();

    const select = document.getElementById("time");
    for (let i = 0; i < 24; i++) {
        const h = i.toString().padStart(2, "0");
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = `${h}:00 - ${h}:59`;
        select.appendChild(opt);
    }

    const dateInput = document.getElementById("date");
    if (dateInput) {
        dateInput.min = new Date().toISOString().split("T")[0];
    }

    document.getElementById("strictness").addEventListener("change", function () {
        const time = document.getElementById("time");

        if (this.value === "low") {
            time.disabled = true;
            time.value = "00";
        } else {
            time.disabled = false;
        }
    });

    updateRequiredMembers();

    setInterval(() => {
        loadCurrentRides();
        loadSuggestions();
    }, 30000);

    setInterval(() => {
        if (currentChatUser) loadMessages();
    }, 2000);
});