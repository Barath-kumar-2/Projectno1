const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'SQL_pwd2007',
    database: 'rickmate'
});

db.connect((err) => {
    if (err) {
        console.log("DB connection failed:", err);
    } else {
        console.log("Connected to MySQL");
    }
});

module.exports = db;