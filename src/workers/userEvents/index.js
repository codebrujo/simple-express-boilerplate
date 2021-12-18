const { Worker } = require('worker_threads');
const PGPubsub = require('pg-pubsub');
const path = require('path');
const db = require("../../models");
const logger = require('../../config/logger');
const { messageTypes, rootWorkerId, aliveTime, logMessage, HTTPErrorHandlerProps } = require('../../config/worker');
const { pgConfig, appProcessId } = require('../../config/constants');
const httpStatus = require('http-status');
const { setTimeout } = require('timers');
const { UserDevice, UserDeviceEvent, User, DevicePropertyValue } = db;

const THIS_THREAD_ID = appProcessId;

const userWorkerPath = path.resolve(__dirname, '.', 'userEvents.worker.js');
const accessTokenPath = path.resolve(__dirname, '.', 'accessToken.worker.js');

const pubsubInstance = new PGPubsub(`postgres://${pgConfig.user}:${pgConfig.passwd}@${pgConfig.host}:${pgConfig.port}/${pgConfig.db}`);

pubsubInstance.addChannel(rootWorkerId, channelPayload => {
  // logMessage(
  //   THIS_THREAD_ID,
  //   `pubsubInstance.addChannel from ${rootWorkerId} ${JSON.stringify(channelPayload)}`
  // );
  handleMessage(channelPayload, rootWorkerId);
});

pubsubInstance.addChannel(THIS_THREAD_ID, channelPayload => {
  // logger.info(`${THIS_THREAD_ID} pubsubInstance.addChannel from ${THIS_THREAD_ID} ${JSON.stringify(channelPayload)}`);
  handleMessage(channelPayload, channelPayload.sender);
});

const workers = [];

let messageQueue = [];
let messageCounter = 0;
let queueCheckInterval;


const handUp = () => {
  const msg = {
    sender: THIS_THREAD_ID,
    recepient: rootWorkerId,
    type: messageTypes.registerNewProcess,
    data: { users: workers.map(item => item.id) },
    timestamp: Date(),
  };
  // logger.info(`${THIS_THREAD_ID} handUp ${JSON.stringify(msg)}`);
  pubsubInstance.publish(rootWorkerId, msg);
}

/**
* Update last child thread run time and running status
*
* @param   {Number}        workerId         Worker ID
*/
const updateKeepAlive = workerId => {
  // logger.info(`${THIS_THREAD_ID} updateKeepAlive from ${workerId}`);
  const workerItem = workers.find(item => item.id === workerId);
  if (!workerItem) return;
  workerItem.running = true;
  workerItem.keepAlive = new Date();
}

/**
* Inactivate particular user device
*
* @param   {Number}        workerId         Worker (User) ID
* @param   {Object}        userDevice       Object with the structure defined in startWorker
*/
const inactivateUserDevice = async (workerId, userDevice) => {
  logMessage(
    THIS_THREAD_ID,
    `inactivateUserDevice: call for id ${userDevice.id}`
  );
  try {
    await UserDevice.setActiveStatus(userDevice.id, false);
    restartListeners(workerId);
  } catch (e) {
    logger.error(`${THIS_THREAD_ID}.worker.inactivateUserDevice ${e.message}`);
  }
}

/**
* Process access token refresh and restarts listeners
*
* @param   {Number}        workerId         Worker ID
* @param   {Object}        userDevice       Object with the structure defined in startWorker
*/
const refreshToken = async workerId => {
  logMessage(
    THIS_THREAD_ID,
    `run refreshToken for userId ${workerId}`
  );
  let userToBeInactivated = false;
  try {
    await User.refreshToken(workerId);
    restartListeners(workerId);
  } catch (e) {
    if (e.status === httpStatus.BAD_REQUEST) {
      userToBeInactivated = true;
    }
  }
  if (userToBeInactivated) {
    logger.info(`${THIS_THREAD_ID}.worker refreshToken user ${workerId} to be deactivated due to HC response error`);
    try {
      await User.changeIsActive(workerId, false);
    } catch (e) {
      logger.error(`${THIS_THREAD_ID}.worker refreshToken/inactivate user ${e.message}`);
    }
  }
}

