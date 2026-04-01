const express = require("express");
const cors = require("cors");
const db = require("./db");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = 5000;

const CLIENT_ID = "1025485618680-2tthbngduvs4s60vbon7ilqvsrtdfr7n.apps.googleusercontent.com";
const client = new OAuth2Client(CLIENT_ID);

app.use(cors({ origin: "http://127.0.0.1:5500" }));
app.use(express.json());

/* ================= DB HELPERS ================= */
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

function queryOne(sql, params = []) {
    return query(sql, params).then(res => res[0]);
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

        let user = await queryOne(
            "SELECT * FROM users WHERE google_id=?",
            [google_id]
        );

        if (!user) {
            const r = await query(
                "INSERT INTO users (name, email, google_id) VALUES (?, ?, ?)",
                [name, email, google_id]
            );

            user = { id: r.insertId, name, email, phone: null };
        }

        res.json({ user });

    } catch (err) {
        console.error("TOKEN ERROR:", err);
        res.status(401).json({ message: err.message });
    }
});

/* ================= UPDATE PHONE ================= */
app.post("/updatePhone", async (req, res) => {
    const { user_id, phone } = req.body;

    try {
        await query(
            "UPDATE users SET phone=? WHERE id=?",
            [phone, user_id]
        );
        res.json({ message: "Phone updated" });
    } catch {
        res.status(500).json({ message: "Error updating phone" });
    }
});

