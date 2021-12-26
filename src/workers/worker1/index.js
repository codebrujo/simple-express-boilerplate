const { workerData, parentPort } = require('worker_threads');
const httpStatus = require("http-status");
const logger = require('../../config/logger');
const {
  messageTypes,
} = require('../../config/worker');
const { newMessage } = require('../../utils/workersMessage');
const { aliveTime } = require('../../config/worker');

const THIS_THREAD_ID = workerData.workerId;
const rootWorkerId = workerData.owner;

const intervals = [];

const clearIntervals = () => {
  intervals.forEach((interval) => {
    clearInterval(interval);
  });
  intervals.splice(0, intervals.length);
};

const processExit = () => {
  clearIntervals();
  process.exit(0);
}

/**
* Worker entry point
*/
const run = () => {

}

/**
* Worker entry point
*/
const logMessage = (msg) => {
  logger.info(msg.data)
};

/**
* List of available message processors
*/
const messageProcessors = {
  [messageTypes.info]: logMessage,
  [messageTypes.run]: run,
  [messageTypes.exit]: processExit,
};

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
  parentPort.postMessage(newMessage(THIS_THREAD_ID, recepient, type, data));
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

sendMessage(`Worker ${THIS_THREAD_ID} started`);

intervals.push(
  setInterval(() => {
    sendMessage(`Worker ${THIS_THREAD_ID} is running`, messageTypes.keepAlive);
  }, aliveTime / 2)
);
