import { handleChatStream } from "../../server/handlers.js";

export const config = {
  maxDuration: 60
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await handleChatStream(request, response);
  } catch (error) {
    if (response.headersSent) {
      response.write("event: error\n");
      response.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      response.end();
      return;
    }

    response.status(error.status || 500).json({
      error: error.message || "Unerwarteter Serverfehler"
    });
  }
}
