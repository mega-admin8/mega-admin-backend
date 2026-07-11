const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const auth = require('../middleware/auth');

// 1. REGISTER: Create user with Phone and M-PIN
router.post("/register", async (req, res) => {
  const { full_name, phone_number, mpin } = req.body;

  if (!full_name || !phone_number || !mpin) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Check if user already exists
    const userExist = await pool.query(
      "SELECT * FROM users WHERE phone_number = $1",
      [phone_number],
    );
    if (userExist.rows.length > 0) {
      return res.status(400).json({ error: "Phone number already registered" });
    }

    // Hash the M-PIN for security
    const salt = await bcrypt.genSalt(10);
    const mpinHash = await bcrypt.hash(mpin, salt);

    // Insert new user
    const newUser = await pool.query(
      "INSERT INTO users (full_name, phone_number, mpin_hash) VALUES ($1, $2, $3) RETURNING id, full_name phone_number, wallet_balance",
      [full_name, phone_number, mpinHash],
    );

    res.status(201).json({
      message: "User registered successfully!",
      user: newUser.rows[0],
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// 2. LOGIN: Verify Phone and M-PIN
router.post("/login", async (req, res) => {
  const { phone_number, mpin } = req.body;

  if (!phone_number || !mpin) {
    return res
      .status(400)
      .json({ error: "Phone number and M-PIN are required" });
  }

  try {
    const user = await pool.query(
      "SELECT * FROM users WHERE phone_number = $1",
      [phone_number],
    );
    if (user.rows.length === 0) {
      return res.status(400).json({ error: "Invalid Credentials" });
    }

    if (user.rows[0].is_deleted) {
      return res.status(401).json({ error: "Account not found." });
    }

    if (user.rows[0].is_suspended) {
      return res.status(403).json({ 
        error: "Your account has been suspended by the administrator. Please contact support." 
      });
    }

    // Compare entered M-PIN with Hashed M-PIN
    const isMatch = await bcrypt.compare(mpin, user.rows[0].mpin_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid M-PIN" });
    }

    // Generate JWT Token
    const token = jwt.sign({ id: user.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({
      token,
      user: {
        id: user.rows[0].id,
        full_name: user.rows[0].full_name,
        phone_number: user.rows[0].phone_number,
        balance: user.rows[0].wallet_balance,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// --- 1. Route to Update Name Only ---
router.put("/update-name", async (req, res) => {
  const { phone_number, full_name } = req.body;

  if (!full_name)
    return res.status(400).json({ error: "Name cannot be empty" });

  try {
    await pool.query(
      "UPDATE users SET full_name = $1 WHERE phone_number = $2",
      [full_name, phone_number],
    );
    res.json({ message: "Name updated successfully!" });
  } catch (err) {
    console.error("🔥 Name Update Error:", err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

// --- 2. Route to Change M-PIN Only ---
router.put("/change-mpin", async (req, res) => {
  const { phone_number, old_mpin, new_mpin } = req.body;

  if (!old_mpin || !new_mpin)
    return res
      .status(400)
      .json({ error: "Both Old and New M-PIN are required" });

  try {
    // Fetch the user's current hashed MPIN
    const user = await pool.query(
      "SELECT mpin_hash FROM users WHERE phone_number = $1",
      [phone_number],
    );

    // Verify old MPIN is correct
    const validPassword = await bcrypt.compare(
      old_mpin,
      user.rows[0].mpin_hash,
    );
    if (!validPassword) {
      return res.status(400).json({ error: "Incorrect Old M-PIN" });
    }

    // Hash the new MPIN and save it
    const salt = await bcrypt.genSalt(10);
    const hashedMpin = await bcrypt.hash(new_mpin, salt);

    await pool.query(
      "UPDATE users SET mpin_hash = $1 WHERE phone_number = $2",
      [hashedMpin, phone_number],
    );

    res.json({ message: "M-PIN changed successfully!" });
  } catch (err) {
    console.error("🔥 MPIN Change Error:", err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

// Backend: routes/auth.js (or similar)
router.get('/me', auth, async (req, res) => {
  try {
    // Assume you have middleware that extracts user ID from the JWT token into req.user
    const result = await pool.query('SELECT id, full_name, wallet_balance FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;
