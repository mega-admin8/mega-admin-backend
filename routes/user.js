const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const auth = require('../middleware/auth');

// GET /api/user/passbook
// Fetches the logged-in user's transaction history
// router.get('/passbook', auth, async (req, res) => {
//   try {
//     // SECURITY: Ensure req.user.id comes from your JWT middleware!
//     const userId = req.user.id; 

//     const result = await pool.query(
//       "SELECT id, type, amount, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
//       [userId]
//     );

//     res.json(result.rows);
//   } catch (error) {
//     console.error('Player passbook error:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });


router.get('/passbook', auth, async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = 10; // Matches your itemsPerPage in frontend
  const offset = (page - 1) * limit;
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;

  try {
    let queryParams = [userId];
    let paramIndex = 2;

    let baseQuery = `FROM transactions WHERE user_id = $1`;

    // Apply Date Filters
    if (startDate && endDate) {
      baseQuery += ` AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') >= $${paramIndex} 
                     AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') <= $${paramIndex+1}`;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    }

    // Get Total Count
    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // Fetch actual data
    const ledgerQuery = `
      SELECT id, type, amount, created_at 
      ${baseQuery}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex+1}
    `;
    const paginatedParams = [...queryParams, limit, offset];
    const result = await pool.query(ledgerQuery, paginatedParams);

    res.json({
      data: result.rows,
      pagination: { currentPage: page, totalPages }
    });
  } catch (error) {
    console.error("Passbook Error:", error);
    res.status(500).json({ error: 'Failed to load passbook.' });
  }
});

module.exports = router;