const express = require("express");
const router = express.Router();
const pool = require("../db");
const auth = require("../middleware/auth"); // Import your auth middleware
const { Expo } = require('expo-server-sdk');
let expo = new Expo();

// ==========================================
// USER ENDPOINT: SUBMIT A MANUAL FUND REQUEST
// ==========================================
router.post("/request", auth, async (req, res) => {
  const { amount, utr_number } = req.body;
  const userId = req.user.id; // Retreived from your 'auth' middleware

  if (!amount || !utr_number || Number(amount) <= 0) {
    return res.status(400).json({ error: "Invalid amount or UTR number." });
  }

  try {
    // Insert the pending request.
    // PostgreSQL UNIQUE constraint on utr_number will automatically prevent duplicates.
    await pool.query(
      "INSERT INTO fund_requests (user_id, amount, utr_number, status) VALUES ($1, $2, $3, 'PENDING')",
      [userId, amount, utr_number],
    );

    res
      .status(201)
      .json({
        message:
          "Fund request submitted successfully and is pending admin approval.",
      });
  } catch (err) {
    console.error("Fund request submission error:", err.message);

    // Check if Postgres returns unique violation error code (23505)
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ error: "This UTR number has already been submitted." });
    }

    res.status(500).json({ error: "Server Error" });
  }
});

// ==========================================
// ADMIN ENDPOINT: GET ALL PENDING REQUESTS
// ==========================================
router.get("/admin/pending", auth, async (req, res) => {
  // Optional: Add admin role validation just like you did on your login check
  try {
    const result = await pool.query(
      `SELECT fr.id, fr.amount, fr.utr_number, fr.created_at, u.full_name, u.phone_number, fr.user_id 
       FROM fund_requests fr
       JOIN users u ON fr.user_id = u.id
       WHERE fr.status = 'PENDING'
       ORDER BY fr.created_at ASC`,
    );
    res.json({ requests: result.rows });
  } catch (error) {
    console.error("Error fetching admin pending requests:", error);
    res.status(500).json({ error: "Server Error" });
  }
});

// ==========================================
// ADMIN ENDPOINT: APPROVE REQUEST (WITH TRANSACTION)
// ==========================================
router.post("/admin/approve", auth, async (req, res) => {
  const { request_id } = req.body;

  if (!request_id) {
    return res.status(400).json({ error: "Missing request ID." });
  }

  const client = await pool.connect();

  try {
    // 1. Begin Database Transaction
    await client.query("BEGIN");

    // 2. Fetch and lock the request row to prevent race conditions (double approvals)
    const checkRequest = await client.query(
      "SELECT * FROM fund_requests WHERE id = $1 FOR UPDATE",
      [request_id],
    );

    if (checkRequest.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Request not found." });
    }

    const request = checkRequest.rows[0];

    if (request.status !== "PENDING") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `Request is already ${request.status}.` });
    }

    // 3. Update the request status to APPROVED
    await client.query(
      "UPDATE fund_requests SET status = 'APPROVED' WHERE id = $1",
      [request_id],
    );

    // 4. Credit the User's Wallet Balance
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [request.amount, request.user_id],
    );

    // 5. Add a ledger/passbook entry to Transaction History
    await client.query(
      "INSERT INTO transactions (user_id, type, amount) VALUES ($1, 'CREDIT', $2)",
      [request.user_id, request.amount],
    );

    // 6. Commit all operations permanently
    await client.query("COMMIT");
    res.json({ message: "Funds approved and credited successfully." });

    try {
      // 1. Get the user's push token
      const userQuery = await client.query(
        "SELECT push_token FROM users WHERE id = $1",
        [request.user_id],
      );
      const pushToken = userQuery.rows[0]?.push_token;

      const notificationTitle = "Funds Approved! 🎉";
      const notificationBody = `Your request for ₹${request.amount} has been credited to your wallet.`;

      // 2. Save it to the in-app notifications table
      await client.query(
        "INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)",
        [request.user_id, notificationTitle, notificationBody],
      );

      // 3. Send the actual Push Notification to their phone
      if (pushToken && Expo.isExpoPushToken(pushToken)) {
        await expo.sendPushNotificationsAsync([
          {
            to: pushToken,
            sound: "default",
            title: notificationTitle,
            body: notificationBody,
            data: { route: "Wallet" }, // Optional: tells the app where to navigate when tapped
          },
        ]);
      }
    } catch (pushError) {
      console.error(
        "Push notification failed, but transaction succeeded:",
        pushError,
      );
      // We don't rollback the DB transaction just because the notification failed
    }
  } catch (error) {
    // If any query fails, rollback the whole transaction to ensure data integrity
    await client.query("ROLLBACK");
    console.error("Transaction Error during Fund Approval:", error);
    res.status(500).json({ error: "Failed to approve funds transaction." });
  } finally {
    client.release();
  }
});

// ==========================================
// ADMIN ENDPOINT: REJECT REQUEST
// ==========================================
// router.post("/admin/reject", auth, async (req, res) => {
//   const { request_id } = req.body;

//   if (!request_id) {
//     return res.status(400).json({ error: "Missing request ID." });
//   }

//   try {
//     const result = await pool.query(
//       "UPDATE fund_requests SET status = 'REJECTED' WHERE id = $1 AND status = 'PENDING' RETURNING id",
//       [request_id],
//     );

//     if (result.rows.length === 0) {
//       return res
//         .status(400)
//         .json({ error: "Request not found or already processed." });
//     }

//     res.json({ message: "Request rejected successfully." });
//   } catch (error) {
//     console.error("Fund rejection error:", error);
//     res.status(500).json({ error: "Server Error" });
//   }
// });

router.post("/admin/reject", auth, async (req, res) => {
  const { request_id } = req.body;

  if (!request_id) {
    return res.status(400).json({ error: "Missing request ID." });
  }

  try {
    const result = await pool.query(
      "UPDATE fund_requests SET status = 'REJECTED' WHERE id = $1 AND status = 'PENDING' RETURNING id",
      [request_id],
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Request not found or already processed." });
    }

    res.json({ message: "Request rejected successfully." });
  } catch (error) {
    console.error("Fund rejection error:", error);
    res.status(500).json({ error: "Server Error" });
  }
});

module.exports = router;


module.exports = router;
