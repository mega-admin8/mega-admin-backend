const jwt = require("jsonwebtoken");
const pool = require("../db"); // Make sure to import your DB pool

module.exports = async function (req, res, next) {
  // Get token from header
  const token = req.header("x-auth-token") || req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token, authorization denied" });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // --- NEW: THE KILL SWITCH ---
    // Check if the user is suspended or deleted in the database
    const userCheck = await pool.query(
      "SELECT is_suspended, is_deleted FROM users WHERE id = $1", 
      [req.user.id]
    );

    if (userCheck.rows.length === 0 || userCheck.rows[0].is_deleted) {
      return res.status(401).json({ error: "User account no longer exists." });
    }

    if (userCheck.rows[0].is_suspended) {
      return res.status(403).json({ 
        error: "ACCOUNT_SUSPENDED", 
        message: "Your account has been suspended by the administrator." 
      });
    }
    // ----------------------------

    next();
  } catch (err) {
    res.status(401).json({ error: "Token is not valid" });
  }
};