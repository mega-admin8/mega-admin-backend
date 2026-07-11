const express = require('express');
const cors = require('cors');
const pool = require('./db');
const path = require('path');
require('dotenv').config();
const authRoutes = require('./routes/auth');
const bidRoutes = require('./routes/bids');
const adminRoutes = require('./routes/admin');
const marketsRoutes = require('./routes/markets');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
// app.use('/uploads', express.static('uploads'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/admin/users', require('./routes/adminUsers'));
app.use('/api/user', require('./routes/user'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 MegaPlay Server running on port ${PORT}`);
});