const httpStatus = require('http-status');

const { getUserAuthStatus } = require('../services/user.service');
const logger = require('../config/logger');
const APIError = require('../utils/APIError');

const db = require('../models');
const { User } = db;

const ADMIN = 'admin';
const LOGGED_USER = '_loggedUser';

exports.ADMIN = ADMIN;
exports.LOGGED_USER = LOGGED_USER;

function getModuleError(initError, message, fnName, res, status, stack) {
  const source = `${fnName}.auth.middleware`;
  const traceId = res.locals.traceId;
  const e = new APIError({
    message,
    status,
    stack,
    source,
    traceId,
  });
  e.combineProps(initError);
  return e;
}

exports.authorize = async (role = LOGGED_USER) => {
  return (req, res, next) => {
    const response = getUserAuthStatus(req.user);
    if (response.authStatus) {
      return next();
    } else {
      res.status(httpStatus.UNAUTHORIZED);
      res.json(response);
      return;
    }
  };
};

exports.checkRole = (role) => {
  return (req, res, next) => {
    const { user } = req;
    const userRole = user ? user.role : null;
    if (role) {
      if (!userRole) {
        return next(
          getModuleError(
            null,
            'Unathorized',
            'checkRole',
            res,
            httpStatus.UNAUTHORIZED
          )
        );
      }
      if (role === LOGGED_USER || role === userRole) {
        // only logged user can access the data
        return next();
      }
      if (role === ADMIN) {
        // only admin can access the data
        if (!user.isAdmin()) {
          return next(
            getModuleError(
              null,
              'No rights to process the request',
              'checkRole',
              res,
              httpStatus.FORBIDDEN
            )
          );
        }
      }
    }
    // any user can access the data
    return next();
  };
};

exports.checkAuthorization = async (req, res, next) => {
  //if (isSessionDisabled) {
    // res.status(httpStatus.OK);
    // const [user] = await User.findOrCreate({
    //   where: {
    //     id: 1,
    //   },
    //   defaults: {
    //     isActive: true,
    //     properties: await User.getDefaultProperties(),
    //     subscriptionDetails: {},
    //     role: User.getRoles()[0],
    //     oauthId: mockUserDefaults.oauthId,
    //     oauthToken: mockUserDefaults.oauthToken,
    //     oauthTokenExp: mockUserDefaults.oauthTokenExp,
    //     oauthRefreshToken: mockUserDefaults.oauthRefreshToken,
    //   },
    // });
    // req.user = user;
    // return next();
  //}
  const response = getUserAuthStatus(req.user);
  if (response.authStatus) {
    return next();
  } else {
    res.status(httpStatus.UNAUTHORIZED);
    res.json(response);
    return;
  }
};
