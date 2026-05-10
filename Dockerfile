FROM node:20-alpine

WORKDIR /app

# Устанавливаем только express (для server.cjs)
RUN npm install express

# Копируем сервер и собранный фронт
COPY server.cjs ./
COPY dist/ ./dist/

EXPOSE 3010

CMD ["node", "server.cjs"]
