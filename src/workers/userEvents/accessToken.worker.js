const cron = require('node-cron');
const moment = require('moment');
const { Op } = require("sequelize");
const db = require("../../models");
const logger = require('../../config/logger');
const { cronPeriodicity, minTokenExpiresAtDays } = require('../../config/worker');
const { ShopUser, Shop } = db;
const { customerAccessTokenRenew } = require('../../services/shopify.service');

const task = cron.schedule(cronPeriodicity, async () => {
  const shopUsers =  await ShopUser.findAll({
    where: {
      tokenExpiresAt: {
         [Op.lte]: moment.utc().add(minTokenExpiresAtDays,'days')
      }
    }
  });

  shopUsers.map(async shopUser => {
    try {
      const userToken = shopUser.getToken();
      const shop = await Shop.findByPk(shopUser.ShopId);
      const data = await customerAccessTokenRenew(shop, userToken);

      if(data.data.customerAccessTokenRenew.customerAccessToken){
        const { accessToken, expiresAt } = data.data.customerAccessTokenRenew.customerAccessToken;
        shopUser.setToken(accessToken, expiresAt);
      }
    } catch (error) {
      logger.error(error);
    }
  });
});

task.start();
