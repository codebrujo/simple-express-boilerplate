const { workerData, parentPort } = require('worker_threads');
const httpStatus = require("http-status");
const logger = require('../../config/logger');
const { homeConnectConfig } = require('../../config/constants');
const { normalizeChunkData } = require('../../utils/chunkProcessing');
const http = homeConnectConfig.isMock ? require('http') :  require('https');
const {
  messageTypes,
  streamHeaders,
  eventDetails,
  logMessage,
  HTTPErrorHandlerProps,
} = require('../../config/worker');

const THIS_THREAD_ID = workerData.workerId;
const rootWorkerId = workerData.owner;

const requests = [];

const processChunk = (userDevice, chunk) => {
  const events = normalizeChunkData(chunk);
  if (!events) {
    return;
  }
  events.forEach(event => {
    if (event.key && event.value) {
      if (event.key === eventDetails.finished.key && event.value === eventDetails.finished.value) {
        sendMessage(userDevice, messageTypes.bookConsumption);
      }
    }
  });
}

const defineUrl = (userDevice) => {
  if (homeConnectConfig.isMock) {
    return `${homeConnectConfig.mockEventServerUrl}/events`;
  } else {
    return `${homeConnectConfig.apiUrl}${homeConnectConfig.homeappliancesUrl}/${userDevice.Device.haId}/events`;
  }
}

const handleRequestOnEnd = (res, userDevice) => {
  if (res.statusCode !== httpStatus.OK) {
    sendMessage(`Listener for ${userDevice.Device.haId} terminated with error code ${res.statusCode}`);
  }
  if (res.statusCode === httpStatus.UNAUTHORIZED) {
    sendMessage(userDevice, messageTypes.refreshToken);
  } else if (res.statusCode === httpStatus.OK) {
    startListener(userDevice);
  } else {
    sendMessage(userDevice, messageTypes.inactivateUserDevice);
  }
}

const handleRequestOnError = (req, userDevice, e) => {
  if (req.destroyed) return;
  if (!userDevice['HTTPErrors']) {
    userDevice['HTTPErrors'] = 0;
  }
  userDevice['HTTPErrors'] += 1;
  if (userDevice['HTTPErrors'] <= HTTPErrorHandlerProps.connectionAttempts) {
    const restartTime = HTTPErrorHandlerProps.delay + HTTPErrorHandlerProps.multiplierDelay * userDevice['HTTPErrors'];
    setTimeout(() => startListener(userDevice), restartTime);
    logger.error(`Request for userDevice ${userDevice.id} terminated: ${e.message}. Retrying in ${restartTime} ms. Attempt ${userDevice['HTTPErrors']}`);
  } else {
    req.destroy();
  }
}

const startListener = async userDevice => {
  const options = {
    headers: {
      ...streamHeaders,
      'Authorization': `Bearer ${userDevice.User.oauthToken}`
      }
  };
  const req = http.request(
    defineUrl(userDevice),
    options,
    function (res) {
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        if (res.statusCode === httpStatus.OK) {
          processChunk(userDevice, chunk);
        }
      });
      res.on('end', function () {
        handleRequestOnEnd(res, userDevice);
      });
    }
  );
  req.on('error', (e) => {
    handleRequestOnError(req, userDevice, e);
  });
  req.end();
  req.on('response', (res, socket, head) => {
    userDevice['HTTPErrors'] = null;
    sendMessage(`Listener for ${userDevice.Device.haId} connected`);
  });
  const userDeviceRequest = requests.find(item => item.userDevice === userDevice);
  if (userDeviceRequest && userDeviceRequest.req !== req) {
    userDeviceRequest.req.destroy();
    userDeviceRequest.req = req;
  } else {
    requests.push({userDevice, req});
  }
}

const destroyExistingRequests = () => {
  requests.forEach(item => {
    try {
      item.req.destroy();
    } catch { }
  });
}

const initListeners = (data) => {
  destroyExistingRequests();
  requests.splice(0, requests.length);
  data.map(userDevice => {
    startListener(userDevice);
  });
}

const processExit = () => {
  destroyExistingRequests();
  process.exit(0);
}

/**
* List of available message processors
*/
const messageProcessors = {
  [messageTypes.info]: logMessage,
  [messageTypes.restartListeners]: initListeners,
  [messageTypes.exit]: processExit,
}

/**
* Handles incoming message
* Call appropriate message processor in accordance to incoming message type
*
* @param   {Object}        msg           Incoming message
*/
const handleMessage = msg => {
  if (messageProcessors[msg.type]) {
    messageProcessors[msg.type](msg.data);
    return;
  }
  logger.error(`${THIS_THREAD_ID}: unhandled message from worker ${workerId}: ${msg}`);
}

/**
* Post message to root process
*
* @param   {Any}        data           An object with supported data types (https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
* @param   {String}     type           eventTypes enum item
* @param   {Object}     recepient      Recipient worker id (root process as default)
*/
const sendMessage = async (data, type = messageTypes.info, recepient = rootWorkerId) => {
  parentPort.postMessage({
    recepient,
    type,
    data,
    timestamp: Date(),
   });
};

/**
 * System handlers
 * @private
 */
process.on('disconnect', () => {
  logger.error(`Thread ${THIS_THREAD_ID} is disconnected from parent process. Exitting...`);
  process.exit();
});
parentPort.on('message', (msg) => {
  if (typeof msg === 'object') {
      handleMessage(msg);
  } else {
      logger.error(`${THIS_THREAD_ID} unhandled message: ${msg}`);
  }
});
sendMessage(`Worker ${THIS_THREAD_ID} started `);

setInterval(() => {
  sendMessage('', messageTypes.keepAlive);
}, 3000);