/* ================= ADD RIDE ================= */
app.post("/addRide", async (req, res) => {
    try {
        let { user_id, start, destination, datetime, strictness, team_members } = req.body;

        // 🔥 FIX: ensure MySQL format
        datetime = datetime.replace("T", " ");

        const totalMembers = 1 + (team_members?.length || 0);
        const members_required = Math.max(0, 4 - totalMembers);

        const result = await query(`
            INSERT INTO rides 
            (user_id, start_location, destination, ride_datetime, strictness, current_members, members_required)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [user_id, start, destination, datetime, strictness || "medium", totalMembers, members_required]);

        const ride_id = result.insertId;

        // creator
        await query(
            "INSERT INTO ride_members (ride_id, user_id) VALUES (?, ?)",
            [ride_id, user_id]
        );

        // team members
        for (let m of team_members || []) {
            let user = await queryOne(
                "SELECT * FROM users WHERE phone=? OR email=?",
                [m.phone, m.email]
            );

            if (!user) {
                const r = await query(
                    "INSERT INTO users (name, phone, email) VALUES (?, ?, ?)",
                    [m.name, m.phone, m.email]
                );
                user = { id: r.insertId };
            }

            await query(
                "INSERT INTO team_members (ride_id, name, phone, email) VALUES (?, ?, ?, ?)",
                [ride_id, m.name, m.phone, m.email]
            );

            await query(
                "INSERT IGNORE INTO ride_members (ride_id, user_id) VALUES (?, ?)",
                [ride_id, user.id]
            );
        }

        res.json({ message: "Ride created" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

/* ================= CURRENT RIDES ================= */
app.get("/currentRides/:user_id", async (req, res) => {
    const user_id = req.params.user_id;

    const rides = await query(`
        SELECT DISTINCT r.*
        FROM rides r
        JOIN ride_members rm ON r.id = rm.ride_id
        WHERE rm.user_id = ?
        AND r.status = 'active'
        AND r.ride_datetime >= NOW()
        ORDER BY r.ride_datetime ASC
    `, [user_id]);

    res.json({ rides });
});

/* ================= CANCEL RIDE ================= */
app.post("/cancelRide", async (req, res) => {
    const { ride_id } = req.body;

    await query(
        "UPDATE rides SET status='cancelled' WHERE id=?",
        [ride_id]
    );

    res.json({ message: "Ride cancelled" });
});

/* ================= HISTORY ================= */
app.get("/myRides/:user_id", async (req, res) => {
    const user_id = req.params.user_id;

    const rides = await query(`
        SELECT DISTINCT r.*
        FROM rides r
        JOIN ride_members rm ON r.id = rm.ride_id
        WHERE rm.user_id = ?
        AND (
            r.status IN ('completed', 'cancelled')
            OR r.ride_datetime < NOW()
        )
        ORDER BY r.ride_datetime DESC
    `, [user_id]);

    res.json({ rides });
});

/* ================= SUGGESTIONS ================= */
app.get("/suggestions/:user_id", async (req, res) => {
    try {
        const user_id = req.params.user_id;

        const results = await query(`
            SELECT 
                r1.id AS ride1_id,
                r2.id AS ride2_id,
                r1.user_id AS user1,
                r2.user_id AS user2,
                r1.start_location,
                r1.destination,
                r1.ride_datetime AS time1,
                r2.ride_datetime AS time2
            FROM rides r1
            JOIN rides r2
                ON r1.start_location = r2.start_location
                AND r1.destination = r2.destination
                AND r1.id < r2.id
            WHERE DATE(r1.ride_datetime) = DATE(r2.ride_datetime)
                AND (r1.user_id = ? OR r2.user_id = ?)
                AND r1.user_id != r2.user_id
                AND r1.status = 'active'
                AND r2.status = 'active'
                AND r1.ride_datetime >= NOW()
                AND r2.ride_datetime >= NOW()
        `, [user_id, user_id]);

        const final = [];

        for (let r of results) {
            const yourRideId = r.user1 == user_id ? r.ride1_id : r.ride2_id;
            const otherRideId = r.user1 == user_id ? r.ride2_id : r.ride1_id;
            const matched_user_id = r.user1 == user_id ? r.user2 : r.user1;

            const your_members = await query(`
                SELECT u.id, u.name
                FROM ride_members rm
                JOIN users u ON rm.user_id = u.id
                WHERE rm.ride_id = ?
            `, [yourRideId]);

            const their_members = await query(`
                SELECT u.id, u.name
                FROM ride_members rm
                JOIN users u ON rm.user_id = u.id
                WHERE rm.ride_id = ?
            `, [otherRideId]);

            const unique = new Set();
            your_members.forEach(m => unique.add(m.id));
            their_members.forEach(m => unique.add(m.id));

            if (unique.size <= 4) {
                // 🔥 check if already friends
                const isFriend = await queryOne(`
                    SELECT * FROM friends
                    WHERE (user1_id=? AND user2_id=?)
                    OR (user1_id=? AND user2_id=?)
                `, [user_id, matched_user_id, matched_user_id, user_id]);

                // 🔥 mutual friends count
                const mutual = await query(`
                    SELECT COUNT(*) as count
                    FROM friends f1
                    JOIN friends f2
                    ON f1.user2_id = f2.user2_id
                    WHERE f1.user1_id = ?
                    AND f2.user1_id = ?
                `, [user_id, matched_user_id]);

                let remark = "No Connections";

                if (isFriend) {
                    remark = "Friends";
                } else if (mutual[0].count > 0) {
                    remark = "Mutual Friends";
                }
                // ================= MATCH SCORE =================

                // 1. Start & Destination (already same due to SQL, but keep safe)
                const startScore = 1;
                const stopScore = 1;

                // 2. Date (already same due to SQL)
                const dateScore = 1;

                // 3. Time difference (in hours)
                const t1 = new Date(r.time1);
                const t2 = new Date(r.time2);

                const diffHours = Math.abs(t1 - t2) / (1000 * 60 * 60);

                let timeScore = 0;
                if (diffHours <= 1) timeScore = 1;
                else if (diffHours <= 2) timeScore = 0.7;
                else if (diffHours <= 3) timeScore = 0.4;
                else timeScore = 0;

                // 4. Connection score
                let x = 0;
                if (isFriend) x = 1;
                else if (mutual[0].count > 0) x = 0.5;
                else x = 0;

                // 5. Final Match %
                const match =
                    0.25 * startScore +
                    0.20 * stopScore +
                    0.25 * dateScore +
                    0.15 * timeScore +
                    0.15 * x;

                // convert to %
                const matchPercent = Math.round(match * 100);
                final.push({
                    start_location: r.start_location,
                    destination: r.destination,
                    ride_datetime: r.time1,
                    matched_time: r.time2,
                    your_members,
                    their_members,
                    total_members: unique.size,
                    matched_user_id,
                    remark, 
                    match_percent: matchPercent
                });
                final.sort((a, b) => b.match_percent - a.match_percent);
            }
        }

        res.json({ matches: final });

    } catch (err) {
        res.status(500).json({ message: "Error" });
    }
});

/* ================= INVITES ================= */
app.post("/sendInvite", (req, res) => {
    const { sender_id, receiver_id } = req.body;

    db.query(
        "INSERT INTO invitations (sender_id, receiver_id) VALUES (?, ?)",
        [sender_id, receiver_id],
        (err) => {
            if (err) return res.json({ message: "Already invited" });
            res.json({ message: "Invitation sent" });
        }
    );
});

app.get("/invites/:user_id", (req, res) => {
    const user_id = req.params.user_id;

    db.query(`
        SELECT i.id, u.name
        FROM invitations i
        JOIN users u ON i.sender_id = u.id
        WHERE i.receiver_id = ? AND i.status='pending'
    `, [user_id], (err, result) => {
        res.json({ invites: result });
    });
});

app.post("/acceptInvite", async (req, res) => {
    const { invite_id } = req.body;

    const invite = await queryOne(
        "SELECT * FROM invitations WHERE id=?",
        [invite_id]
    );

    await query(
        "INSERT IGNORE INTO friends (user1_id, user2_id) VALUES (?, ?)",
        [invite.sender_id, invite.receiver_id]
    );

    await query(
        "UPDATE invitations SET status='accepted' WHERE id=?",
        [invite_id]
    );

    res.json({ message: "Accepted" });
});

/* ================= FRIENDS ================= */
app.get("/friends/:user_id", (req, res) => {
    const user_id = req.params.user_id;

    db.query(`
        SELECT u.id, u.name
        FROM friends f
        JOIN users u 
        ON (u.id = f.user1_id AND f.user2_id = ?)
        OR (u.id = f.user2_id AND f.user1_id = ?)
    `, [user_id, user_id], (err, result) => {
        res.json({ friends: result });
    });
});

/* ================= CHAT ================= */
app.get("/messages/:u1/:u2", (req, res) => {
    const { u1, u2 } = req.params;

    db.query(`
        SELECT * FROM messages
        WHERE (sender_id=? AND receiver_id=?)
        OR (sender_id=? AND receiver_id=?)
        ORDER BY created_at
    `, [u1, u2, u2, u1], (err, result) => {
        res.json({ messages: result });
    });
});

app.post("/sendMessage", (req, res) => {
    const { sender_id, receiver_id, message } = req.body;

    db.query(
        "INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)",
        [sender_id, receiver_id, message],
        () => res.json({ message: "Sent" })
    );
});

/* ================= START ================= */
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
}); 