import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const PER_SOURCE_LIMIT = 5;
const MIN_SCORE = 0.15;
const NO_CONTEXT_MESSAGE =
  "Ich habe in den angebundenen Quellen keine ausreichend belastbare Stelle gefunden. Bitte formulieren Sie die Frage enger oder prüfen Sie die Wissensbasis.";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertRuntimeConfig();

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Nicht angemeldet." }, 401);
    }

    const { question } = await request.json();
    const normalizedQuestion = String(question || "").trim();

    if (!normalizedQuestion) {
      return jsonResponse({ error: "Eine Frage ist erforderlich." }, 400);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const { contexts, diagnostics } = await retrieveBalancedContext(normalizedQuestion);
          sendEvent("meta", { contexts, diagnostics });

          if (contexts.length === 0) {
            sendEvent("token", { token: NO_CONTEXT_MESSAGE });
            sendEvent("done", {});
            controller.close();
            return;
          }

          await streamAnswerWithContext({
            question: normalizedQuestion,
            contexts,
            onToken: (token) => sendEvent("token", { token })
          });

          sendEvent("done", {});
          controller.close();
        } catch (error) {
          sendEvent("error", { error: error instanceof Error ? error.message : String(error) });
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unerwarteter Serverfehler" },
      500
    );
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function assertRuntimeConfig() {
  const missing = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MISTRAL_API_KEY"
  ].filter((key) => !Deno.env.get(key));

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

async function retrieveBalancedContext(question: string) {
  const embedding = await embedText(question);

  const matchers = [
    {
      label: "DIK2",
      rpc: Deno.env.get("SUPABASE_MATCH_DIK2_FUNCTION") || "match_wissen_dik2",
      normalize: (item: Record<string, any>) => ({
        id: item.id,
        content: item.content,
        source: "DIK2",
        title: item.kategorie || "DIK2",
        section: item.page ? `Seite ${item.page}` : null,
        similarity: item.similarity
      })
    },
    {
      label: "Handbuch",
      rpc: Deno.env.get("SUPABASE_MATCH_HANDBUCH_FUNCTION") || "match_wissen_handbuch",
      normalize: (item: Record<string, any>) => ({
        id: item.id,
        content: item.content,
        source: "Handbuch",
        title: item.source_file || item.category || "Handbuch",
        section: item.category,
        similarity: item.similarity
      })
    }
  ];

  const resultsBySource = await Promise.all(
    matchers.map(async (matcher) => {
      const { data, error } = await getSupabase().rpc(matcher.rpc, {
        query_embedding: embedding,
        match_count: PER_SOURCE_LIMIT
      });

      if (error) throw error;

      const matches = (data || [])
        .filter((item: Record<string, any>) => item.content && (item.similarity ?? 0) >= MIN_SCORE)
        .map(matcher.normalize);

      return { source: matcher.label, matches };
    })
  );

  const contexts = dedupeAndRank(resultsBySource.flatMap((result) => result.matches));

  return {
    contexts,
    diagnostics: resultsBySource.map((result) => ({
      source: result.source,
      count: result.matches.length,
      bestScore: result.matches[0]?.similarity ?? null
    }))
  };
}

async function embedText(text: string) {
  const response = await fetch("https://api.mistral.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("MISTRAL_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: Deno.env.get("MISTRAL_EMBEDDING_MODEL") || "mistral-embed",
      inputs: [text]
    })
  });

  if (!response.ok) {
    throw new Error(`Mistral embedding failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return payload.data[0].embedding;
}

async function streamAnswerWithContext({
  question,
  contexts,
  onToken
}: {
  question: string;
  contexts: Array<Record<string, any>>;
  onToken: (token: string) => void;
}) {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("MISTRAL_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: Deno.env.get("MISTRAL_CHAT_MODEL") || "mistral-large-latest",
      temperature: 0.2,
      stream: true,
      messages: [
        {
          role: "system",
          content: [
            "Sie sind ein präziser deutschsprachiger Fachassistent.",
            "Sprechen Sie Nutzerinnen und Nutzer immer formell mit Sie an.",
            "Antworten Sie ausschließlich auf Grundlage der bereitgestellten Quellen.",
            "Wenn beide Quellen relevant sind, integrieren Sie beide sichtbar.",
            "Wenn Quellen überlappen, benennen Sie die Überschneidung statt eine Quelle zu bevorzugen.",
            "Wenn die Quellen keine belastbare Antwort enthalten, sagen Sie das klar.",
            "Formatiere die Antwort in Markdown mit kurzen Abschnitten.",
            "Wenn nach einem Formular, Bogen, Beobachtungsbogen, Bewertungsbogen, Checkliste oder Raster gefragt wird, geben Sie das Ergebnis bevorzugt als Markdown-Tabelle aus.",
            "Nutzen Sie Quellenverweise im Format [1], [2]."
          ].join(" ")
        },
        {
          role: "user",
          content: buildPrompt(question, contexts)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Mistral streaming failed: ${response.status} ${await response.text()}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body!) {
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

function buildPrompt(question: string, contexts: Array<Record<string, any>>) {
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
    "2. Unterscheiden Sie bei Bedarf zwischen DIK und Handbuch.",
    "3. Nutzen Sie Markdown. Verwenden Sie Tabellen für Formulare, Beobachtungsbögen, Bewertungsraster, Checklisten und strukturierte Programme.",
    "4. Nutzen Sie Quellenverweise im Format [1], [2].",
    "5. Erfinden Sie keine Inhalte außerhalb der Quellenstellen."
  ].join("\n");
}

function dedupeAndRank(matches: Array<Record<string, any>>) {
  const seen = new Set();
  return matches
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .filter((item) => {
      const key = item.id || `${item.source}:${item.content.slice(0, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, PER_SOURCE_LIMIT * 2);
}
