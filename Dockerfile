FROM node:20-alpine

WORKDIR /app

# Копируем package.json и ставим только production-зависимости (express и т.д.)
COPY package.json ./
RUN npm install --production

# Копируем сервер и собранный фронт
COPY server.cjs ./
COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "server.cjs"]
