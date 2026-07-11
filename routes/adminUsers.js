const express = require('express');
const router = express.Router();
const pool = require('../db'); 

// // 1. GET ALL USERS
// router.get('/all', async (req, res) => {
//   try {
//     const result = await pool.query(
//       'SELECT id, full_name, phone_number, wallet_balance, role FROM users WHERE role != $1 ORDER BY id DESC',
//       ['admin']
//     );
//     res.json(result.rows);
//   } catch (error) {
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });


// 1. GET ALL USERS (Paginated & Searched)
router.get('/all', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    // Base query components
    let baseQuery = 'FROM users WHERE role != $1 AND is_deleted = FALSE';
    let params = ['admin'];
    let paramIndex = 2;

    // Add search filter if provided
    if (search) {
      // ILIKE is case-insensitive in PostgreSQL
      baseQuery += ` AND (full_name ILIKE $${paramIndex} OR phone_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`); // The % wildcard allows partial matching
      paramIndex++;
    }

    // 1. Count total users matching the query (for pagination math)
    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    // 2. Fetch the actual paginated data
    const dataQuery = `SELECT id, full_name, phone_number, wallet_balance, role ${baseQuery} ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const dataParams = [...params, limit, offset];
    
    const result = await pool.query(dataQuery, dataParams);

    // Send back both the users and the pagination info
    res.json({
      users: result.rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems
      }
    });
  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. GET USER PASSBOOK (LEDGER)
router.get('/:id/passbook', async (req, res) => {
  const { id } = req.params;
  try {
    // Fetches the latest 50 transactions for the user
    const result = await pool.query(
      "SELECT id, type, amount, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Passbook error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. ADD OR DEDUCT FUNDS (With Strict Ledger Math)
router.patch('/update-funds', async (req, res) => {
  const { user_id, amount, action } = req.body;

  if (!user_id || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN'); 

    let userQuery = '';
    let transactionType = '';
    
    if (action === 'add') {
      userQuery = 'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance';
      transactionType = 'ADMIN_CREDIT';
    } else if (action === 'deduct') {
      // CRITICAL FIX: The AND wallet_balance >= $1 ensures it completely fails if they don't have enough
      userQuery = 'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2 AND wallet_balance >= $1 RETURNING wallet_balance';
      transactionType = 'ADMIN_DEBIT'; 
    } else {
      throw new Error('Invalid action.');
    }

    const result = await client.query(userQuery, [amount, user_id]);
    
    // Check if the query failed to update any rows
    if (result.rowCount === 0) {
      if (action === 'deduct') {
         throw new Error('Insufficient balance to deduct that amount.');
      }
      throw new Error('User not found.');
    }

    // Write to the Ledger only if the balance update succeeded
    await client.query(
      "INSERT INTO transactions (user_id, type, amount) VALUES ($1, $2, $3)",
      [user_id, transactionType, amount]
    );

    await client.query('COMMIT'); 

    res.json({ 
      message: `Successfully ${action === 'add' ? 'added' : 'deducted'} ${amount} points.`,
      new_balance: result.rows[0].wallet_balance
    });

  } catch (error) {
    await client.query('ROLLBACK'); 
    res.status(400).json({ error: error.message || 'Transaction failed' });
  } finally {
    client.release();
  }
});

module.exports = router;