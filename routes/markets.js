// // routes/markets.js
// const express = require('express');
// const router = express.Router();
// const pool = require('../db');

// // GET all active markets
// router.get('/', async (req, res) => {
//     try {
//         const result = await pool.query(
//             "SELECT id, name, open_time, close_time, is_active FROM markets WHERE is_active = true ORDER BY open_time ASC"
//         );
//         res.json(result.rows);
//     } catch (err) {
//         console.error("🔥 Error fetching markets:", err.message);
//         res.status(500).json({ error: "Server Error" });
//     }
// });

// // 1. ADD A NEW MARKET
// router.post('/add', async (req, res) => {
//   const { name, open_time, close_time } = req.body;

//   if (!name || !open_time || !close_time) {
//     return res.status(400).json({ error: 'Name, open_time, and close_time are required' });
//   }

//   try {
//     const result = await pool.query(
//       'INSERT INTO markets (name, open_time, close_time, is_active) VALUES ($1, $2, $3, true) RETURNING *',
//       [name, open_time, close_time]
//     );
//     res.status(201).json({ message: 'Market added successfully', market: result.rows[0] });
//   } catch (error) {
//     console.error('Error adding market:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

// // 2. DELETE A MARKET
// router.delete('/delete/:id', async (req, res) => {
//   const { id } = req.params;

//   try {
//     const result = await pool.query('DELETE FROM markets WHERE id = $1 RETURNING *', [id]);
    
//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Market not found' });
//     }
    
//     res.json({ message: 'Market deleted successfully' });
//   } catch (error) {
//     console.error('Error deleting market:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

// // 3. TOGGLE MARKET STATUS (PAUSE/UNPAUSE)
// router.patch('/toggle-status/:id', async (req, res) => {
//   const { id } = req.params;
//   const { is_active } = req.body; // Expects true (running) or false (paused)

//   if (typeof is_active !== 'boolean') {
//     return res.status(400).json({ error: 'is_active must be a boolean' });
//   }

//   try {
//     const result = await pool.query(
//       'UPDATE markets SET is_active = $1 WHERE id = $2 RETURNING *',
//       [is_active, id]
//     );

//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Market not found' });
//     }

//     res.json({ 
//       message: `Market is now ${is_active ? 'Active' : 'Paused'}`, 
//       market: result.rows[0] 
//     });
//   } catch (error) {
//     console.error('Error updating market status:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

// module.exports = router;




















const express = require('express');
const router = express.Router();
const pool = require('../db');

// Helper function to derive Modulo 10 single digit from a 3-digit Pana
const getMod10Digit = (panaStr) => {
  if (!panaStr || panaStr.length < 3) return "*";
  const sum = panaStr.split("").reduce((acc, digit) => acc + parseInt(digit, 10), 0);
  return (sum % 10).toString();
};

// 1. GET ALL MARKETS WITH TODAY'S RESULTS & FORMATTED DISPLAY
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        m.id,
        m.name,
        m.open_time,
        m.close_time,
        m.open_result_time,
        m.close_result_time,
        m.is_active,
        r_open.winning_number AS open_pana,
        r_close.winning_number AS close_pana
      FROM markets m
      LEFT JOIN results r_open ON r_open.market_id = m.id 
        AND UPPER(r_open.session) = 'OPEN' 
        AND DATE(r_open.declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
      LEFT JOIN results r_close ON r_close.market_id = m.id 
        AND UPPER(r_close.session) = 'CLOSE' 
        AND DATE(r_close.declared_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
      ORDER BY m.id ASC;
    `;

    const result = await pool.query(query);

    const formattedMarkets = result.rows.map((market) => {
      const openPana = market.open_pana;
      const closePana = market.close_pana;

      const openDigit = getMod10Digit(openPana);
      const closeDigit = getMod10Digit(closePana);

      // Produces formatted string like "126-99-180" or "***-**-***"
      const resultDisplay = `${openPana || "***"}-${openDigit}${closeDigit}-${closePana || "***"}`;

      return {
        id: market.id,
        name: market.name,
        open_time: market.open_time,
        close_time: market.close_time,
        open_result_time: market.open_result_time,
        close_result_time: market.close_result_time,
        is_active: market.is_active,
        open_pana: openPana,
        close_pana: closePana,
        result_display: resultDisplay
      };
    });

    res.json(formattedMarkets);
  } catch (err) {
    console.error("🔥 Error fetching markets:", err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

// 2. ADD A NEW MARKET
router.post('/add', async (req, res) => {
  const { name, open_time, close_time, open_result_time, close_result_time } = req.body;

  if (!name || !open_time || !close_time) {
    return res.status(400).json({ error: 'Name, open_time, and close_time are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO markets (name, open_time, close_time, open_result_time, close_result_time, is_active) 
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [name, open_time, close_time, open_result_time || null, close_result_time || null]
    );
    res.status(201).json({ message: 'Market added successfully', market: result.rows[0] });
  } catch (error) {
    console.error('Error adding market:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. EDIT / UPDATE MARKET DETAILS
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { name, open_time, close_time, open_result_time, close_result_time } = req.body;

  if (!name || !open_time || !close_time) {
    return res.status(400).json({ error: 'Name, open_time, and close_time are required' });
  }

  try {
    const result = await pool.query(
      `UPDATE markets 
       SET name = $1, 
           open_time = $2, 
           close_time = $3, 
           open_result_time = $4, 
           close_result_time = $5 
       WHERE id = $6 RETURNING *`,
      [name, open_time, close_time, open_result_time || null, close_result_time || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    res.json({ message: 'Market updated successfully', market: result.rows[0] });
  } catch (error) {
    console.error('Error updating market:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4. DELETE A MARKET
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM markets WHERE id = $1 RETURNING *', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }
    
    res.json({ message: 'Market deleted successfully' });
  } catch (error) {
    console.error('Error deleting market:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 5. TOGGLE MARKET STATUS (PAUSE/UNPAUSE)
router.patch('/toggle-status/:id', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean' });
  }

  try {
    const result = await pool.query(
      'UPDATE markets SET is_active = $1 WHERE id = $2 RETURNING *',
      [is_active, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    res.json({ 
      message: `Market is now ${is_active ? 'Active' : 'Paused'}`, 
      market: result.rows[0] 
    });
  } catch (error) {
    console.error('Error updating market status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;