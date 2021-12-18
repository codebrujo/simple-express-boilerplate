const logger = require('./logger');
const { env } = require('./constants');

exports.messageTypes = {
  info: 'info',
  restartListeners: 'restartListeners',
  keepAlive: 'keepAlive',
  exit: 'exit',
  refreshToken: 'refreshToken',
  bookConsumption: 'bookConsumption',
  inactivateUserDevice: 'inactivateUserDevice',
  registerNewProcess: 'registerNewProcess',
  updateProcess: 'updateProcess',
  handUp: 'handUp',
  updateUsers: 'updateUsers',
  stopListening: 'stopListening',
};

exports.rootWorkerId = 'root';

exports.aliveTime = 10000;

exports.aliveCheckTime = 12000;

exports.streamHeaders = {
  'Accept': 'text/event-stream',
};

exports.HTTPErrorHandlerProps = {
  delay: 5000,
  multiplierDelay: 2000,
  connectionAttempts: 5,
};

exports.eventDetails = {
  finished: {
    key: 'BSH.Common.Status.OperationState',
    value: 'BSH.Common.EnumType.OperationState.Finished'
  },
  activeProgram: {
    key: 'BSH.Common.Root.ActiveProgram',
    value: ''
  },
  aborting: {
    key: 'BSH.Common.Status.OperationState',
    value: 'BSH.Common.EnumType.OperationState.Aborting'
  },
};

exports.eventTypes = [
  'STATUS',
  'NOTIFY',
];

/**
* Put the message to the log
*
* @param   {Number}        workerId         Worker ID
* @param   {Any}           data             Message to be put in log
*/
exports.logMessage = (workerId, data) => {
  if (env === 'development') {
    logger.info(`Message from ${workerId}: ${data}`);
  }
}

exports.exitCodes = {
  CODE_SUCCESS: 0,
};

exports.readMessageQueueInterval = 5000;

exports.cronPeriodicity = '* * 1 * *';
exports.minTokenExpiresAtDays = 3;
