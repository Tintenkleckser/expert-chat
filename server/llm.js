import { Mistral } from "@mistralai/mistralai";
import OpenAI from "openai";
import { config } from "./config.js";

let mistralClient;
let openaiClient;

function getMistral() {
  if (!mistralClient) {
    mistralClient = new Mistral({ apiKey: config.llm.mistralApiKey });
  }
  return mistralClient;
}

function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.llm.openaiApiKey });
  }
  return openaiClient;
}

export async function embedText(text) {
  if (config.llm.provider === "openai") {
    const response = await getOpenAI().embeddings.create({
      model: config.llm.openaiEmbeddingModel,
      input: text
    });
    return response.data[0].embedding;
  }

  const response = await getMistral().embeddings.create({
    model: config.llm.mistralEmbeddingModel,
    inputs: [text]
  });
  return response.data[0].embedding;
}

export async function answerWithContext({ question, contexts }) {
  const messages = [
    {
      role: "system",
      content: [
        "Sie sind ein präziser deutschsprachiger Fachassistent.",
        "Sprechen Sie Nutzerinnen und Nutzer immer formell mit Sie an.",
        "Antworte ausschließlich auf Grundlage der bereitgestellten Quellen.",
        "Wenn beide Quellen relevant sind, integriere beide sichtbar.",
        "Wenn Quellen überlappen, benenne die Überschneidung statt eine Quelle zu bevorzugen.",
        "Wenn die Quellen keine belastbare Antwort enthalten, sage das klar.",
        "Nutze kurze Abschnitte und nenne am Ende die verwendeten Quellen.",
        "Wenn nach einem Formular, Bogen, Beobachtungsbogen, Bewertungsbogen, Checkliste oder Raster gefragt wird, gib das Ergebnis bevorzugt als Markdown-Tabelle aus."
      ].join(" ")
    },
    {
      role: "user",
      content: buildPrompt(question, contexts)
    }
  ];

  if (config.llm.provider === "openai") {
    const response = await getOpenAI().chat.completions.create({
      model: config.llm.openaiChatModel,
      temperature: 0.2,
      messages
    });
    return response.choices[0].message.content;
  }

  const response = await getMistral().chat.complete({
    model: config.llm.mistralChatModel,
    temperature: 0.2,
    messages
  });
  return response.choices[0].message.content;
}

export async function streamAnswerWithContext({ question, contexts, onToken }) {
  const messages = [
    {
      role: "system",
      content: [
        "Sie sind ein präziser deutschsprachiger Fachassistent.",
        "Sprechen Sie Nutzerinnen und Nutzer immer formell mit Sie an.",
        "Antworte ausschließlich auf Grundlage der bereitgestellten Quellen.",
        "Wenn beide Quellen relevant sind, integriere beide sichtbar.",
        "Wenn Quellen überlappen, benenne die Überschneidung statt eine Quelle zu bevorzugen.",
        "Wenn die Quellen keine belastbare Antwort enthalten, sage das klar.",
        "Formatiere die Antwort in Markdown mit kurzen Abschnitten.",
        "Wenn nach einem Formular, Bogen, Beobachtungsbogen, Bewertungsbogen, Checkliste oder Raster gefragt wird, gib das Ergebnis bevorzugt als Markdown-Tabelle aus.",
        "Nutze Quellenverweise im Format [1], [2]."
      ].join(" ")
    },
    {
      role: "user",
      content: buildPrompt(question, contexts)
    }
  ];

  if (config.llm.provider === "openai") {
    const stream = await getOpenAI().chat.completions.create({
      model: config.llm.openaiChatModel,
      temperature: 0.2,
      stream: true,
      messages
    });

    for await (const event of stream) {
      const token = event.choices?.[0]?.delta?.content;
      if (token) onToken(token);
    }
    return;
  }

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.mistralApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.llm.mistralChatModel,
      temperature: 0.2,
      stream: true,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`Mistral streaming failed: ${response.status} ${await response.text()}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;

      const event = JSON.parse(data);
      const token = event.choices?.[0]?.delta?.content;
      if (token) onToken(token);
    }
  }
}

function buildPrompt(question, contexts) {
  const sourceBlocks = contexts
    .map((item, index) => {
      const title = item.title ? `, Titel: ${item.title}` : "";
      const section = item.section ? `, Abschnitt: ${item.section}` : "";
      const similarity = Number.isFinite(item.similarity)
        ? `, Score: ${item.similarity.toFixed(3)}`
        : "";

      return [
        `[${index + 1}] Quelle: ${item.source}${title}${section}${similarity}`,
        item.content
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Frage: ${question}`,
    "",
    "Gefundene Quellenstellen:",
    sourceBlocks,
    "",
    "Aufgabe:",
    "1. Beantworten Sie die Frage fachlich korrekt und verwenden Sie durchgehend die formelle Sie-Ansprache.",
    "2. Unterscheide bei Bedarf zwischen DIK und Handbuch.",
    "3. Nutze Markdown. Verwende Tabellen für Formulare, Beobachtungsbögen, Bewertungsraster, Checklisten und strukturierte Programme.",
    "4. Nutze Quellenverweise im Format [1], [2].",
    "5. Erfinde keine Inhalte außerhalb der Quellenstellen."
  ].join("\n");
}
