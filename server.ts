import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Lazy Gemini client helper
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// AI Suggest Mapping endpoint
app.post("/api/gemini/suggest-mapping", async (req, res) => {
  try {
    const { ledgers, heads } = req.body;
    if (!Array.isArray(ledgers) || ledgers.length === 0) {
      return res.status(400).json({ error: "Missing or invalid 'ledgers' list." });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured in the environment.",
      });
    }

    const prompt = `
You are an expert Indian Accounting Standards (Ind AS / Schedule III / MCA) and IFRS statutory auditor.
Map each ledger item to the single most appropriate Schedule III / Ind AS consolidated head from the provided candidate list.

Candidate Ind AS Heads:
${JSON.stringify(heads, null, 2)}

Ledgers to map:
${JSON.stringify(ledgers, null, 2)}

Return a strict JSON array of objects with this schema:
[
  {
    "ledgerCode": "string",
    "ledgerName": "string",
    "suggestedHeadId": "string (one of the candidate head IDs)",
    "confidence": number between 0.0 and 1.0,
    "rationale": "short 1-sentence accounting justification"
  }
]
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const text = response.text || "[]";
    let parsed = [];
    try {
      parsed = JSON.parse(text);
    } catch {
      // Clean possible markdown code fences
      const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
      parsed = JSON.parse(clean);
    }

    res.json({ suggestions: parsed });
  } catch (err: any) {
    console.error("Error generating mapping suggestions:", err);
    res.status(500).json({ error: err.message || "Failed to generate mapping suggestions" });
  }
});

// AI Draft Notes endpoint
app.post("/api/gemini/draft-notes", async (req, res) => {
  try {
    const { noteType, groupData } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not configured in the environment.",
      });
    }

    const prompt = `
You are an expert technical accounting partner drafting formal statutory notes to the Consolidated Financial Statements under Ind AS / Schedule III of the Companies Act, 2013 and Standards on Auditing (SA 600).

Note Type: ${noteType}
Context & Group Data:
${JSON.stringify(groupData, null, 2)}

Draft a comprehensive, publication-ready, professional note in clear structured Markdown format. Include appropriate tables/disclosures if relevant (e.g. holding percentages, intercompany balances, or materiality benchmarks).
Ensure high technical rigor, referencing Ind AS 110, Ind AS 24, or SA 600 as applicable.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    res.json({ note: response.text });
  } catch (err: any) {
    console.error("Error drafting note:", err);
    res.status(500).json({ error: err.message || "Failed to draft note" });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Consolidation Workbench server running on port ${PORT}`);
  });
}

startServer();
