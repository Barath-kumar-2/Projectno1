const express = require("express");
const cors = require("cors");
const supabase = require("./db");
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

        // Fix #4: Reject past rides on the server side too
        const rideTime = new Date(datetime);
        if (rideTime < new Date()) {
            return res.status(400).json({ message: "Cannot post a ride in the past." });
        }

        // Fix #9: Enforce max 4 members total
        if (team_members.length > 3) {
            return res.status(400).json({ message: "Max 4 members total (including you)." });
        }

        const totalMembers   = 1 + team_members.length;
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

        // Add ride owner to ride_members
        await supabase.from("ride_members")
            .insert([{ ride_id, user_id }]);

        for (let m of team_members) {
            let { data: existingUser } = await supabase
                .from("users")
                .select("*")
                .or(`phone.eq.${m.phone},email.eq.${m.email}`)
                .maybeSingle();

            if (!existingUser) {
                const { data } = await supabase
                    .from("users")
                    .insert([{ name: m.name, phone: m.phone, email: m.email }])
                    .select()
                    .single();

                existingUser = data;
            }

            await supabase.from("team_members")
                .insert([{ ride_id, name: m.name, phone: m.phone, email: m.email }]);

            // Avoid duplicate ride_member entries
            await supabase.from("ride_members")
                .upsert([{ ride_id, user_id: existingUser.id }], { onConflict: "ride_id,user_id" });
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
        const now = new Date().toISOString();

        const { data } = await supabase
            .from("ride_members")
            .select("rides(*)")
            .eq("user_id", req.params.user_id);

        const rides = data
            .map(r => r.rides)
            .filter(r => r && r.status === "active" && new Date(r.ride_datetime) >= new Date())
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

    const rides = data
        .map(r => r.rides)
        .filter(r => r)
        .sort((a, b) => new Date(b.ride_datetime) - new Date(a.ride_datetime));

    res.json({ rides });
});

/* ================= HELPER: Get all friend IDs for a user ================= */
async function getFriendIds(userId) {
    const { data } = await supabase
        .from("friends")
        .select("user1_id, user2_id")
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (!data) return new Set();

    return new Set(data.map(f => f.user1_id == userId ? f.user2_id : f.user1_id));
}

