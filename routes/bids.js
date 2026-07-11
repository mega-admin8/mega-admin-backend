const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// router.post('/place-bid', async (req, res) => {
//     const { user_id, market_id, bid_number, amount } = req.body;

//     const client = await pool.connect(); // Use a single client for the transaction

//     try {
//         await client.query('BEGIN'); // Start Transaction

//         const user = await client.query("SELECT * FROM users WHERE id = $1", [user_id]);
//         if (user.rows.length === 0) {
//             throw new Error("User not found");
//         }

//         // 1. Check if Market is Open
//         const marketRes = await client.query(
//             "SELECT * FROM markets WHERE id = $1 AND is_active = true",
//             [market_id]
//         );
//         const market = marketRes.rows[0];
        
//         if (!market) throw new Error("Market not found or inactive");

//         // Simple Time Check logic (You can refine this based on your timezone)
//         // const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
//         // Force the time to IST regardless of where the cloud server is physically located
//         const now = new Date().toLocaleTimeString('en-GB', { 
//             hour12: false, 
//             timeZone: 'Asia/Kolkata' 
//         });
//         // if (now < market.open_time || now > market.close_time) {
//         //     throw new Error("Market is currently closed for bidding");
//         // }

//         // Safe Time Check (handles overnight markets)
//         const isOpenMarket = market.close_time < market.open_time 
//             ? (now >= market.open_time || now <= market.close_time) // Overnight logic
//             : (now >= market.open_time && now <= market.close_time); // Standard logic

//         if (!isOpenMarket) {
//             throw new Error("Market is currently closed for bidding");
//         }

//         // 2. Check and Deduct Balance
//         const userRes = await client.query(
//             "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2 AND wallet_balance >= $1 RETURNING wallet_balance",
//             [amount, user_id]
//         );

//         if (userRes.rows.length === 0) {
//             throw new Error("Insufficient balance");
//         }

//         const newBalance = userRes.rows[0].wallet_balance;

//         // 3. Record the Bid
//         await client.query(
//             "INSERT INTO bids (user_id, market_id, bid_number, amount) VALUES ($1, $2, $3, $4)",
//             [user_id, market_id, bid_number, amount]
//         );

//         // 4. Create Transaction Ledger (Passbook)
//         await client.query(
//             "INSERT INTO transactions (user_id, type, amount) VALUES ($1, 'DEBIT', $2)",
//             [user_id, amount]
//         );

//         await client.query('COMMIT'); // Save all changes
//         res.status(200).json({ message: "Bid placed successfully!", current_balance: newBalance });

//     } catch (err) {
//         await client.query('ROLLBACK'); // Undo everything if any step fails
//         res.status(400).json({ error: err.message });
//     } finally {
//         client.release();
//     }
// });

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

// GET /api/bids/my-bids
router.get('/my-bids', auth, async (req, res) => {
    const user_id = req.user.id;
    const { startDate, endDate, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    try {
        // We append ' 23:59:59' to the end date to include the entire last day
        const endOfDay = `${endDate} 23:59:59`;

        // 1. Get the total count for pagination math
        const countQuery = `
            SELECT COUNT(*) 
            FROM bids 
            WHERE user_id = $1 AND placed_at >= $2 AND placed_at <= $3
        `;
        const countResult = await pool.query(countQuery, [user_id, startDate, endOfDay]);
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Get the actual filtered data
        const dataQuery = `
            SELECT 
                b.id, b.bid_number, b.amount, b.game_type, b.session, b.placed_at, b.status,
                m.name AS market_name
            FROM bids b
            JOIN markets m ON b.market_id = m.id
            WHERE b.user_id = $1 AND b.placed_at >= $2 AND b.placed_at <= $3
            ORDER BY b.placed_at DESC
            LIMIT $4 OFFSET $5
        `;
        const result = await pool.query(dataQuery, [user_id, startDate, endOfDay, limit, offset]);
        
        res.json({
            bids: result.rows,
            totalPages: totalPages === 0 ? 1 : totalPages,
            currentPage: parseInt(page)
        });

    } catch (err) {
        console.error("Error fetching bids:", err);
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