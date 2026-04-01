const express = require("express");
const cors = require("cors");
const supabase = require("./supabaseClient");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = 5000;

const CLIENT_ID = "1025485618680-2tthbngduvs4s60vbon7ilqvsrtdfr7n.apps.googleusercontent.com";
const client = new OAuth2Client(CLIENT_ID);

app.use(cors());
app.use(express.json());

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

        const totalMembers = 1 + team_members.length;
        const members_required = Math.max(0, 4 - totalMembers);

        const { data: ride, error } = await supabase
            .from("rides")
            .insert([{
                user_id,
                start_location: start,
                destination,
                ride_datetime: datetime,
                strictness: strictness || "medium",
                current_members: totalMembers,
                members_required
            }])
            .select()
            .single();

        if (error) throw error;

        const ride_id = ride.id;

        await supabase.from("ride_members")
            .insert([{ ride_id, user_id }]);

        for (let m of team_members) {

            let { data: user } = await supabase
                .from("users")
                .select("*")
                .or(`phone.eq.${m.phone},email.eq.${m.email}`)
                .maybeSingle();

            if (!user) {
                const { data } = await supabase
                    .from("users")
                    .insert([{
                        name: m.name,
                        phone: m.phone,
                        email: m.email
                    }])
                    .select()
                    .single();

                user = data;
            }

            await supabase.from("team_members")
                .insert([{ ride_id, name: m.name, phone: m.phone, email: m.email }]);

            await supabase.from("ride_members")
                .insert([{ ride_id, user_id: user.id }]);
        }

        res.json({ message: "Ride created" });

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

        const rides = data
            .map(r => r.rides)
            .filter(r => r.status === "active" && new Date(r.ride_datetime) >= new Date())
            .sort((a, b) => new Date(a.ride_datetime) - new Date(b.ride_datetime));

        res.json({ rides });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= CANCEL ================= */
app.post("/cancelRide", async (req, res) => {
    await supabase
        .from("rides")
        .update({ status: "cancelled" })
        .eq("id", req.body.ride_id);

    res.json({ message: "Ride cancelled" });
});

/* ================= HISTORY ================= */
app.get("/myRides/:user_id", async (req, res) => {
    const { data } = await supabase
        .from("ride_members")
        .select("rides(*)")
        .eq("user_id", req.params.user_id);

    const rides = data.map(r => r.rides).sort((a, b) => new Date(b.ride_datetime) - new Date(a.ride_datetime));

    res.json({ rides });
});

/* ================= SUGGESTIONS ================= */
app.get("/suggestions/:user_id", async (req, res) => {
    try {
        const user_id = Number(req.params.user_id);

        const { data: rides } = await supabase
            .from("rides")
            .select("*")
            .eq("status", "active");

        const final = [];

        for (let r1 of rides) {
            for (let r2 of rides) {
                if (r1.id >= r2.id) continue;
                if (r1.user_id === r2.user_id) continue;

                if (
                    r1.start_location === r2.start_location &&
                    r1.destination === r2.destination &&
                    new Date(r1.ride_datetime).toDateString() === new Date(r2.ride_datetime).toDateString()
                ) {

                    if (!(r1.user_id === user_id || r2.user_id === user_id)) continue;

                    const yourRide = r1.user_id === user_id ? r1 : r2;
                    const theirRide = r1.user_id === user_id ? r2 : r1;

                    const { data: your_members } = await supabase
                        .from("ride_members")
                        .select("users(id,name)")
                        .eq("ride_id", yourRide.id);

                    const { data: their_members } = await supabase
                        .from("ride_members")
                        .select("users(id,name)")
                        .eq("ride_id", theirRide.id);

                    const set = new Set([
                        ...your_members.map(m => m.users.id),
                        ...their_members.map(m => m.users.id)
                    ]);

                    if (set.size > 4) continue;

                    const { data: isFriend } = await supabase
                        .from("friends")
                        .select("*")
                        .or(`and(user1_id.eq.${user_id},user2_id.eq.${theirRide.user_id}),and(user1_id.eq.${theirRide.user_id},user2_id.eq.${user_id})`)
                        .maybeSingle();

                    let remark = "No Connections";
                    if (isFriend) remark = "Friends";

                    final.push({
                        start_location: yourRide.start_location,
                        destination: yourRide.destination,
                        ride_datetime: yourRide.ride_datetime,
                        matched_time: theirRide.ride_datetime,
                        your_members: your_members.map(m => m.users),
                        their_members: their_members.map(m => m.users),
                        total_members: set.size,
                        matched_user_id: theirRide.user_id,
                        remark,
                        match_percent: 80
                    });
                }
            }
        }

        res.json({ matches: final });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ================= INVITES ================= */
app.post("/sendInvite", async (req, res) => {
    const { error } = await supabase
        .from("invitations")
        .insert([{ sender_id: req.body.sender_id, receiver_id: req.body.receiver_id }]);

    if (error) return res.status(400).json({ message: "Already invited" });

    res.json({ message: "Invitation sent" });
});

app.get("/invites/:user_id", async (req, res) => {
    const { data } = await supabase
        .from("invitations")
        .select("id, users!invitations_sender_id_fkey(name)")
        .eq("receiver_id", req.params.user_id)
        .eq("status", "pending");

    const invites = data.map(i => ({ id: i.id, name: i.users.name }));

    res.json({ invites });
});

app.post("/acceptInvite", async (req, res) => {
    const { data: invite } = await supabase
        .from("invitations")
        .select("*")
        .eq("id", req.body.invite_id)
        .single();

    await supabase.from("friends")
        .insert([{ user1_id: invite.sender_id, user2_id: invite.receiver_id }]);

    await supabase.from("invitations")
        .update({ status: "accepted" })
        .eq("id", req.body.invite_id);

    res.json({ message: "Accepted" });
});

/* ================= FRIENDS ================= */
app.get("/friends/:user_id", async (req, res) => {
    const { data } = await supabase.from("friends").select("*");

    const friends = data
        .filter(f => f.user1_id == req.params.user_id || f.user2_id == req.params.user_id)
        .map(f => ({
            id: f.user1_id == req.params.user_id ? f.user2_id : f.user1_id
        }));

    res.json({ friends });
});

/* ================= CHAT ================= */
app.get("/messages/:u1/:u2", async (req, res) => {
    const { data } = await supabase
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${req.params.u1},receiver_id.eq.${req.params.u2}),and(sender_id.eq.${req.params.u2},receiver_id.eq.${req.params.u1})`)
        .order("created_at");

    res.json({ messages: data });
});

app.post("/sendMessage", async (req, res) => {
    await supabase
        .from("messages")
        .insert([req.body]);

    res.json({ message: "Sent" });
});

/* ================= START ================= */
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});