/* ================= SUGGESTIONS ================= */
/*
  Fix #1: Deduplicate — track seen pairs
  Fix #2: Mutual friends — check if they share a common friend
  Fix #5: Strictness matching
  Fix #6: Only future active rides
  Fix #7: match_percent = 0.30*start + 0.25*dest + 0.25*time_slot + 0.20*x
           x = 1 (friends), 0.5 (mutual friends), 0 (strangers)
*/
app.get("/suggestions/:user_id", async (req, res) => {
    try {
        const user_id = Number(req.params.user_id);
        const now = new Date();

        // Fetch only ACTIVE future rides
        const { data: rides } = await supabase
            .from("rides")
            .select("*")
            .eq("status", "active")
            .gte("ride_datetime", now.toISOString());

        if (!rides || !rides.length) return res.json({ matches: [] });

        // Get current user's friend IDs
        const myFriendIds = await getFriendIds(user_id);

        const final = [];
        const seenPairs = new Set(); // Fix #1: deduplicate

        for (let r1 of rides) {
            for (let r2 of rides) {
                if (r1.id === r2.id) continue;
                if (r1.user_id === r2.user_id) continue;

                // Exactly one of them must belong to user_id
                const r1IsMe = r1.user_id === user_id;
                const r2IsMe = r2.user_id === user_id;
                if (!r1IsMe && !r2IsMe) continue;

                const yourRide  = r1IsMe ? r1 : r2;
                const theirRide = r1IsMe ? r2 : r1;

                // Fix #1: skip if already matched this pair (yourRide ↔ theirRide)
                const pairKey = [yourRide.id, theirRide.id].sort().join("-");
                if (seenPairs.has(pairKey)) continue;

                // Must share same route
                if (yourRide.start_location !== theirRide.start_location) continue;
                if (yourRide.destination    !== theirRide.destination)    continue;

                // Must be same date
                const yourDate  = new Date(yourRide.ride_datetime);
                const theirDate = new Date(theirRide.ride_datetime);
                if (yourDate.toDateString() !== theirDate.toDateString()) continue;

                // ---- Fix #5: Strictness time matching ----
                const hourDiff = Math.abs(yourDate.getHours() - theirDate.getHours());

                const yourStrictness  = yourRide.strictness;
                const theirStrictness = theirRide.strictness;

                // We use the STRICTER of the two ride's strictness to determine if they match
                let timeMatch = false;
                let timeScore = 0;

                if (yourStrictness === "low" || theirStrictness === "low") {
                    // At least one is low → same day is enough
                    timeMatch = true;
                    timeScore = 0.5; // partial time score
                } else if (yourStrictness === "medium" || theirStrictness === "medium") {
                    // Medium → within 1 hour
                    if (hourDiff <= 1) { timeMatch = true; timeScore = hourDiff === 0 ? 1.0 : 0.7; }
                } else {
                    // Both high → exact same hour
                    if (hourDiff === 0) { timeMatch = true; timeScore = 1.0; }
                }

                if (!timeMatch) continue;

                // Get members of each ride
                const { data: yourMembersRaw } = await supabase
                    .from("ride_members")
                    .select("users(id,name)")
                    .eq("ride_id", yourRide.id);

                const { data: theirMembersRaw } = await supabase
                    .from("ride_members")
                    .select("users(id,name)")
                    .eq("ride_id", theirRide.id);

                const yourMembers  = (yourMembersRaw  || []).map(m => m.users).filter(Boolean);
                const theirMembers = (theirMembersRaw || []).map(m => m.users).filter(Boolean);

                // Fix #9: Skip if combining would exceed 4 members
                const allIds = new Set([
                    ...yourMembers.map(m => m.id),
                    ...theirMembers.map(m => m.id)
                ]);
                if (allIds.size > 4) continue;

                const theirUserId = theirRide.user_id;

                // Relationship score (x)
                const isFriend = myFriendIds.has(theirUserId);

                // Fix #2: Mutual friends — do they share a common friend?
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

                // Fix #7: match_percent = 0.30*start + 0.25*dest + 0.25*time_slot + 0.20*x
                // start and dest always match (since we filtered for that), so they score 1.0
                const matchScore =
                    0.30 * 1.0 +       // start location matched
                    0.25 * 1.0 +       // destination matched
                    0.25 * timeScore + // time slot match quality
                    0.20 * x;          // relationship

                const match_percent = Math.round(matchScore * 100);

                // Fetch their name
                const { data: theirUser } = await supabase
                    .from("users")
                    .select("name")
                    .eq("id", theirUserId)
                    .maybeSingle();

                seenPairs.add(pairKey);

                final.push({
                    start_location:    yourRide.start_location,
                    destination:       yourRide.destination,
                    ride_datetime:     yourRide.ride_datetime,
                    matched_time:      theirRide.ride_datetime,
                    your_members:      yourMembers,
                    their_members:     theirMembers,
                    total_members:     allIds.size,
                    matched_user_id:   theirUserId,
                    matched_user_name: theirUser ? theirUser.name : "Unknown",
                    remark,
                    match_percent
                });
            }
        }

        // Sort by match_percent descending
        final.sort((a, b) => b.match_percent - a.match_percent);

        res.json({ matches: final });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

/* ================= INVITES ================= */
app.post("/sendInvite", async (req, res) => {
    const { error } = await supabase
        .from("invitations")
        .insert([{ sender_id: req.body.sender_id, receiver_id: req.body.receiver_id }]);

    if (error) return res.status(400).json({ message: "Invite already sent or error occurred." });

    res.json({ message: "Invitation sent!" });
});

app.get("/invites/:user_id", async (req, res) => {
    const { data } = await supabase
        .from("invitations")
        .select("id, users!invitations_sender_id_fkey(name)")
        .eq("receiver_id", req.params.user_id)
        .eq("status", "pending");

    const invites = (data || []).map(i => ({ id: i.id, name: i.users ? i.users.name : "Unknown" }));

    res.json({ invites });
});

app.post("/acceptInvite", async (req, res) => {
    const { data: invite, error } = await supabase
        .from("invitations")
        .select("*")
        .eq("id", req.body.invite_id)
        .single();

    if (error || !invite) return res.status(404).json({ message: "Invite not found" });

    // Avoid duplicate friendship entries
    await supabase.from("friends")
        .upsert([{ user1_id: invite.sender_id, user2_id: invite.receiver_id }], {
            onConflict: "user1_id,user2_id"
        });

    await supabase.from("invitations")
        .update({ status: "accepted" })
        .eq("id", req.body.invite_id);

    res.json({ message: "Friend added!" });
});

/* ================= FRIENDS ================= */
// Fix #3: Join users table to return name with friend list
app.get("/friends/:user_id", async (req, res) => {
    const uid = Number(req.params.user_id);

    const { data } = await supabase
        .from("friends")
        .select("user1_id, user2_id")
        .or(`user1_id.eq.${uid},user2_id.eq.${uid}`);

    if (!data || !data.length) return res.json({ friends: [] });

    const friendIds = data.map(f => f.user1_id === uid ? f.user2_id : f.user1_id);

    // Fetch user details for each friend
    const { data: users } = await supabase
        .from("users")
        .select("id, name, email, phone")
        .in("id", friendIds);

    res.json({ friends: users || [] });
});

/* ================= CHAT ================= */
app.get("/messages/:u1/:u2", async (req, res) => {
    const { data } = await supabase
        .from("messages")
        .select("*")
        .or(
            `and(sender_id.eq.${req.params.u1},receiver_id.eq.${req.params.u2}),` +
            `and(sender_id.eq.${req.params.u2},receiver_id.eq.${req.params.u1})`
        )
        .order("created_at");

    res.json({ messages: data || [] });
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
