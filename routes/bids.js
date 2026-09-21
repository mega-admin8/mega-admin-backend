const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

router.post('/place-bid', async (req, res) => {
    // We now expect an array of 'bids' and the 'game_type' from the frontend
    const { user_id, market_id, game_type, bids } = req.body;

    console.log("DEBUG: Incoming market_id:", market_id);

    if (!bids || !Array.isArray(bids) || bids.length === 0) {
        return res.status(400).json({ error: "Cart is empty or invalid" });
    }

    // SECURITY CRITICAL: Never trust the frontend's total amount. 
    // Always calculate the total cost on the backend so hackers can't cheat the price.
    const calculatedTotalAmount = bids.reduce((sum, bid) => sum + parseInt(bid.amount), 0);

    const client = await pool.connect(); 

    try {
        await client.query('BEGIN'); 

        // 1. Check if Market is Open
        const marketRes = await client.query(
            "SELECT * FROM markets WHERE id = $1 AND is_active = true",
            [market_id]
        );
        const market = marketRes.rows[0];
        
        if (!market) throw new Error("Market not found or inactive");

        // Force the time to IST
        const now = new Date().toLocaleTimeString('en-GB', { 
            hour12: false, 
            timeZone: 'Asia/Kolkata' 
        });

        // Safe Time Check (handles overnight markets)
        const isOpenMarket = market.close_time < market.open_time 
            ? (now >= market.open_time || now <= market.close_time) 
            : (now >= market.open_time && now <= market.close_time); 

        if (!isOpenMarket) {
            throw new Error("Market is currently closed for bidding");
        }

        // 2. Check and Deduct Balance (Using the securely calculated total)
        const userRes = await client.query(
            "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2 AND wallet_balance >= $1 RETURNING wallet_balance",
            [calculatedTotalAmount, user_id]
        );

        if (userRes.rows.length === 0) {
            throw new Error("Insufficient balance for this cart.");
        }

        const newBalance = userRes.rows[0].wallet_balance;

        // 3. Loop through the cart and record EVERY single bid detail
        for (const bid of bids) {
            // Inserts the market ID, game type (e.g., 'SINGLE_DIGIT'), session ('Open' or 'Close'), the number, and the amount.
            await client.query(
                "INSERT INTO bids (user_id, market_id, game_type, session, bid_number, amount) VALUES ($1, $2, $3, $4, $5, $6)",
                [user_id, market_id, game_type, bid.session, bid.number, bid.amount]
            );
        }

        // 4. Create Transaction Ledger (Passbook)
        // We log one single deduction for the whole cart so the passbook stays clean
        await client.query(
            "INSERT INTO transactions (user_id, type, amount) VALUES ($1, 'BID_PLACED', $2)",
            [user_id, calculatedTotalAmount]
        );

        await client.query('COMMIT'); 
        res.status(200).json({ 
            message: `Successfully placed ${bids.length} bids!`, 
            current_balance: newBalance 
        });

    } catch (err) {
        await client.query('ROLLBACK'); 
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET /api/bids/my-bids (COMBINED MATKA + GALI DESAWAR)
router.get('/my-bids', auth, async (req, res) => {
    const user_id = req.user.id;
    const { startDate, endDate, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    try {
        const endOfDay = `${endDate} 23:59:59`;

        // 1. Get total combined count (using SELECT 1 avoids ID type mismatches)
        const countQuery = `
            SELECT COUNT(*) FROM (
                SELECT 1 FROM bids b
                WHERE b.user_id = $1 AND b.placed_at >= $2 AND b.placed_at <= $3
                UNION ALL
                SELECT 1 FROM gali_desawar_bids gb
                WHERE gb.user_id = $1 AND gb.created_at >= $2 AND gb.created_at <= $3
            ) AS total_bids
        `;
        const countResult = await pool.query(countQuery, [user_id, startDate, endOfDay]);
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Fetch combined & paginated bids with explicit text casting for IDs and Strings
        const dataQuery = `
            SELECT 
                b.id::text AS id, 
                b.bid_number::text AS bid_number, 
                b.amount, 
                b.game_type::text AS game_type, 
                b.session::text AS session, 
                b.placed_at, 
                b.status::text AS status,
                m.name::text AS market_name
            FROM bids b
            JOIN markets m ON b.market_id = m.id
            WHERE b.user_id = $1 AND b.placed_at >= $2 AND b.placed_at <= $3

            UNION ALL

            SELECT 
                gb.id::text AS id, 
                gb.bid_number::text AS bid_number, 
                gb.amount, 
                gb.game_type::text AS game_type, 
                gb.session::text AS session, 
                gb.created_at AS placed_at, 
                gb.status::text AS status,
                gm.name::text AS market_name
            FROM gali_desawar_bids gb
            JOIN gali_desawar_markets gm ON gb.market_id = gm.id
            WHERE gb.user_id = $1 AND gb.created_at >= $2 AND gb.created_at <= $3

            ORDER BY placed_at DESC
            LIMIT $4 OFFSET $5
        `;
        const result = await pool.query(dataQuery, [user_id, startDate, endOfDay, limit, offset]);

        res.json({
            bids: result.rows,
            totalPages: totalPages === 0 ? 1 : totalPages,
            currentPage: parseInt(page)
        });

    } catch (err) {
        console.error("Error fetching combined bids:", err);
        res.status(500).json({ error: "Failed to load bid history" });
    }
});


router.get('/win-history', auth, async (req, res) => {
  const userId = req.user.id;
  
  // Extract filters from the frontend
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const offset = (page - 1) * limit;
  const startDate = req.query.startDate; 
  const endDate = req.query.endDate;

  try {
    let queryParams = [userId];
    let paramIndex = 2;
    
    // Now we just select the pre-calculated 'won_amount' directly!
    let baseQuery = `
      FROM bids b
      JOIN markets m ON b.market_id = m.id
      WHERE b.user_id = $1 AND b.status = 'WIN'
    `;

    // Apply Date Filters if they exist
    if (startDate && endDate) {
      baseQuery += ` AND DATE(b.placed_at AT TIME ZONE 'Asia/Kolkata') >= $${paramIndex} 
                     AND DATE(b.placed_at AT TIME ZONE 'Asia/Kolkata') <= $${paramIndex+1}`;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    }

    // Get Total Count for Pagination
    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // Get the Actual Data
    const dataQuery = `
      SELECT b.id, b.bid_number, b.amount, b.won_amount, b.game_type, b.session, b.placed_at, m.name AS market_name
      ${baseQuery}
      ORDER BY b.placed_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex+1}
    `;
    const paginatedParams = [...queryParams, limit, offset];
    
    const result = await pool.query(dataQuery, paginatedParams);

    res.json({
      data: result.rows,
      pagination: { currentPage: page, totalPages }
    });
  } catch (error) {
    console.error("Win History Error:", error);
    res.status(500).json({ error: 'Failed to fetch win history' });
  }
});

module.exports = router;