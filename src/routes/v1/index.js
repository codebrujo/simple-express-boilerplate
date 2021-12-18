const express = require('express');
const adminRoutes = require('./admin.route');

const router = express.Router();

/**
 * GET v1/status
 */
router.get('/status', (req, res) => res.send('OK'));

/**
 * GET v1/admin
 */
router.use('/admin', adminRoutes);

module.exports = router;