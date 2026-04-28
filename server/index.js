import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { handleChat, handleChatStream, handleError, handleHealth } from "./handlers.js";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", handleHealth);

app.post("/api/chat", async (request, response, next) => {
  try {
    await handleChat(request, response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat/stream", async (request, response, next) => {
  try {
    await handleChatStream(request, response);
  } catch (error) {
    if (response.headersSent) {
      response.write(`event: error\n`);
      response.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      response.end();
      return;
    }
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  handleError(error, response);
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Expert Chat API listening on http://127.0.0.1:${config.port}`);
});