/**
* Records the consumtion
*
* @param   {Number}        workerId         Worker ID
* @param   {Object}        userDevice       Object with the structure defined in restartListeners
*/
const bookConsumption = async (workerId, userDevice) => {
  logMessage(
    THIS_THREAD_ID,
    `root.worker bookConsumption for device id ${userDevice.id}`
  );
  try {
    await UserDeviceEvent.createRecord(userDevice, UserDeviceEvent.eventTypes.cycle, -1);
    const deviceValueData = await DevicePropertyValue.getByUserDevice(userDevice);
    const userDeviceSummary = await UserDeviceEvent.getSummary(userDevice);
    if(userDeviceSummary.consumablesRemaining <= deviceValueData.orderThreshold) {
      const device = await UserDevice.findByPk(userDevice.id);
      await device.triggerSubscription();
    }
  } catch (e) {
    logger.error(`root.worker.bookConsumption error for userDevice ${userDevice.id}: ${e.message}`);
  }
}



/**
* Restart thread for particular user
*
* @param   {Number}        senderId            ID of source thread
* @param   {Number}        requestedUserId     User ID 
*/
const restartListeners = async (senderId, requestedUserId = null) => {

  const userId = requestedUserId ? requestedUserId : senderId;

  logMessage(
    THIS_THREAD_ID,
    `restartListeners: called for user id ${userId}`
  );
  if (!userId) {
    return;
  }

  const userDevices = await UserDevice.getActiveDevices(userId);
  const workerInd = workers.findIndex(item => item.id === userId);

  if (userDevices.length === 0) {
    stopWorker(userId, false);
    if (workerInd > -1) {
      workers.splice(workerInd, 1);
    }
  } else {
    stopWorker(userId, false, startWorker);
  }
  // console.log(`${THIS_THREAD_ID} restartListeners: workers ${JSON.stringify(workers)}`);
}

/**
* Stop all threads excluding listed in 'exclude' parameter
*
* @param   {Array}         exclude       Numeric array with Id's that needs to be ignored
*/
const stopListening = (exclude = []) => {
  workers.map(item => {
    !exclude.some(el => el === item.id) && stopWorker(item.id, false);
  });
}

/**
* Re-create threads for user id's listed in 'data' array
*
* @param   {Number}        workerId      Worker ID (for message handler API compartibility)
* @param   {Array}         data          Numeric array with userIds.
*/
const initWorkers = async (workerId, data) => {
  if (!data.users) {
    logger.error(`worker ${THIS_THREAD_ID} initWorkers called without user property`);
    return;
  }
  logMessage(
    THIS_THREAD_ID,
    `initWorkers: users count is ${data.users.length}`
  );
  stopListening(data.users);
  data.users.map(async item => {
    restartListeners(item);
  });
}

/**
* Terminate worker
*
* @param   {Number}        workerId      Worker ID to be stopped and created
* @param   {Boolean}       forced        Hard termination mode or not
* @param   {Function}      callback      Function to be called if the thread terminated
*/
const stopWorker = async (workerId, forced = true, callback) => {
  const worker = workers.find(item => item.id === workerId);
  if (!worker) {
    callback && callback(workerId, false);
    return false;
  }
  logger.info(`${THIS_THREAD_ID} run stopWorker for ${workerId} with mode ${forced}`);
  if (!forced) {
    sendMessage(workerId, messageTypes.exit);
    setTimeout(async () => {
      await stopWorker(workerId, true, callback);
    }, 300);
    return true;
  }
  messageQueue = messageQueue.filter(item => {
    return item.recepientItem.id !== userId;
  });
  try {
    worker.worker.terminate();
  } catch (err) { }

  worker.running = false;

  if (callback) {
    setTimeout(() => callback(workerId), 300);
  } else {
    const workerInd = workers.findIndex(item => item.id === workerId);
    if (workerInd > -1) {
      workers.splice(workerInd, 1);
    }
  }
  return true;
};

