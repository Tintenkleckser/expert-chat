import { assertRuntimeConfig, config } from "./config.js";
import { answerWithContext, streamAnswerWithContext } from "./llm.js";
import { retrieveBalancedContext } from "./retrieval.js";

const NO_CONTEXT_MESSAGE =
  "Ich habe in den angebundenen Quellen keine ausreichend belastbare Stelle gefunden. Bitte formulieren Sie die Frage enger oder prüfen Sie die Wissensbasis.";

export function handleHealth(_request, response) {
  response.json({
    ok: true,
    provider: config.llm.provider,
    sources: config.sources
  });
}

export async function handleChat(request, response) {
  assertRuntimeConfig();

  const question = extractQuestion(request);
  if (!question) {
    response.status(400).json({ error: "Eine Frage ist erforderlich." });
    return;
  }

  const { contexts, diagnostics } = await retrieveBalancedContext(question);

  if (contexts.length === 0) {
    response.json({
      answer: NO_CONTEXT_MESSAGE,
      contexts,
      diagnostics
    });
    return;
  }

  const answer = await answerWithContext({ question, contexts });
  response.json({ answer, contexts, diagnostics });
}

export async function handleChatStream(request, response) {
  assertRuntimeConfig();

  const question = extractQuestion(request);
  if (!question) {
    response.status(400).json({ error: "Eine Frage ist erforderlich." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  const sendEvent = (event, data) => {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const { contexts, diagnostics } = await retrieveBalancedContext(question);
  sendEvent("meta", { contexts, diagnostics });

  if (contexts.length === 0) {
    sendEvent("token", { token: NO_CONTEXT_MESSAGE });
    sendEvent("done", {});
    response.end();
    return;
  }

  await streamAnswerWithContext({
    question,
    contexts,
    onToken: (token) => sendEvent("token", { token })
  });

  sendEvent("done", {});
  response.end();
}

export function handleError(error, response) {
  const status = error.status || 500;
  response.status(status).json({
    error: error.message || "Unerwarteter Serverfehler"
  });
}

function extractQuestion(request) {
  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body;
  return String(body?.question || "").trim();
}
