const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importing your pg Pool connection
const auth = require('../middleware/auth'); // Assuming you have an auth middleware

// ==========================================
// 1. USER BID PLACEMENT (WITH TRANSACTION)
// ==========================================

// /**
//  * @route   POST /api/bids/place-bid
//  * @desc    Place single or bulk Gali Desawar bids with safe wallet deduction
//  */
// router.post('/bids/place-bid', async (req, res) => {
//   const { user_id, market_id, game_type, bids } = req.body;

//   if (!user_id || !market_id || !Array.isArray(bids) || bids.length === 0) {
//     return res.status(400).json({ error: 'Missing required bid parameters.' });
//   }

//   // Calculate total required amount
//   const totalAmount = bids.reduce((sum, bid) => sum + Number(bid.amount || 0), 0);
//   if (totalAmount <= 0) {
//     return res.status(400).json({ error: 'Invalid total bid amount.' });
//   }

//   // Acquire a dedicated client from the pool for PostgreSQL transaction
//   const client = await pool.connect();

//   try {
//     // Start Transaction
//     await client.query('BEGIN');

//     // 1. Check Market Status
//     const marketResult = await client.query(
//       'SELECT id, name, status FROM gali_desawar_markets WHERE id = $1',
//       [market_id]
//     );

//     if (marketResult.rows.length === 0) {
//       await client.query('ROLLBACK');
//       return res.status(404).json({ error: 'Market not found.' });
//     }

//     if (marketResult.rows[0].status === 'PAUSED') {
//       await client.query('ROLLBACK');
//       return res.status(400).json({ error: 'Betting is currently paused for this market.' });
//     }

//     // 2. Check User Wallet Balance with Row Locking (FOR UPDATE prevents double-spending)
//     const userResult = await client.query(
//       'SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE',
//       [user_id]
//     );

//     if (userResult.rows.length === 0) {
//       await client.query('ROLLBACK');
//       return res.status(404).json({ error: 'User not found.' });
//     }

//     const currentBalance = Number(userResult.rows[0].wallet_balance);
//     if (currentBalance < totalAmount) {
//       await client.query('ROLLBACK');
//       return res.status(400).json({ error: 'Insufficient wallet balance.' });
//     }

//     // 3. Deduct Wallet Balance
//     await client.query(
//       'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
//       [totalAmount, user_id]
//     );

//     // 4. Insert Bids
//     const insertedBids = [];
//     for (const bid of bids) {
//       const bidInsertResult = await client.query(
//         `INSERT INTO bids (user_id, market_id, game_type, bid_number, amount, session, status) 
//          VALUES ($1, $2, $3, $4, $5, $6, 'PENDING') 
//          RETURNING *`,
//         [
//           user_id,
//           market_id,
//           bid.game_type || game_type || 'GALI_DESAWAR',
//           String(bid.number),
//           Number(bid.amount),
//           bid.session || 'Open'
//         ]
//       );
//       insertedBids.push(bidInsertResult.rows[0]);
//     }

//     // Commit Transaction
//     await client.query('COMMIT');

//     return res.status(201).json({
//       success: true,
//       message: 'Bids placed successfully.',
//       total_amount: totalAmount,
//       bids_placed: insertedBids.length
//     });

//   } catch (error) {
//     // Rollback any changes on error
//     await client.query('ROLLBACK');
//     console.error('[Place Bid Transaction Error]:', error);
//     return res.status(500).json({ error: 'Server error while processing bid.' });
//   } finally {
//     // Always release client back to pool
//     client.release();
//   }
// });


// ==========================================
// 1. USER BID PLACEMENT (WITH TRANSACTION)
// ==========================================

// /**
//  * @route   POST /api/gali-desawar/place-bid
//  * @desc    Place single or bulk Gali Desawar bids with safe wallet deduction
//  */
// // FIX 1 & 2: Changed path to '/place-bid' and added 'auth' middleware
// router.post('/place-bid', auth, async (req, res) => {
//   const { market_id, game_type, bids } = req.body;
  
//   // FIX 2: Get user_id securely from the auth middleware, not the body
//   const user_id = req.user.id; 

//   if (!user_id || !market_id || !Array.isArray(bids) || bids.length === 0) {
//     return res.status(400).json({ error: 'Missing required bid parameters.' });
//   }

//   // Calculate total required amount
//   const totalAmount = bids.reduce((sum, bid) => sum + Number(bid.amount || 0), 0);
//   if (totalAmount <= 0) {
//     return res.status(400).json({ error: 'Invalid total bid amount.' });
//   }