/**
* Start worker
*
* @param   {Number}        workerId      Worker ID to be stopped and created
*/
const startWorker = async workerId => {
  // logger.info(`${THIS_THREAD_ID} startWorker: worker ${workerId}`);
  const worker = workers.find(item => item.id === workerId);
  await createWorker(userWorkerPath, workerId, worker);

  const userDevices = await UserDevice.getActiveDevices(workerId);
  if (!userDevices) {
    return;
  }
  const data = userDevices.reduce((init, item) => {
    init.push({
      id: item.id,
      Device: {
        id: item.Device.id,
        name: item.Device.name,
        haId: item.Device.haId,
      },
      User: {
        id: item.User.id,
        oauthToken: item.User.oauthToken,
      }
    })
    return init;
  }, []);
  // logger.info(`${THIS_THREAD_ID} startWorker: send restart for worker ${workerId}`);
  sendMessage(workerId, messageTypes.restartListeners, data);
};

/**
* Terminates worker if running and start a new instance
*
* @param   {Number}        workerId      Worker ID to be stopped and created
*/
const restartWorker = async workerId => {
  // logger.info(`${THIS_THREAD_ID} run restartWorker for ${workerId} with mode ${forced}`);
  stopWorker(workerId, true, startWorker);
};

/**
* List of available message handlers
*/
const messageHandlers = {
  [messageTypes.info]: logMessage,
  [messageTypes.restartListeners]: restartListeners,
  [messageTypes.keepAlive]: updateKeepAlive,
  [messageTypes.refreshToken]: refreshToken,
  [messageTypes.bookConsumption]: bookConsumption,
  [messageTypes.inactivateUserDevice]: inactivateUserDevice,
  [messageTypes.handUp]: handUp,
  [messageTypes.stopListening]: stopListening,
  [messageTypes.updateUsers]: initWorkers,
}

/**
* Handles incoming message
* If the message directed to this process call appropriate processor in accordance to incoming message type
* In other case forwards the message to another recipient (if exists)
*
* @param   {Object}        msg           Incoming message
* @param   {Number}        workerId      Worker ID who posted an incoming message
*/
const handleMessage = (msg, workerId) => {
  // logger.info(`${THIS_THREAD_ID} run handleMessage from ${workerId} ${JSON.stringify(msg)}`);
  if (msg.sender && msg.sender === THIS_THREAD_ID) {
    return;
  }
  if (msg.recepient && msg.recepient !== THIS_THREAD_ID) {
    const recepientItem = workers.find(item => item.id === msg.recepient);
    if (!recepientItem) {
      // logger.info(`${THIS_THREAD_ID} stop running handleMessage (!recepientItem) from ${workerId} ${JSON.stringify(msg)}`);
      return;
    }
    forwardMessage(recepientItem, message);
    logger.info(`${THIS_THREAD_ID} run handleMessage from ${workerId} forwardMessage`);
    return;
  }
  if (messageHandlers[msg.type]) {
    messageHandlers[msg.type](workerId, msg.data);
    return;
  }
  logger.error(`${THIS_THREAD_ID}: unhandled message from worker ${workerId}: ${msg}`);
}

/**
* Handles worker thread exit event
*
* @param   {Number}        code          Worker's exit code
* @param   {Number}        workerId      Stopped Worker ID
*/
const handleWorkerStop = (code, workerId) => {
  if (code !== 0) {
    logger.error(`${THIS_THREAD_ID} handleWorkerStop: worker ${workerId} stopped with exit code ${code}`);
  }
  const worker = workers.find(item => item.id === workerId);
  if (worker) {
    worker.running = false;
  }
  logMessage(
    THIS_THREAD_ID,
    `worker ${workerId} stopped with exit code ${code}`
  );
};

/**
* Posts a message to defined worker
* All messages are objects with the following structure:
* - sender, worker Id who sends the message
* - recepient, recipient Id
* - type, type enum as defined in messageTypes
* - data, an object with supported data types (https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
* - timestamp, date time of the message
*
* In case the worker is unavailable the message is put to the queue and will be processed
* when the worker is up and running
*
* @param   {Number}        recepientId      ID of the recipient
* @param   {String}        type             Message type as defined in messageTypes
* @param   {Any}           data             See type restrictions above
*/
const sendMessage = async (recepientId, type, data) => {
  // logger.info(`${THIS_THREAD_ID} run sendMessage ${type} to ${recepientId} ${JSON.stringify(data)}`);
  const recepientItem = workers.find(item => item.id === recepientId);
  if (!recepientItem) {
    return false;
  }
  const msg = {
    sender: THIS_THREAD_ID,
    recepient: recepientId,
    type,
    data,
    timestamp: Date(),
  };
  try { recepientItem.worker.postMessage(msg); } catch (e) {
    recepientItem.running = false;
    putInQueue(recepientItem, msg);
    restartWorker(recepientId);
  }
  return true;
};

