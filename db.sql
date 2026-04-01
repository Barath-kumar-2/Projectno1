-- ================= DATABASE =================
CREATE DATABASE IF NOT EXISTS rickmate;
USE rickmate;

-- ================= USERS =================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE,

    -- 🔥 Google Auth support
    google_id VARCHAR(255) UNIQUE,

    -- 🔥 Optional now (Google doesn't provide phone)
    phone VARCHAR(15) UNIQUE NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================= RIDES =================
CREATE TABLE IF NOT EXISTS rides (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NOT NULL,

    start_location VARCHAR(100) NOT NULL,
    destination VARCHAR(100) NOT NULL,
    ride_datetime DATETIME NOT NULL,

    strictness ENUM('low','medium','high') DEFAULT 'medium',
    status ENUM('active','completed','cancelled') DEFAULT 'active',

    -- 🚀 CORE LOGIC
    current_members INT DEFAULT 1,
    members_required INT DEFAULT 3,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 🚨 CONSTRAINTS
    CONSTRAINT chk_max_members CHECK (current_members <= 4),
    CONSTRAINT chk_min_members CHECK (current_members >= 1),
    CONSTRAINT chk_required_members CHECK (members_required BETWEEN 0 AND 3),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= RIDE MEMBERS =================
CREATE TABLE IF NOT EXISTS ride_members (
    id INT AUTO_INCREMENT PRIMARY KEY,

    ride_id INT NOT NULL,
    user_id INT NOT NULL,

    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_member (ride_id, user_id),

    FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= TEAM MEMBERS =================
CREATE TABLE IF NOT EXISTS team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,

    ride_id INT NOT NULL,

    name VARCHAR(50),
    phone VARCHAR(15),
    email VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);

-- ================= INDEX FOR MATCHING =================
CREATE INDEX idx_rides_match 
ON rides (start_location, destination, ride_datetime);

-- ================= INVITATIONS =================
CREATE TABLE IF NOT EXISTS invitations (
    id INT AUTO_INCREMENT PRIMARY KEY,

    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,

    status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_invite (sender_id, receiver_id),

    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= FRIENDS =================
CREATE TABLE IF NOT EXISTS friends (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user1_id INT NOT NULL,
    user2_id INT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_friend (user1_id, user2_id),

    FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= MESSAGES =================
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,

    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,

    message TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= RATINGS =================
CREATE TABLE IF NOT EXISTS ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,

    ride_id INT NOT NULL,

    reviewer_id INT NOT NULL,
    reviewee_id INT NOT NULL,

    rating INT CHECK (rating BETWEEN 1 AND 5),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_rating (ride_id, reviewer_id, reviewee_id),

    FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewee_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= DEBUG =================
SELECT * FROM users;
SELECT * FROM rides;
SELECT * FROM ride_members;
SELECT * FROM team_members;
SELECT * FROM invitations;
SELECT * FROM friends;
SELECT * FROM messages;
SELECT * FROM ratings;

SHOW TABLES;
