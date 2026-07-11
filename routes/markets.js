// routes/markets.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all active markets
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, open_time, close_time, is_active FROM markets WHERE is_active = true ORDER BY open_time ASC"
        );
        res.json(result.rows);
    } catch (err) {
        console.error("🔥 Error fetching markets:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

// 1. ADD A NEW MARKET
router.post('/add', async (req, res) => {
  const { name, open_time, close_time } = req.body;

  if (!name || !open_time || !close_time) {
    return res.status(400).json({ error: 'Name, open_time, and close_time are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO markets (name, open_time, close_time, is_active) VALUES ($1, $2, $3, true) RETURNING *',
      [name, open_time, close_time]
    );
    res.status(201).json({ message: 'Market added successfully', market: result.rows[0] });
  } catch (error) {
    console.error('Error adding market:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. DELETE A MARKET
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

// 3. TOGGLE MARKET STATUS (PAUSE/UNPAUSE)
router.patch('/toggle-status/:id', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body; // Expects true (running) or false (paused)

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