import { handleHealth } from "../server/handlers.js";

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  handleHealth(request, response);
}
