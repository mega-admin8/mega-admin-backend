const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const multer = require("multer");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { Expo } = require('expo-server-sdk');
require("dotenv").config();

const expo = new Expo();

// Configure Cloudinary with your credentials from the Cloudinary Dashboard
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Setup Cloudinary storage engine for Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "megaplay_qr_codes",
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const upload = multer({ storage: storage });

router.post("/add-funds", async (req, res) => {
  const { phone_number, amount } = req.body;

  console.log(`Admin adding funds: ${amount} to ${phone_number}`);

  try {
    // Update user balance
    const result = await pool.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE phone_number = $2 RETURNING wallet_balance",
      [amount, phone_number],
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    // Add to Transaction History
    const userId = (
      await pool.query("SELECT id FROM users WHERE phone_number = $1", [
        phone_number,
      ])
    ).rows[0].id;

    console.log(
      `Recording transaction for user ID: ${userId}, amount: ${amount}`,
    );

    await pool.query(
      "INSERT INTO transactions (user_id, type, amount) VALUES ($1, 'CREDIT', $2)",
      [userId, amount],
    );

    res.json({
      message: "Funds added successfully",
      new_balance: result.rows[0].wallet_balance,
    });
  } catch (err) {
    console.error("🔥 ACTUAL ERROR:", err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

// POST /api/admin/login
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

    // Compare entered M-PIN with Hashed M-PIN
    const isMatch = await bcrypt.compare(mpin, user.rows[0].mpin_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid M-PIN" });
    }

    // THE CRITICAL ADMIN CHECK: Ensure the authenticated user actually has admin rights
    if (user.rows[0].role !== "admin") {
      return res
        .status(403)
        .json({ error: "Access Denied. Admin privileges required." });
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
        role: user.rows[0].role, // Passing role to frontend for context
        balance: user.rows[0].wallet_balance, // Included to match your existing structure
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// GET /api/admin/markets/all
// Gets ALL markets for the admin panel, including paused ones
router.get("/all", async (req, res) => {
  try {
    // We order by id so the list doesn't jump around when you toggle!
    const result = await pool.query("SELECT * FROM markets ORDER BY id ASC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching admin markets:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/admin/users/:userId/details
router.get("/users/:userId/details", auth, async (req, res) => {
  const { userId } = req.params;

  // Default to page 1, limit 15 items per page
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const offset = (page - 1) * limit;

  const startDate = req.query.startDate;
  const endDate = req.query.endDate;

  try {
    // 1. Get basic user info
    const userQuery = `SELECT id, full_name as name, phone_number as mobile, wallet_balance, created_at FROM users WHERE id = $1`;
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userResult.rows[0];

    // 2. Get TRUE LIFETIME STATS (Optimized SQL instead of Array Math)
    const statsQuery = `
            SELECT 
                COUNT(*) as total_bids,
                COALESCE(SUM(amount), 0) as total_amount_played,
                COALESCE(SUM(CASE WHEN status = 'WIN' THEN amount * 9 ELSE 0 END), 0) as total_amount_won
            FROM bids
            WHERE user_id = $1
        `;
    const statsResult = await pool.query(statsQuery, [userId]);
    const stats = statsResult.rows[0];

    // 3. Build the Paginated & Filtered Bids Query
    let bidsQuery = `
            SELECT 
                b.id, b.bid_number, b.amount, b.game_type, b.session, b.placed_at, b.status,
                m.name AS market_name
            FROM bids b
            JOIN markets m ON b.market_id = m.id
            WHERE b.user_id = $1
        `;
    let countQuery = `SELECT COUNT(*) FROM bids b WHERE b.user_id = $1`;

    const queryParams = [userId];
    let paramIndex = 2;

    // Apply Date Filters if provided
    if (startDate && endDate) {
      const dateFilter = ` AND b.placed_at >= $${paramIndex} AND b.placed_at <= $${paramIndex + 1}`;
      bidsQuery += dateFilter;
      countQuery += dateFilter;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    }

    // Add Pagination
    bidsQuery += ` ORDER BY b.placed_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const paginatedParams = [...queryParams, limit, offset];

    // Run both queries in parallel for speed
    const [bidsResult, countResult] = await Promise.all([
      pool.query(bidsQuery, paginatedParams),
      pool.query(countQuery, queryParams),
    ]);

    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      user,
      stats: {
        totalBids: parseInt(stats.total_bids),
        totalAmountPlayed: Number(stats.total_amount_played),
        totalAmountWon: Number(stats.total_amount_won),
      },
      bids: bidsResult.rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems,
      },
    });
  } catch (err) {
    console.error("Error fetching user details:", err);
    res.status(500).json({ error: "Failed to load user details" });
  }
});

// SOFT DELETE USER
router.delete("/users/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Instead of DELETE, we UPDATE the user to be marked as deleted
    const result = await pool.query(
      "UPDATE users SET is_deleted = TRUE WHERE id = $1 RETURNING id",
      [userId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Soft Delete User Error:", error);
    res.status(500).json({ error: "Failed to delete user." });
  }
});

// GET /admin/dashboard-stats
router.get("/dashboard-stats", async (req, res) => {
  try {
    // 1. Total Users & Total Platform Liability (Sum of all user wallets)
    const usersQuery = await pool.query(
      `
        SELECT 
            COUNT(*) as total_users, 
            COALESCE(SUM(wallet_balance), 0) as total_liability 
        FROM users 
        WHERE role != $1 AND is_deleted = FALSE
    `,
      ["admin"],
    );
    const { total_users, total_liability } = usersQuery.rows[0];

    // 2. Today's Financials (Bids placed today vs. Wins paid out today)
    // Adjust the "* 9" multiplier to match whatever your actual win calculation logic is
    const todayStatsQuery = await pool.query(`
        SELECT 
            COUNT(*) as today_bids_count,
            COALESCE(SUM(amount), 0) as today_bids_amount,
            COALESCE(SUM(CASE WHEN status = 'WIN' THEN amount * 9 ELSE 0 END), 0) as today_wins_amount
        FROM bids 
        WHERE DATE(placed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
    `);
    const { today_bids_count, today_bids_amount, today_wins_amount } =
      todayStatsQuery.rows[0];

    // 3. Calculate Today's Profit/Loss
    const today_profit = Number(today_bids_amount) - Number(today_wins_amount);

    res.json({
      totalUsers: parseInt(total_users),
      totalLiability: Number(total_liability),
      todayBidsCount: parseInt(today_bids_count),
      todayBidsAmount: Number(today_bids_amount),
      todayWinsAmount: Number(today_wins_amount),
      todayProfit: today_profit,
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

// POST: DECLARE RESULT & DISTRIBUTE WINNINGS
// router.post('/markets/declare-result', auth, async (req, res) => {
//   const { market_id, session, winning_number } = req.body;

//   if (!market_id || !session || !winning_number) {
//     return res.status(400).json({ error: "Missing required fields" });
//   }

//   const client = await pool.connect();

//   try {
//     await client.query('BEGIN');

//     // Fetch the live payout rates from the database
//     const settingsQuery = await client.query('SELECT * FROM app_settings WHERE id = 1');
//     const settings = settingsQuery.rows[0];

//     const payoutRates = {
//       'SINGLE_DIGIT': Number(settings.single_digit_rate),
//       'JODI_DIGIT': Number(settings.jodi_digit_rate),
//       'JODI': Number(settings.jodi_digit_rate), // Added fallback just in case it's saved as JODI
//       'SINGLE_PANNA': Number(settings.single_panna_rate),
//       'DOUBLE_PANNA': Number(settings.double_panna_rate),
//       'TRIPLE_PANNA': Number(settings.triple_panna_rate),
//       'HALF_SANGAM': Number(settings.half_sangam_rate),
//       'FULL_SANGAM': Number(settings.full_sangam_rate),
//       'FAMILY_JODI': Number(settings.family_jodi_rate),
//       'SP_MOTOR': Number(settings.sp_motor_rate),
//       'DP_MOTOR': Number(settings.dp_motor_rate)
//     };

//     // Prevent Duplicate Declarations
//     const checkResult = await client.query(`
//       SELECT id FROM results
//       WHERE market_id = $1
//         AND session = $2
//         AND DATE(declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
//     `, [market_id, session]);

//     if (checkResult.rows.length > 0) {
//       await client.query('ROLLBACK'); // Cancel the transaction
//       return res.status(400).json({
//         error: `The ${session} result for this market has already been declared today!`
//       });
//     }

//     // 1. Mark winning bids and get the winners' details
//     // Assuming 'PENDING' is the default status for a new bid
//     // 1. Mark winning bids (STRICTLY RESTRICTED TO TODAY)
//     const winQuery = `
//       UPDATE bids
//       SET status = 'WIN'
//       WHERE market_id = $1
//         AND UPPER(session) = UPPER($2)
//         AND bid_number = $3
//         AND status = 'PENDING'
//         AND DATE(placed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
//       RETURNING id as bid_id, user_id, amount, game_type
//     `;
//     const winningBids = await client.query(winQuery, [market_id, session, winning_number]);

//     // 2. Mark all other bids for this market/session as LOSS
//     // 2. Mark all other bids for this market/session as LOSS (STRICTLY RESTRICTED TO TODAY)
//     const lossQuery = `
//       UPDATE bids
//       SET status = 'LOSS'
//       WHERE market_id = $1
//         AND UPPER(session) = UPPER($2)
//         AND bid_number != $3
//         AND status = 'PENDING'
//         AND DATE(placed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
//     `;
//     await client.query(lossQuery, [market_id, session, winning_number]);

//     // 3. Distribute Winnings to Wallets & Create Passbook Entries
//     for (const bid of winningBids.rows) {
//       // Typically, Single Digit pays 9x the amount. Adjust this multiplier based on game_type if needed.
//       // const winAmount = bid.amount * 9;
//       const multiplier = payoutRates[bid.game_type] || 1;
//       const winAmount = bid.amount * multiplier;

//       // 1. Stamp the exact won amount into the bid forever
//       await client.query(`
//         UPDATE bids
//         SET won_amount = $1
//         WHERE id = $2
//       `, [winAmount, bid.bid_id]);

//       // Add money to user wallet
//       await client.query(`
//         UPDATE users
//         SET wallet_balance = wallet_balance + $1
//         WHERE id = $2
//       `, [winAmount, bid.user_id]);

//       // Create ledger entry for the passbook
//       await client.query(`
//         INSERT INTO transactions (user_id, amount, type)
//         VALUES ($1, $2, 'WIN')
//       `, [bid.user_id, winAmount]);
//     }

//     // 4. (Optional) Save the result history in a results table if you have one
//     // await client.query('INSERT INTO results (market_id, session, winning_number, declared_at) VALUES ($1, $2, $3, NOW())', [market_id, session, winning_number]);

//     // Save the result history to the database
//     await client.query(`
//       INSERT INTO results (market_id, session, winning_number, declared_at)
//       VALUES ($1, $2, $3, NOW())
//     `, [market_id, session, winning_number]);

//     await client.query('COMMIT');

//     res.json({
//       message: "Result declared successfully!",
//       totalWinners: winningBids.rows.length
//     });

//   } catch (error) {
//     await client.query('ROLLBACK');
//     console.error("Result Declaration Error:", error);
//     res.status(500).json({ error: 'Failed to declare result and update wallets.' });
//   } finally {
//     client.release();
//   }
// });

// Helper: Derive Single Digit from 3-digit Pana
const deriveSingleDigit = (panaStr) => {
  if (!panaStr || panaStr.length < 3) return panaStr; // Fallback if already single digit
  const sum = panaStr
    .split("")
    .reduce((acc, digit) => acc + parseInt(digit, 10), 0);
  return (sum % 10).toString();
};

// Helper: Generate Family Jodi combinations
const getFamilyJodiNumbers = (jodiStr) => {
  if (!jodiStr || jodiStr.length !== 2) return [jodiStr];
  const cutDigit = (d) => (parseInt(d, 10) + 5) % 10;
  const d1 = parseInt(jodiStr[0], 10);
  const d2 = parseInt(jodiStr[1], 10);

  const c1 = cutDigit(d1);
  const c2 = cutDigit(d2);

  return [
    `${d1}${d2}`,
    `${d1}${c2}`,
    `${c1}${d2}`,
    `${c1}${c2}`,
    `${d2}${d1}`,
    `${d2}${c1}`,
    `${c2}${d1}`,
    `${c2}${c1}`,
  ];
};

// POST: DECLARE RESULT & DISTRIBUTE WINNINGS
router.post("/markets/declare-result", auth, async (req, res) => {
  const { market_id, session, winning_number } = req.body; // winning_number is 3-digit Pana (e.g. "138")

  if (!market_id || !session || !winning_number) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch live payout rates
    const settingsQuery = await client.query(
      "SELECT * FROM app_settings WHERE id = 1",
    );
    const settings = settingsQuery.rows[0] || {};

    const payoutRates = {
      SINGLE_DIGIT: Number(settings.single_digit_rate || 9),
      JODI_DIGIT: Number(settings.jodi_digit_rate || 90),
      JODI: Number(settings.jodi_digit_rate || 90),
      SINGLE_PANNA: Number(settings.single_panna_rate || 140),
      DOUBLE_PANNA: Number(settings.double_panna_rate || 280),
      TRIPLE_PANNA: Number(settings.triple_panna_rate || 600),
      HALF_SANGAM: Number(settings.half_sangam_rate || 1000),
      FULL_SANGAM: Number(settings.full_sangam_rate || 10000),
      FAMILY_JODI: Number(settings.family_jodi_rate || 90),
    };

    // 2. Prevent Duplicate Declarations for this session today
    const checkResult = await client.query(
      `
      SELECT id FROM results 
      WHERE market_id = $1 
        AND session = $2 
        AND DATE(declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
    `,
      [market_id, session],
    );

    if (checkResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `The ${session} result for this market has already been declared today!`,
      });
    }

    // 3. Derive winning numbers for current session
    const currentPana = winning_number;
    const currentSingleDigit = deriveSingleDigit(winning_number);

    let winningConditions = [];

    // Conditions for current session Pana & Single Digit bets
    winningConditions.push(
      `(UPPER(session) = UPPER('${session}') AND game_type IN ('SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA') AND bid_number = '${currentPana}')`,
    );
    winningConditions.push(
      `(UPPER(session) = UPPER('${session}') AND game_type = 'SINGLE_DIGIT' AND bid_number = '${currentSingleDigit}')`,
    );

    // 4. If CLOSE session, fetch OPEN result to derive Jodi & Sangam
    if (session.toUpperCase() === "CLOSE") {
      const openResultQuery = await client.query(
        `
        SELECT winning_number FROM results 
        WHERE market_id = $1 
          AND UPPER(session) = 'OPEN' 
          AND DATE(declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
        ORDER BY declared_at DESC LIMIT 1
      `,
        [market_id],
      );

      if (openResultQuery.rows.length > 0) {
        const openPana = openResultQuery.rows[0].winning_number;
        const openSingleDigit = deriveSingleDigit(openPana);

        const jodiNumber = `${openSingleDigit}${currentSingleDigit}`;
        const familyJodiNumbers = getFamilyJodiNumbers(jodiNumber);
        const halfSangam1 = `${openPana}-${currentSingleDigit}`;
        const halfSangam2 = `${openSingleDigit}-${currentPana}`;
        const fullSangam = `${openPana}-${currentPana}`;

        // Add Jodi and Sangam winning conditions
        winningConditions.push(
          `(game_type IN ('JODI', 'JODI_DIGIT') AND bid_number = '${jodiNumber}')`,
        );
        winningConditions.push(
          `(game_type = 'FAMILY_JODI' AND bid_number IN (${familyJodiNumbers.map((n) => `'${n}'`).join(",")}))`,
        );
        winningConditions.push(
          `(game_type = 'HALF_SANGAM' AND bid_number IN ('${halfSangam1}', '${halfSangam2}'))`,
        );
        winningConditions.push(
          `(game_type = 'FULL_SANGAM' AND bid_number = '${fullSangam}')`,
        );
      }
    }

    const winningWhereClause = winningConditions.join(" OR ");

    // 5. Update Winning Bids
    const winQuery = `
      UPDATE bids 
      SET status = 'WIN' 
      WHERE market_id = $1 
        AND status = 'PENDING'
        AND DATE(placed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
        AND (${winningWhereClause})
      RETURNING id as bid_id, user_id, amount, game_type
    `;
    const winningBids = await client.query(winQuery, [market_id]);

    // 6. Update Losing Bids (Only for session-specific or completed games)
    let lossWhereClause = `UPPER(session) = UPPER('${session}')`;
    if (session.toUpperCase() === "CLOSE") {
      lossWhereClause = `(UPPER(session) = 'CLOSE' OR game_type IN ('JODI', 'JODI_DIGIT', 'FAMILY_JODI', 'HALF_SANGAM', 'FULL_SANGAM'))`;
    }

    const lossQuery = `
      UPDATE bids 
      SET status = 'LOSS' 
      WHERE market_id = $1 
        AND status = 'PENDING'
        AND DATE(placed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
        AND ${lossWhereClause}
    `;
    await client.query(lossQuery, [market_id]);

    // 7. Credit Wallet Balances & Record Transactions
    for (const bid of winningBids.rows) {
      const multiplier = payoutRates[bid.game_type] || 1;
      const winAmount = Number(bid.amount) * multiplier;

      await client.query(`UPDATE bids SET won_amount = $1 WHERE id = $2`, [
        winAmount,
        bid.bid_id,
      ]);
      await client.query(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`,
        [winAmount, bid.user_id],
      );
      await client.query(
        `INSERT INTO transactions (user_id, amount, type) VALUES ($1, $2, 'WIN')`,
        [bid.user_id, winAmount],
      );
    }

    // 8. Record Result
    await client.query(
      `
      INSERT INTO results (market_id, session, winning_number, declared_at) 
      VALUES ($1, $2, $3, NOW())
    `,
      [market_id, session, currentPana],
    );

    await client.query("COMMIT");

    res.json({
      message: "Result declared successfully!",
      totalWinners: winningBids.rows.length,
    });

    // =======================================================
    // BROADCAST PUSH NOTIFICATION TO ALL USERS (IN BACKGROUND)
    // =======================================================
    (async () => {
      try {
        // 1. Fetch the Market Name
        const marketRes = await pool.query(
          "SELECT name FROM markets WHERE id = $1",
          [market_id],
        );
        const marketName = marketRes.rows[0]?.name || "Market";

        // 2. Get all valid push tokens from active, non-suspended users
        const tokensRes = await pool.query(`
          SELECT DISTINCT push_token FROM users 
          WHERE push_token IS NOT NULL 
            AND push_token != '' 
            AND is_suspended = false 
            AND is_deleted = false
        `);

        // Filter and ensure tokens are valid Expo push tokens
        const pushTokens = tokensRes.rows
          .map((row) => row.push_token)
          .filter((token) => Expo.isExpoPushToken(token));

        if (pushTokens.length === 0) return;

        // 3. Format Title and Body
        const notificationTitle = `${marketName} (${session}) Result Out! 🎉`;
        const notificationBody = `Declared Result: ${winning_number} (Single Digit: ${currentSingleDigit})`;

        // 4. Construct messages for each user
        const messages = pushTokens.map((token) => ({
          to: token,
          sound: "default",
          title: notificationTitle,
          body: notificationBody,
          data: { route: "Dashboard", marketId: market_id },
        }));

        // 5. Send in Chunks using Expo SDK to prevent API rate limits
        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }

        // 6. Log to in-app notification center history for all users
        await pool.query(
          `
          INSERT INTO notifications (user_id, title, message)
          SELECT id, $1, $2 FROM users WHERE is_suspended = false AND is_deleted = false
        `,
          [notificationTitle, notificationBody],
        );

        console.log(
          `[Push Sent] Broadcasted result to ${pushTokens.length} users.`,
        );
      } catch (pushError) {
        console.error("Broadcast Notification Failed:", pushError);
      }
    })();
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Result Declaration Error:", error);
    res
      .status(500)
      .json({ error: "Failed to declare result and update wallets." });
  } finally {
    client.release();
  }
});

// GET ALL PAST RESULTS
router.get("/markets/results-history", async (req, res) => {
  try {
    const resultQuery = await pool.query(`
      SELECT r.id, r.session, r.winning_number, r.declared_at, m.name as market_name 
      FROM results r
      JOIN markets m ON r.market_id = m.id
      ORDER BY r.declared_at DESC
      LIMIT 100 -- Limit to recent 100 for performance
    `);
    res.json(resultQuery.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch results history" });
  }
});

// GET WINNERS/LOSERS FOR A SPECIFIC RESULT
router.get("/markets/results/:resultId/bids", async (req, res) => {
  const { resultId } = req.params;
  try {
    // First, get the result details so we know which market, session, and date to look up
    const resultData = await pool.query("SELECT * FROM results WHERE id = $1", [
      resultId,
    ]);
    if (resultData.rows.length === 0)
      return res.status(404).json({ error: "Result not found" });

    const result = resultData.rows[0];

    // Now, fetch all bids placed on that exact calendar day for that market and session
    const bidsQuery = await pool.query(
      `
      SELECT b.id, b.bid_number, b.amount, b.status, u.full_name, u.phone_number
      FROM bids b
      JOIN users u ON b.user_id = u.id
      WHERE b.market_id = $1 
        AND UPPER(b.session) = UPPER($2) 
        AND DATE(b.placed_at AT TIME ZONE 'Asia/Kolkata') = DATE($3 AT TIME ZONE 'Asia/Kolkata')
      ORDER BY b.amount DESC -- Show biggest bets first
    `,
      [result.market_id, result.session, result.declared_at],
    );

    res.json(bidsQuery.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bids for this result" });
  }
});

// GET APP SETTINGS
router.get("/settings", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM app_settings WHERE id = 1");
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// router.put('/settings', upload.single('qr_image'), async (req, res) => {
//   const { upi_id, whatsapp_number, min_amount, existing_qr_url } = req.body;

//   try {
//     let qr_code_url = existing_qr_url;

//     // If a NEW file was uploaded
//     if (req.file) {
//        qr_code_url = req.file.path; // The new Cloudinary secure URL

//        // --- NEW LOGIC: Delete the old image from Cloudinary ---
//        if (existing_qr_url && existing_qr_url.includes('cloudinary.com')) {
//          try {
//            // 1. Extract the public_id from the old URL
//            // Example URL: https://res.cloudinary.com/xyz/image/upload/v123/megaplay_qr_codes/qr123.png
//            // We need: megaplay_qr_codes/qr123
//            const urlParts = existing_qr_url.split('/');
//            const filenameWithExt = urlParts.pop(); // "qr123.png"
//            const folder = urlParts.pop(); // "megaplay_qr_codes"
//            const filename = filenameWithExt.split('.')[0]; // "qr123"
//            const publicId = `${folder}/${filename}`;

//            // 2. Tell Cloudinary to destroy it
//            await cloudinary.uploader.destroy(publicId);
//            console.log(`Deleted old QR code: ${publicId}`);
//          } catch (deleteError) {
//            // We catch this error separately so a failed deletion
//            // doesn't stop the new settings from saving!
//            console.error("Failed to delete old image from Cloudinary:", deleteError);
//          }
//        }
//     }

//     // Update the database with the new URL
//     await pool.query(`
//       UPDATE app_settings
//       SET upi_id = $1, whatsapp_number = $2, qr_code_url = $3, min_amount = $4
//       WHERE id = 1
//     `, [upi_id, whatsapp_number, qr_code_url, min_amount]);

//     res.json({ message: 'Settings updated successfully', new_qr_url: qr_code_url });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Failed to update settings' });
//   }
// });

router.put("/settings", upload.single("qr_image"), async (req, res) => {
  // 1. Extract ALL fields including the 10 new rates
  const {
    upi_id,
    whatsapp_number,
    min_amount,
    existing_qr_url,
    single_digit_rate,
    jodi_digit_rate,
    single_panna_rate,
    double_panna_rate,
    triple_panna_rate,
    half_sangam_rate,
    full_sangam_rate,
    family_jodi_rate,
    sp_motor_rate,
    dp_motor_rate,
  } = req.body;

  try {
    let qr_code_url = existing_qr_url;

    if (req.file) {
      qr_code_url = req.file.path;
      if (existing_qr_url && existing_qr_url.includes("cloudinary.com")) {
        try {
          const urlParts = existing_qr_url.split("/");
          const filenameWithExt = urlParts.pop();
          const folder = urlParts.pop();
          const filename = filenameWithExt.split(".")[0];
          const publicId = `${folder}/${filename}`;
          await cloudinary.uploader.destroy(publicId);
        } catch (deleteError) {
          console.error(
            "Failed to delete old image from Cloudinary:",
            deleteError,
          );
        }
      }
    }

    // 2. Update the database with the core settings AND the new rates
    await pool.query(
      `
      UPDATE app_settings 
      SET 
        upi_id = $1, whatsapp_number = $2, qr_code_url = $3, min_amount = $4,
        single_digit_rate = $5, jodi_digit_rate = $6, single_panna_rate = $7, 
        double_panna_rate = $8, triple_panna_rate = $9, half_sangam_rate = $10, 
        full_sangam_rate = $11, family_jodi_rate = $12, sp_motor_rate = $13, 
        dp_motor_rate = $14
      WHERE id = 1
    `,
      [
        upi_id,
        whatsapp_number,
        qr_code_url,
        min_amount,
        single_digit_rate,
        jodi_digit_rate,
        single_panna_rate,
        double_panna_rate,
        triple_panna_rate,
        half_sangam_rate,
        full_sangam_rate,
        family_jodi_rate,
        sp_motor_rate,
        dp_motor_rate,
      ],
    );

    res.json({
      message: "Settings updated successfully",
      new_qr_url: qr_code_url,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// GET: Pre-Declaration Liability Dashboard
router.get("/markets/:id/liability", async (req, res) => {
  const marketId = req.params.id;
  const session = req.query.session || "OPEN";

  try {
    // 1. Get live payout rates from your settings table
    const settingsQuery = await pool.query(
      "SELECT * FROM app_settings WHERE id = 1",
    );
    const settings = settingsQuery.rows[0];

    const payoutRates = {
      SINGLE_DIGIT: Number(settings.single_digit_rate),
      JODI_DIGIT: Number(settings.jodi_digit_rate),
      JODI: Number(settings.jodi_digit_rate), // Fallback
      SINGLE_PANNA: Number(settings.single_panna_rate),
      DOUBLE_PANNA: Number(settings.double_panna_rate),
      TRIPLE_PANNA: Number(settings.triple_panna_rate),
      HALF_SANGAM: Number(settings.half_sangam_rate),
      FULL_SANGAM: Number(settings.full_sangam_rate),
      FAMILY_JODI: Number(settings.family_jodi_rate),
      SP_MOTOR: Number(settings.sp_motor_rate),
      DP_MOTOR: Number(settings.dp_motor_rate),
    };

    // 2. Fetch all PENDING bets for this exact market & session TODAY
    const betsQuery = await pool.query(
      `
      SELECT bid_number, game_type, amount 
      FROM bids 
      WHERE market_id = $1 
        AND UPPER(session) = UPPER($2) 
        AND status = 'PENDING'
        AND DATE(placed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
    `,
      [marketId, session],
    );

    // 3. Aggregate liabilities (Group by Bid Number)
    const liabilityMap = {};
    let totalCollected = 0;

    betsQuery.rows.forEach((bet) => {
      const multiplier = payoutRates[bet.game_type] || 1;
      const potentialPayout = bet.amount * multiplier;

      totalCollected += Number(bet.amount);

      if (!liabilityMap[bet.bid_number]) {
        liabilityMap[bet.bid_number] = {
          bid_number: bet.bid_number,
          total_bets_count: 0,
          potential_payout: 0,
        };
      }

      liabilityMap[bet.bid_number].total_bets_count += 1;
      liabilityMap[bet.bid_number].potential_payout += potentialPayout;
    });

    // Convert map to array so the frontend can easily search it
    const liabilityArray = Object.values(liabilityMap);

    res.json({
      totalCollected: totalCollected,
      liabilities: liabilityArray,
    });
  } catch (error) {
    console.error("Liability Error:", error);
    res.status(500).json({ error: "Failed to calculate liability." });
  }
});

// PUT: Toggle User Suspension Status
router.put("/users/:userId/toggle-suspend", async (req, res) => {
  const { userId } = req.params;

  try {
    // This query flips the boolean: if true it becomes false, if false it becomes true.
    const result = await pool.query(
      `
      UPDATE users 
      SET is_suspended = NOT is_suspended 
      WHERE id = $1 
      RETURNING id, full_name, is_suspended
    `,
      [userId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];
    const statusMsg = user.is_suspended ? "suspended" : "reactivated";

    res.json({
      message: `${user.full_name} has been ${statusMsg}.`,
      is_suspended: user.is_suspended,
    });
  } catch (error) {
    console.error("Suspend User Error:", error);
    res.status(500).json({ error: "Failed to update user status." });
  }
});

module.exports = router;
