FROM node:18-buster
RUN mkdir /app
WORKDIR /app
COPY ./package.json ./
RUN npm install --legacy-peer-deps
RUN npm install -g serve
