FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY index.js .
COPY lib ./lib
EXPOSE 3002
CMD ["node", "index.js"]