//   // Acquire a dedicated client from the pool for PostgreSQL transaction
//   const client = await pool.connect();

//   try {
//     // Start Transaction
//     await client.query('BEGIN');

//     console.log("Checking Market ID in DB:", market_id);

//     // 1. Check Market Status
//     const marketResult = await client.query(
//       'SELECT id, name, status, is_active FROM gali_desawar_markets WHERE id = $1',
//       [market_id]
//     );

//     if (marketResult.rows.length === 0 || marketResult.rows[0].is_active === false) {
//       await client.query('ROLLBACK');
//       return res.status(404).json({ error: 'Market not found or inactive.' });
//     }

//     if (marketResult.rows[0].status === 'PAUSED') {
//       await client.query('ROLLBACK');
//       return res.status(400).json({ error: 'Betting is currently paused for this market.' });
//     }

//     console.log("Checking User Balance for user_id:", user_id);

//     // 2. Check User Wallet Balance with Row Locking (FOR UPDATE prevents double-spending)
//     const userResult = await client.query(
//       'SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE',
//       [user_id]
//     );

//     if (userResult.rows.length === 0) {
//       await client.query('ROLLBACK');
//       return res.status(404).json({ error: 'User not found.' });
//     }

//     const currentBalance = Number(userResult.rows[0].wallet_balance);
//     if (currentBalance < totalAmount) {
//       await client.query('ROLLBACK');
//       return res.status(400).json({ error: 'Insufficient wallet balance.' });
//     }

//     // 3. Deduct Wallet Balance
//     await client.query(
//       'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
//       [totalAmount, user_id]
//     );

//     // 4. Insert Bids

//     console.log("Inserting Bids into gali_desawar_bids...");

//     const insertedBids = [];
//     for (const bid of bids) {
//       // FIX 3: Changed table name to 'gali_desawar_bids'
//       const bidInsertResult = await client.query(
//         `INSERT INTO gali_desawar_bids (user_id, market_id, game_type, bid_number, amount, session, status) 
//          VALUES ($1, $2, $3, $4, $5, $6, 'PENDING') 
//          RETURNING *`,
//         [
//           user_id,
//           market_id,
//           bid.game_type || game_type || 'GALI_DESAWAR',
//           String(bid.bid_number), // Ensures we extract bid_number correctly from frontend array
//           Number(bid.amount),
//           bid.session || 'Open'
//         ]
//       );
//       insertedBids.push(bidInsertResult.rows[0]);
//     }

//     // Commit Transaction
//     await client.query('COMMIT');

//     return res.status(201).json({
//       success: true,
//       message: 'Bids placed successfully.',
//       total_amount: totalAmount,
//       bids_placed: insertedBids.length
//     });

//   } catch (error) {
//     // Rollback any changes on error
//     await client.query('ROLLBACK');
//     console.error('[Place Bid Transaction Error]:', error);
//     return res.status(500).json({ error: 'Server error while processing bid.' });
//   } finally {
//     // Always release client back to pool
//     client.release();
//   }
// });



// ==========================================
// 1. USER BID PLACEMENT (WITH TRANSACTION)
// ==========================================

/**
 * @route   POST /api/gali-desawar/place-bid
 * @desc    Place single or bulk Gali Desawar bids with safe wallet deduction
 */
