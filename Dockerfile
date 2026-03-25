FROM node:20

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --include=dev

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 9099

CMD ["npm", "start"]