/**
* Put the message to the queue
*
* @param   {Object}        recepientItem      Item of workers array
* @param   {Object}        msg                Message for deferred post
*/
const putInQueue = (recepientItem, msg) => {
  // logger.info(`${THIS_THREAD_ID} run putInQueue for ${recepientItem.id} ${JSON.stringify(msg)}`);
  messageQueue.push({ id: ++messageCounter, recepientItem, msg });
};

/**
* Forward the message to the given recipient
*
* @param   {Object}        recepientItem      Item of workers array
* @param   {Object}        message            Message to be forwarded
*/
const forwardMessage = async (recepientItem, message) => {
  // logger.info(`${THIS_THREAD_ID} run forwardMessage for ${recepientItem.id} ${JSON.stringify(message)}`);
  try {
    recepientItem.worker.postMessage(message);
  } catch (e) {
    recepientItem.running = false;
    putInQueue(recepientItem, message);
  }
};

/**
* Routine reads the message queue on periodic basis and tries to re-send messages if any
*
*/
const readMessageQueue = () => {
  // logger.info(`${THIS_THREAD_ID} run readMessageQueue`);
  if (!messageQueue.length) {
    messageCounter = 0;
  }
  workers.map(item => {
    item.running = item.isRunning();
  });
  messageQueue = messageQueue.reduce((previousValue, queueItem) => {
    const recepientItem = workers.find(item => item.id === queueItem.msg.recepient);
    if (recepientItem.running) {
      forwardMessage(queueItem.recepientItem, queueItem.msg);
    } else {
      previousValue.push(queueItem);
    }
    return previousValue;
  }, []);
};

/**
* Creates a new worker
*
* @param   {String}        filePath           Path to the worker's file
* @param   {Object}        workerId           Id of the worker
* @param   {Object}        ref                Reference to the workers array item (optional)
*/
const createWorker = (filePath, workerId, ref) => {
  logMessage(
    THIS_THREAD_ID,
    `create: a new worker with id ${workerId}`
  );
  return new Promise((resolve, reject) => {
    if (!workerId) {
      logger.error(`${THIS_THREAD_ID}.worker create: rejected as id is empty`);
      reject(new Error('No worker id defined'));
      return;
    }
    resolve(new Worker(filePath, { workerData: { workerId, owner: THIS_THREAD_ID } }));
  }).then((worker) => {
    worker.on('message', (msg) => handleMessage(msg, workerId));
    worker.on('error', (err) => logger.error(`${THIS_THREAD_ID}: ${workerId}: ${err}`));
    worker.on('exit', (code) => handleWorkerStop(code, workerId));
    if (ref) {
      ref.worker = worker;
      ref.running = true;
    } else {
      workers.push({
        id: workerId,
        worker,
        running: true,
        keepAlive: new Date(),
        isRunning: function () {
          return (new Date()) - this.keepAlive < aliveTime ? true : false;
        },
      });
    }
  }).catch(err => {
    logger.error(`${THIS_THREAD_ID}: Failed to create worker ${workerId} 
    ${err}`);
  });
};

/**
* This routine creates workers for every active user and starts listeners
* To be called straight after the module initially loaded
*/
exports.start = async () => {
  logMessage(
    THIS_THREAD_ID,
    'start: process init'
  );
  if (queueCheckInterval) {
    clearInterval(queueCheckInterval);
    queueCheckInterval = null;
  }
  workers.map(item => {
    if (item.running) {
      sendMessage(item.id, messageTypes.exit);
    }
  });
  workers.splice(0, workers.length);

  queueCheckInterval = setInterval(() => {
    readMessageQueue();
  }, 5000);

  handUp();

  new Worker(accessTokenPath);
};

setInterval(() => {
  workers.map(async item => {
    if (!item.isRunning()) {
      restartWorker(item.id);
      setTimeout(() => {
        restartListeners(item.id)
      }, HTTPErrorHandlerProps.multiplierDelay);
    }
  });
}, aliveTime * HTTPErrorHandlerProps.connectionAttempts);

setInterval(() => {
  handUp();
}, aliveTime);