router.post('/place-bid', auth, async (req, res) => {
    console.log("🔥 INSIDE GALI DESAWAR PLACE-BID ROUTE 🔥");
  const { market_id, game_type, bids } = req.body;
  const user_id = req.user.id; // Extracted from auth middleware

  if (!user_id || !market_id || !Array.isArray(bids) || bids.length === 0) {
    return res.status(400).json({ error: 'Missing required bid parameters.' });
  }

  // Calculate total required amount
  const totalAmount = bids.reduce((sum, bid) => sum + Number(bid.amount || 0), 0);
  if (totalAmount <= 0) {
    return res.status(400).json({ error: 'Invalid total bid amount.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check Market Status in gali_desawar_markets
    const marketResult = await client.query(
      'SELECT id, name, status, is_active FROM gali_desawar_markets WHERE id = $1',
      [market_id]
    );

    if (marketResult.rows.length === 0 || marketResult.rows[0].is_active === false) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Market not found or inactive.' });
    }

    if (marketResult.rows[0].status === 'PAUSED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Betting is currently paused for this market.' });
    }

    // 2. Check User Wallet Balance
    const userResult = await client.query(
      'SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    const currentBalance = Number(userResult.rows[0].wallet_balance);
    if (currentBalance < totalAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient wallet balance.' });
    }

    // 3. Deduct Wallet Balance
    await client.query(
      'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
      [totalAmount, user_id]
    );

    // 4. Insert Bids INTO gali_desawar_bids (FIXED TABLE NAME HERE)
    const insertedBids = [];
    for (const bid of bids) {
      const bidInsertResult = await client.query(
        `INSERT INTO gali_desawar_bids (user_id, market_id, game_type, bid_number, amount, session, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING') 
         RETURNING *`,
        [
          user_id,
          market_id,
          bid.game_type || game_type || 'GALI_DESAWAR',
          String(bid.bid_number),
          Number(bid.amount),
          bid.session || 'Open'
        ]
      );
      insertedBids.push(bidInsertResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Bids placed successfully.',
      total_amount: totalAmount,
      bids_placed: insertedBids.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Place Bid Transaction Error]:', error);
    return res.status(500).json({ error: error.message || 'Server error while processing bid.' });
  } finally {
    client.release();
  }
});


// ==========================================
// 2. ADMIN MARKET MANAGEMENT (RAW SQL)
// ==========================================

/**
 * @route   GET /api/admin/gali-desawar/markets
 * @desc    Fetch all Gali Desawar markets
 */
router.get('/markets', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM gali_desawar_markets ORDER BY created_at DESC'
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('[Fetch Markets Error]:', error);
    return res.status(500).json({ error: 'Failed to fetch markets.' });
  }
});

/**
 * @route   POST /api/admin/gali-desawar/markets
 * @desc    Add a new Gali Desawar market
 */
router.post('/markets', async (req, res) => {
  const { name, open_time, close_time, result_time } = req.body;

  if (!name || !open_time || !close_time || !result_time) {
    return res.status(400).json({ error: 'All market detail fields are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO gali_desawar_markets (name, open_time, close_time, result_time, status) 
       VALUES ($1, $2, $3, $4, 'ACTIVE') 
       RETURNING *`,
      [name, open_time, close_time, result_time]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[Create Market Error]:', error);
    return res.status(500).json({ error: 'Failed to create market.' });
  }
});

/**
 * @route   PUT /api/admin/gali-desawar/markets/:id
 * @desc    Update market time details or name
 */
router.put('/markets/:id', async (req, res) => {
  const { id } = req.params;
  const { name, open_time, close_time, result_time } = req.body;

  try {
    const result = await pool.query(
      `UPDATE gali_desawar_markets 
       SET name = $1, open_time = $2, close_time = $3, result_time = $4 
       WHERE id = $5 
       RETURNING *`,
      [name, open_time, close_time, result_time, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found.' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[Update Market Error]:', error);
    return res.status(500).json({ error: 'Failed to update market.' });
  }
});

/**
 * @route   PATCH /api/admin/gali-desawar/markets/:id/status
 * @desc    Pause or Resume a market
 */
router.patch('/markets/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'ACTIVE' or 'PAUSED'

  if (!['ACTIVE', 'PAUSED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  try {
    const result = await pool.query(
      'UPDATE gali_desawar_markets SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found.' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[Toggle Status Error]:', error);
    return res.status(500).json({ error: 'Failed to update status.' });
  }
});

/**
 * @route   DELETE /api/admin/gali-desawar/markets/:id
 * @desc    Remove a market
 */
router.delete('/markets/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM gali_desawar_markets WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Market not found.' });
    }

    return res.status(200).json({ success: true, message: 'Market deleted successfully.' });
  } catch (error) {
    console.error('[Delete Market Error]:', error);
    return res.status(500).json({ error: 'Failed to delete market.' });
  }
});

// POST: DECLARE GALI DESAWAR RESULT ONLY
router.post("/declare-result", auth, async (req, res) => {
  const { market_id, winning_number } = req.body;

  // 1. Validation (Notice no 'session' required)
  if (!market_id || winning_number === undefined || winning_number === "") {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 2. Prevent Duplicate Declarations for today
    const checkResult = await client.query(
      `
      SELECT id FROM gali_desawar_results 
      WHERE market_id = $1 
        AND DATE(declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
    `,
      [market_id]
    );

    if (checkResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "The result for this Gali Desawar market has already been declared today!",
      });
    }

    // 3. Record Result in gali_desawar_results
    await client.query(
      `
      INSERT INTO gali_desawar_results (market_id, winning_number, declared_at) 
      VALUES ($1, $2, NOW())
    `,
      [market_id, winning_number]
    );

    // 4. Update last_result in gali_desawar_markets table (Optional convenience update)
    // await client.query(
    //   `
    //   UPDATE gali_desawar_markets 
    //   SET last_result = $1, updated_at = NOW() 
    //   WHERE id = $2
    // `,
    //   [winning_number, market_id]
    // );

    await client.query("COMMIT");

    res.json({
      message: "Gali Desawar result declared successfully!",
    });

    // =======================================================
    // BROADCAST PUSH NOTIFICATION TO ALL USERS
    // =======================================================
    (async () => {
      try {
        const marketRes = await pool.query(
          "SELECT name FROM gali_desawar_markets WHERE id = $1",
          [market_id]
        );
        const marketName = marketRes.rows[0]?.name || "Gali Desawar Market";

        const tokensRes = await pool.query(`
          SELECT DISTINCT push_token FROM users 
          WHERE push_token IS NOT NULL 
            AND push_token != '' 
            AND is_suspended = false 
            AND is_deleted = false
        `);

        const pushTokens = tokensRes.rows
          .map((row) => row.push_token)
          .filter((token) => Expo.isExpoPushToken(token));

        if (pushTokens.length === 0) return;

        const notificationTitle = `${marketName} Result Out! 🎉`;
        const notificationBody = `Declared Result: ${winning_number}`;

        const messages = pushTokens.map((token) => ({
          to: token,
          sound: "default",
          title: notificationTitle,
          body: notificationBody,
          data: { route: "GaliDesawar", marketId: market_id },
        }));

        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }

        await pool.query(
          `
          INSERT INTO notifications (user_id, title, message)
          SELECT id, $1, $2 FROM users WHERE is_suspended = false AND is_deleted = false
        `,
          [notificationTitle, notificationBody]
        );

        console.log(`[Push Sent] Broadcasted Gali Desawar result to ${pushTokens.length} users.`);
      } catch (pushError) {
        console.error("Broadcast Notification Failed:", pushError);
      }
    })();
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Gali Desawar Result Declaration Error:", error);
    res.status(500).json({ error: "Failed to declare result." });
  } finally {
    client.release();
  }
});

// GET: GALI DESAWAR RESULTS HISTORY
router.get("/results-history", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.id,
        r.market_id,
        r.winning_number,
        r.declared_at,
        m.name AS market_name
      FROM gali_desawar_results r
      JOIN gali_desawar_markets m ON r.market_id = m.id
      ORDER BY r.declared_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching Gali Desawar results history:", error);
    res.status(500).json({ error: "Failed to fetch results history." });
  }
});

