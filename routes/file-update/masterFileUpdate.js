const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { masterFileUpdate } = require('../../controllers/file-update/masterFileUpdate');

router.post('/', verifyToken, masterFileUpdate);
module.exports = router;


