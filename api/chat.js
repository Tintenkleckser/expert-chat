import { handleChat, handleError } from "../server/handlers.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await handleChat(request, response);
  } catch (error) {
    handleError(error, response);
  }
}