// GET: BIDS FOR A SPECIFIC GALI DESAWAR RESULT
router.get("/results/:resultId/bids", auth, async (req, res) => {
  const { resultId } = req.params;

  try {
    // 1. Get the result record details
    const resultQuery = await pool.query(
      `SELECT market_id, winning_number, declared_at FROM gali_desawar_results WHERE id = $1`,
      [resultId]
    );

    if (resultQuery.rows.length === 0) {
      return res.status(404).json({ error: "Result not found" });
    }

    const { market_id, winning_number, declared_at } = resultQuery.rows[0];

    // 2. Fetch bids on that market created around the declared date
    const bidsQuery = await pool.query(
      `
      SELECT 
        b.id,
        b.bid_number,
        b.amount,
        CASE WHEN b.bid_number = $1 THEN 'WIN' ELSE 'LOSS' END AS status,
        u.full_name,
        u.phone_number
      FROM gali_desawar_bids b
      JOIN users u ON b.user_id = u.id
      WHERE b.market_id = $2 
        AND DATE(b.created_at AT TIME ZONE 'Asia/Kolkata') = DATE($3 AT TIME ZONE 'Asia/Kolkata')
      ORDER BY b.created_at DESC
    `,
      [winning_number, market_id, declared_at]
    );

    res.json(bidsQuery.rows);
  } catch (error) {
    console.error("Error fetching Gali Desawar bids for result:", error);
    res.status(500).json({ error: "Failed to fetch bids." });
  }
});

// GET: ACTIVE GALI DESAWAR MARKETS FOR USERS
router.get("/user/markets", auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        m.id,
        m.name,
        m.open_time,
        m.close_time,
        m.result_time,
        m.is_active,
        r.winning_number AS todays_result
      FROM gali_desawar_markets m
      LEFT JOIN gali_desawar_results r 
        ON m.id = r.market_id 
       AND DATE(r.declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
      WHERE m.is_active = true
      ORDER BY m.open_time ASC
    `;

    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching user Gali Desawar markets:", error);
    res.status(500).json({ error: "Failed to fetch active markets." });
  }
});

module.exports = router;