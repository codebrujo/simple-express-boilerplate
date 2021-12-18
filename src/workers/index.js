const path = require('path');
const { v4: uuidv4 } = require('uuid');
const constants = require('../config/constants');
constants.appEntryPoint = path.basename(__filename, '.js');
constants.appProcessId = uuidv4();

// const workers = require('./userEvents');

// start workers
// workers.start();
