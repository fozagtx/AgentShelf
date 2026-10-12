import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  createElasticClient,
  ensureIndices,
  RUNS_INDEX,
} from "../server/elastic.js";

const enabled = Boolean(process.env.JINA_API_KEY);
const elastic = createElasticClient();

describe("live Jina semantic search", () => {
  afterAll(async () => {
    await elastic.close();
  });

  it.skipIf(!enabled)("indexes and searches reasoning with Jina embeddings", async () => {
    const id = `test-jina-${randomUUID()}`;
    try {
      await ensureIndices(elastic);
      await elastic.index({
        index: RUNS_INDEX,
        id,
        document: {
          id,
          experiment_id: id,
          model: "test-model",
          variant: "original",
          status: "done",
          reasoning:
            "The shopper skipped the wool sweater because the price was higher than similar products.",
        },
      });
      await elastic.indices.refresh({ index: RUNS_INDEX });
      const response = await elastic.search({
        index: RUNS_INDEX,
        size: 8,
        query: {
          bool: {
            filter: [{ term: { experiment_id: id } }],
            must: [{ match: { reasoning: { query: "expensive price" } } }],
          },
        },
      });
      expect(response.hits.hits.map((hit) => hit._id)).toContain(id);
    } finally {
      try {
        await elastic.delete({ index: RUNS_INDEX, id });
      } catch (error) {
        if ((error as { meta?: { statusCode?: number } }).meta?.statusCode !== 404) {
          throw error;
        }
      }
    }
  }, 120_000);
});
