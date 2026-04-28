import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { embedText } from "./llm.js";

const PER_SOURCE_LIMIT = 5;
const MIN_SCORE = 0.15;

const SOURCE_MATCHERS = [
  {
    label: "DIK2",
    rpc: () => config.supabase.matchDik2Function,
    normalize: (item) => ({
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
    rpc: () => config.supabase.matchHandbuchFunction,
    normalize: (item) => ({
      id: item.id,
      content: item.content,
      source: "Handbuch",
      title: item.source_file || item.category || "Handbuch",
      section: item.category,
      similarity: item.similarity
    })
  }
];

let supabase;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

export async function retrieveBalancedContext(question) {
  const embedding = await embedText(question);

  const resultsBySource = await Promise.all(
    SOURCE_MATCHERS.map(async (matcher) => {
      const matches = await matchSource({ embedding, matcher });
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

async function matchSource({ embedding, matcher }) {
  const { data, error } = await getSupabase().rpc(matcher.rpc(), {
    query_embedding: embedding,
    match_count: PER_SOURCE_LIMIT
  });

  if (error) {
    error.status = 500;
    throw error;
  }

  return (data || [])
    .filter((item) => item.content && (item.similarity ?? 0) >= MIN_SCORE)
    .map(matcher.normalize);
}

function dedupeAndRank(matches) {
  const seen = new Set();
  return matches
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .filter((item) => {
      const key = item.id || `${item.source}:${item.content.slice(0, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, PER_SOURCE_LIMIT * config.sources.length);
}
