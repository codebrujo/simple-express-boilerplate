FROM node:14-alpine

USER node

COPY --chown=node:node . /home/node/simple-express-boilerplate

WORKDIR /home/node/simple-express-boilerplate

RUN npm ci

EXPOSE 8080

ENTRYPOINT ["npm", "run", "server"]
