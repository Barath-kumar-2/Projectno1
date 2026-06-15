const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const supabase = require("./db");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = 5000;

const CLIENT_ID = "1025485618680-2tthbngduvs4s60vbon7ilqvsrtdfr7n.apps.googleusercontent.com";
const client = new OAuth2Client(CLIENT_ID);

app.use(cors());
app.use(express.json());

/* ================= NODEMAILER SETUP ================= */
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

async function sendEmail(to, subject, text) {
    if (!to) return;
    try {
        await transporter.sendMail({
            from: `"Rickmate 🚕" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            text
        });
    } catch (err) {
        console.error("Email error:", err.message);
    }
}

/* ================= HELPER: Create Notification ================= */
async function createNotification(user_id, message, type) {
    await supabase
        .from("notifications")
        .insert([{ user_id, message, type }]);
}

/* ================= HELPER: Get Friend IDs ================= */
async function getFriendIds(userId) {
    const { data } = await supabase
        .from("friends")
        .select("user1_id, user2_id")
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (!data) return new Set();
    return new Set(data.map(f => Number(f.user1_id) === userId ? Number(f.user2_id) : Number(f.user1_id)));
}

/* ================= GOOGLE LOGIN ================= */
app.post("/google-login", async (req, res) => {
    try {
        const { token } = req.body;

        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: CLIENT_ID
        });

        const payload = ticket.getPayload();
        const { name, email, sub: google_id } = payload;

        let { data: user } = await supabase
            .from("users")
            .select("*")
            .eq("google_id", google_id)
            .maybeSingle();

        if (!user) {
            const { data, error } = await supabase
                .from("users")
                .insert([{ name, email, google_id }])
                .select()
                .single();

            if (error) throw error;
            user = data;
        }

        res.json({ user });

    } catch (err) {
        res.status(401).json({ message: err.message });
    }
});

/* ================= UPDATE PHONE ================= */
app.post("/updatePhone", async (req, res) => {
    try {
        const { user_id, phone } = req.body;

        const { error } = await supabase
            .from("users")
            .update({ phone })
            .eq("id", user_id);

        if (error) throw error;
        res.json({ message: "Phone updated" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= ADD RIDE ================= */
app.post("/addRide", async (req, res) => {
    try {
        let { user_id, start, destination, datetime, strictness, team_members = [] } = req.body;

        if (!start || !destination || !datetime) {
            return res.status(400).json({ message: "Missing required fields." });
        }

        if (start === destination) {
            return res.status(400).json({ message: "Start and destination cannot be the same." });
        }

        const rideTime = new Date(datetime);
        if (rideTime < new Date()) {
            return res.status(400).json({ message: "Cannot post a ride in the past." });
        }

        if (team_members.length > 3) {
            return res.status(400).json({ message: "Max 4 members total (including you)." });
        }

        const totalMembers = 1 + team_members.length;
        const members_required = Math.max(0, 4 - totalMembers);

        const { data: ride, error } = await supabase
            .from("rides")
            .insert([{
                user_id,
                start_location: start,
                destination,
                ride_datetime: new Date(datetime).toISOString(),
                strictness: strictness || "medium",
                current_members: totalMembers,
                members_required
            }])
            .select()
            .single();

        if (error) throw error;

        const ride_id = ride.id;

        // Add ride owner to ride_members
        await supabase.from("ride_members")
            .insert([{ ride_id, user_id }]);

        // Add team members
        for (let m of team_members) {
            if (!m.name || !m.phone || !m.email) continue;

            let { data: existingUser } = await supabase
                .from("users")
                .select("*")
                .or(`phone.eq.${m.phone},email.eq.${m.email}`)
                .maybeSingle();

            if (!existingUser) {
                const { data } = await supabase
                    .from("users")
                    .insert([{ name: m.name || "Unknown", phone: m.phone, email: m.email }])
                    .select()
                    .single();
                existingUser = data;
            }

            await supabase.from("team_members")
                .insert([{ ride_id, name: m.name, phone: m.phone, email: m.email }]);

            await supabase.from("ride_members")
                .upsert([{ ride_id, user_id: existingUser.id }], { onConflict: "ride_id,user_id" });
        }

        res.json({ message: "Ride posted successfully!" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

/* ================= CURRENT RIDES ================= */
app.get("/currentRides/:user_id", async (req, res) => {
    try {
        const { data } = await supabase
            .from("ride_members")
            .select("rides(*)")
            .eq("user_id", req.params.user_id);

        const now = new Date();
        const rides = data
            .map(r => r.rides)
            .filter(r => r && r.status === "active" && new Date(r.ride_datetime) >= now)
            .sort((a, b) => new Date(a.ride_datetime) - new Date(b.ride_datetime));

        res.json({ rides });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= CANCEL RIDE ================= */
app.post("/cancelRide", async (req, res) => {
    try {
        const { ride_id, user_id } = req.body;

        // Only owner can cancel
        const { data: ride } = await supabase
            .from("rides")
            .select("user_id")
            .eq("id", ride_id)
            .single();

        if (!ride || ride.user_id !== user_id) {
            return res.status(403).json({ message: "Only the ride owner can cancel." });
        }

        await supabase
            .from("rides")
            .update({ status: "cancelled" })
            .eq("id", ride_id);

        res.json({ message: "Ride cancelled." });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= RIDE HISTORY ================= */
app.get("/myRides/:user_id", async (req, res) => {
    try {
        const { data } = await supabase
            .from("ride_members")
            .select("rides(*)")
            .eq("user_id", req.params.user_id);

        const rides = data
            .map(r => r.rides)
            .filter(r => r)
            .sort((a, b) => new Date(b.ride_datetime) - new Date(a.ride_datetime));

        res.json({ rides });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= SUGGESTIONS ================= */
app.get("/suggestions/:user_id", async (req, res) => {
    try {
        const user_id = Number(req.params.user_id);
        const now = new Date();

        // Fetch all active future rides
        const { data: rides } = await supabase
            .from("rides")
            .select("*")
            .eq("status", "active")
            .gt("ride_datetime", now.toISOString());

        if (!rides || !rides.length) return res.json({ matches: [] });

        // Filter out past rides on JS side too (double safety)
        const futureRides = rides.filter(r => new Date(r.ride_datetime) > now);
        if (!futureRides.length) return res.json({ matches: [] });

        // Build userMap upfront
        const allUserIds = [...new Set(futureRides.map(r => r.user_id))];
        const { data: allUsers } = await supabase
            .from("users")
            .select("id, name, email")
            .in("id", allUserIds);

        const userMap = {};
        (allUsers || []).forEach(u => { userMap[u.id] = u; });

        // Get my friend IDs
        const myFriendIds = await getFriendIds(user_id);

        // Get pending/sent request ride IDs to avoid duplicate requests
        const { data: sentRequests } = await supabase
            .from("ride_requests")
            .select("receiver_ride_id")
            .eq("sender_id", user_id)
            .eq("status", "pending");

        const sentRideIds = new Set((sentRequests || []).map(r => r.receiver_ride_id));

        const final = [];
        const seenPairs = new Set();

        for (let r1 of futureRides) {
            for (let r2 of futureRides) {
                if (r1.id === r2.id) continue;
                if (r1.user_id === r2.user_id) continue;

                const r1IsMe = r1.user_id === user_id;
                const r2IsMe = r2.user_id === user_id;
                if (!r1IsMe && !r2IsMe) continue;

                const yourRide  = r1IsMe ? r1 : r2;
                const theirRide = r1IsMe ? r2 : r1;

                // Deduplicate pairs
                const pairKey = [yourRide.id, theirRide.id].sort().join("-");
                if (seenPairs.has(pairKey)) continue;

                // Route must match
                if (yourRide.start_location !== theirRide.start_location) continue;
                if (yourRide.destination !== theirRide.destination) continue;

                // Must be same date
                const yourDate  = new Date(yourRide.ride_datetime);
                const theirDate = new Date(theirRide.ride_datetime);
                if (yourDate.toDateString() !== theirDate.toDateString()) continue;

                // Strictness matching
                const hourDiff = Math.abs(yourDate.getHours() - theirDate.getHours());
                const yourStrictness  = yourRide.strictness;
                const theirStrictness = theirRide.strictness;

                let timeMatch = false;
                let timeScore = 0;

                if (yourStrictness === "low" || theirStrictness === "low") {
                    timeMatch = true;
                    timeScore = 0.5;
                } else if (yourStrictness === "medium" || theirStrictness === "medium") {
                    if (hourDiff <= 1) {
                        timeMatch = true;
                        timeScore = hourDiff === 0 ? 1.0 : 0.7;
                    }
                } else {
                    // both high
                    if (hourDiff === 0) {
                        timeMatch = true;
                        timeScore = 1.0;
                    }
                }

                if (!timeMatch) continue;

                // Check seat availability
                // Only show if combining won't exceed 4
                const combinedMembers = yourRide.current_members + theirRide.current_members;
                if (combinedMembers > 4) continue;

                const theirUserId = theirRide.user_id;
                const theirUser   = userMap[theirUserId];

                // Relationship score
                const isFriend = myFriendIds.has(theirUserId);
                const theirFriendIds = await getFriendIds(theirUserId);
                const hasMutualFriend = [...myFriendIds].some(id => theirFriendIds.has(id));

                let x = 0;
                let remark = "Stranger";
                if (isFriend) {
                    x = 1;
                    remark = "Friends";
                } else if (hasMutualFriend) {
                    x = 0.5;
                    remark = "Mutual Friends";
                }

                // Match score
                const matchScore =
                    0.30 * 1.0 +
                    0.25 * 1.0 +
                    0.25 * timeScore +
                    0.20 * x;

                const match_percent = Math.round(matchScore * 100);

                // Already sent request?
                const alreadyRequested = sentRideIds.has(theirRide.id);

                seenPairs.add(pairKey);

                final.push({
                    your_ride_id:      yourRide.id,
                    their_ride_id:     theirRide.id,
                    start_location:    yourRide.start_location,
                    destination:       yourRide.destination,
                    ride_datetime:     yourRide.ride_datetime,
                    matched_time:      theirRide.ride_datetime,
                    your_members:      yourRide.current_members,
                    their_members:     theirRide.current_members,
                    total_members:     combinedMembers,
                    matched_user_id:   theirUserId,
                    matched_user_name: theirUser ? theirUser.name : "Unknown",
                    matched_user_email: theirUser ? theirUser.email : null,
                    remark,
                    match_percent,
                    already_requested: alreadyRequested
                });
            }
        }

        // Sort by match_percent descending (friends first)
        final.sort((a, b) => b.match_percent - a.match_percent);

        res.json({ matches: final });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

/* ================= RIDE REQUESTS ================= */
app.post("/sendRideRequest", async (req, res) => {
    try {
        const { sender_id, receiver_id, sender_ride_id, receiver_ride_id } = req.body;

        // Check if request already exists
        const { data: existing } = await supabase
            .from("ride_requests")
            .select("id")
            .eq("sender_ride_id", sender_ride_id)
            .eq("receiver_ride_id", receiver_ride_id)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ message: "Request already sent." });
        }

        await supabase.from("ride_requests").insert([{
            sender_id,
            receiver_id,
            sender_ride_id,
            receiver_ride_id,
            status: "pending"
        }]);

        // Get sender name
        const { data: sender } = await supabase
            .from("users")
            .select("name, email")
            .eq("id", sender_id)
            .single();

        // Get receiver email
        const { data: receiver } = await supabase
            .from("users")
            .select("name, email")
            .eq("id", receiver_id)
            .single();

        // Create notification
        await createNotification(
            receiver_id,
            `${sender.name} sent you a ride request!`,
            "ride_request"
        );

        // Send email
        await sendEmail(
            receiver.email,
            "New Ride Request - Rickmate 🚕",
            `Hi ${receiver.name},\n\n${sender.name} wants to share a ride with you on Rickmate!\n\nOpen the app to accept or reject.\n\n- Rickmate Team`
        );

        res.json({ message: "Ride request sent!" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

app.get("/rideRequests/:user_id", async (req, res) => {
    try {
        const { data } = await supabase
            .from("ride_requests")
            .select("*, sender:users!ride_requests_sender_id_fkey(id, name, email)")
            .eq("receiver_id", req.params.user_id)
            .eq("status", "pending");

        res.json({ requests: data || [] });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post("/acceptRideRequest", async (req, res) => {
    try {
        const { request_id } = req.body;

        // Get the request
        const { data: request } = await supabase
            .from("ride_requests")
            .select("*")
            .eq("id", request_id)
            .single();

        if (!request) return res.status(404).json({ message: "Request not found." });

        // Get both rides
        const { data: senderRide } = await supabase
            .from("rides")
            .select("*")
            .eq("id", request.sender_ride_id)
            .single();

        const { data: receiverRide } = await supabase
            .from("rides")
            .select("*")
            .eq("id", request.receiver_ride_id)
            .single();

        // Check combined members <= 4
        const combined = senderRide.current_members + receiverRide.current_members;
        if (combined > 4) {
            return res.status(400).json({ message: "Combined members exceed 4. Cannot merge." });
        }

        // Merge: add sender ride members to receiver ride
        const { data: senderMembers } = await supabase
            .from("ride_members")
            .select("user_id")
            .eq("ride_id", request.sender_ride_id);

        for (let m of senderMembers) {
            await supabase.from("ride_members")
                .upsert([{ ride_id: request.receiver_ride_id, user_id: m.user_id }],
                    { onConflict: "ride_id,user_id" });
        }

        // Update receiver ride member count
        await supabase.from("rides")
            .update({
                current_members: combined,
                members_required: Math.max(0, 4 - combined)
            })
            .eq("id", request.receiver_ride_id);

        // Cancel sender's original ride
        await supabase.from("rides")
            .update({ status: "cancelled" })
            .eq("id", request.sender_ride_id);

        // Update request status
        await supabase.from("ride_requests")
            .update({ status: "accepted" })
            .eq("id", request_id);

        // Auto add as friends
        await supabase.from("friends")
            .upsert([{ user1_id: request.sender_id, user2_id: request.receiver_id }],
                { onConflict: "user1_id,user2_id" });

        // Get user details for notifications
        const { data: sender } = await supabase
            .from("users").select("name, email").eq("id", request.sender_id).single();
        const { data: receiver } = await supabase
            .from("users").select("name, email").eq("id", request.receiver_id).single();

        // Notify sender
        await createNotification(
            request.sender_id,
            `${receiver.name} accepted your ride request! You're now ride partners 🚕`,
            "ride_accepted"
        );

        // Send email to sender
        await sendEmail(
            sender.email,
            "Ride Request Accepted - Rickmate 🚕",
            `Hi ${sender.name},\n\n${receiver.name} accepted your ride request!\n\nYou're now ride partners. Open the app to chat.\n\n- Rickmate Team`
        );

        res.json({ message: "Ride request accepted! Rides merged." });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

app.post("/rejectRideRequest", async (req, res) => {
    try {
        const { request_id } = req.body;

        const { data: request } = await supabase
            .from("ride_requests")
            .select("*, sender:users!ride_requests_sender_id_fkey(name, email)")
            .eq("id", request_id)
            .single();

        await supabase.from("ride_requests")
            .update({ status: "rejected" })
            .eq("id", request_id);

        // Notify sender
        const { data: receiver } = await supabase
            .from("users").select("name").eq("id", request.receiver_id).single();

        await createNotification(
            request.sender_id,
            `${receiver.name} rejected your ride request.`,
            "ride_rejected"
        );

        res.json({ message: "Request rejected." });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= NOTIFICATIONS ================= */
app.get("/notifications/:user_id", async (req, res) => {
    try {
        const { data } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", req.params.user_id)
            .order("created_at", { ascending: false })
            .limit(20);

        const unread = (data || []).filter(n => !n.is_read).length;

        res.json({ notifications: data || [], unread });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post("/markNotificationsRead", async (req, res) => {
    try {
        await supabase
            .from("notifications")
            .update({ is_read: true })
            .eq("user_id", req.body.user_id)
            .eq("is_read", false);

        res.json({ message: "Marked as read" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= FRIENDS ================= */
app.get("/friends/:user_id", async (req, res) => {
    try {
        const uid = Number(req.params.user_id);

        const { data } = await supabase
            .from("friends")
            .select("user1_id, user2_id")
            .or(`user1_id.eq.${uid},user2_id.eq.${uid}`);

        if (!data || !data.length) return res.json({ friends: [] });

        const friendIds = data.map(f =>
            Number(f.user1_id) === uid ? Number(f.user2_id) : Number(f.user1_id)
        );

        const { data: users } = await supabase
            .from("users")
            .select("id, name, email, phone")
            .in("id", friendIds);

        res.json({ friends: users || [] });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= CHAT ================= */
app.get("/messages/:u1/:u2", async (req, res) => {
    try {
        const { data } = await supabase
            .from("messages")
            .select("*")
            .or(
                `and(sender_id.eq.${req.params.u1},receiver_id.eq.${req.params.u2}),` +
                `and(sender_id.eq.${req.params.u2},receiver_id.eq.${req.params.u1})`
            )
            .order("created_at");

        res.json({ messages: data || [] });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post("/sendMessage", async (req, res) => {
    try {
        const { sender_id, receiver_id, message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ message: "Message cannot be empty." });
        }

        await supabase.from("messages").insert([{ sender_id, receiver_id, message }]);
        res.json({ message: "Sent" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= AUTO COMPLETE RIDES (CRON) ================= */
cron.schedule("*/15 * * * *", async () => {
    console.log("⏰ Cron: checking for completed rides...");
    const now = new Date().toISOString();

    const { data: expiredRides } = await supabase
        .from("rides")
        .select("id")
        .eq("status", "active")
        .lt("ride_datetime", now);

    if (!expiredRides || !expiredRides.length) return;

    const ids = expiredRides.map(r => r.id);

    await supabase
        .from("rides")
        .update({ status: "completed" })
        .in("id", ids);

    console.log(`✅ Marked ${ids.length} rides as completed.`);
});

/* ================= START ================= */
app.listen(PORT, () => {
    console.log(`🚕 Rickmate server running on port ${PORT}`);
});