import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import querystring from "querystring";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: ".env.local" });

const app = express();
const PORT = 3000;

app.use(express.json());

// Upbit API Helper
const getUpbitHeaders = (query: any = null) => {
  const access_key = process.env.UPBIT_ACCESS_KEY;
  const secret_key = process.env.UPBIT_SECRET_KEY;

  if (!access_key || !secret_key) return null;

  const payload: any = {
    access_key: access_key,
    nonce: uuidv4(),
  };

  if (query) {
    const m = crypto.createHash('sha512');
    m.update(querystring.encode(query), 'utf8');
    const query_hash = m.digest('hex');
    payload.query_hash = query_hash;
    payload.query_hash_alg = 'SHA512';
  }

  const token = jwt.sign(payload, secret_key);
  return { Authorization: `Bearer ${token}` };
};

// API Routes
app.get("/api/market/all", async (req, res) => {
  try {
    const response = await axios.get("https://api.upbit.com/v1/market/all?isDetails=false");
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/ticker", async (req, res) => {
  const { markets } = req.query;
  try {
    const response = await axios.get(`https://api.upbit.com/v1/ticker?markets=${markets}`);
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/candles/minutes/:unit", async (req, res) => {
  const { unit } = req.params;
  const { market, count } = req.query;
  try {
    const response = await axios.get(`https://api.upbit.com/v1/candles/minutes/${unit}?market=${market}&count=${count}`);
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/candles/:timeframe", async (req, res) => {
  const { timeframe } = req.params;
  const { market, count } = req.query;
  try {
    const response = await axios.get(`https://api.upbit.com/v1/candles/${timeframe}?market=${market}&count=${count}`);
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/execute-trade", async (req, res) => {
  const access_key = process.env.UPBIT_ACCESS_KEY;
  const secret_key = process.env.UPBIT_SECRET_KEY;
  if (!access_key || !secret_key) {
    return res.status(401).json({ error: "Upbit API keys not configured" });
  }

  try {
    // Upbit requires price/volume as strings
    const orderParams: any = {
      market: req.body.market,
      side: req.body.side,
      ord_type: req.body.ord_type,
    };
    if (req.body.price !== undefined) orderParams.price = String(req.body.price);
    if (req.body.volume !== undefined) orderParams.volume = String(req.body.volume);

    // Upbit JWT: hash from query string encoding of params
    const query = querystring.encode(orderParams);
    const hash = crypto.createHash('sha512');
    hash.update(query, 'utf8');
    const queryHash = hash.digest('hex');

    const payload: any = {
      access_key,
      nonce: uuidv4(),
      query_hash: queryHash,
      query_hash_alg: 'SHA512',
    };
    const token = jwt.sign(payload, secret_key);

    const response = await axios.post("https://api.upbit.com/v1/orders", orderParams, {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json(response.data);
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.response?.data?.error?.name || error.message;
    console.error("[Trade] Execute error:", errMsg);
    res.status(error.response?.status || 500).json({ error: errMsg });
  }
});

app.get("/api/accounts", async (req, res) => {
  const headers = getUpbitHeaders();
  if (!headers) {
    return res.status(401).json({ error: "Upbit API keys not configured" });
  }
  try {
    const response = await axios.get("https://api.upbit.com/v1/accounts", { headers });
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Gemini AI 분석 엔드포인트
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

app.post("/api/gemini/analyze", async (req, res) => {
  if (!geminiClient) {
    return res.status(503).json({ error: "Gemini API key not configured" });
  }

  try {
    const { market, currentPrice, changeRate, volume24h, prices } = req.body;

    const prompt = `You are a crypto trading analyst. Analyze the following market data and give a brief trading recommendation.

Market: ${market}
Current Price: ${currentPrice.toLocaleString()} KRW
24h Change: ${(changeRate * 100).toFixed(2)}%
24h Volume: ${volume24h.toFixed(2)}

Recent price data (newest first):
${prices.map((p: any) => `${p.date}: O=${p.open} H=${p.high} L=${p.low} C=${p.close} V=${p.volume.toFixed(2)}`).join('\n')}

Respond in this exact format:
SIGNAL: [BUY/SELL/HOLD]
CONFIDENCE: [0-100]
REASON: [1-2 sentence reason in Korean]`;

    const response = await geminiClient.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    const text = response.text || '';
    const inputTokens = response.usageMetadata?.promptTokenCount || 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;

    res.json({
      analysis: text,
      tokenUsage: {
        inputTokens,
        outputTokens,
      },
    });
  } catch (error: any) {
    console.error("[Gemini] API error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/status", async (req, res) => {
  const access_key = process.env.UPBIT_ACCESS_KEY;
  const secret_key = process.env.UPBIT_SECRET_KEY;
  const gemini_key = process.env.GEMINI_API_KEY;

  const status = {
    upbitConfigured: !!(access_key && secret_key),
    geminiConfigured: !!gemini_key,
    upbitConnected: false,
    error: null as string | null
  };

  if (status.upbitConfigured) {
    try {
      const headers = getUpbitHeaders();
      console.log("Attempting Upbit connection check...");
      const response = await axios.get("https://api.upbit.com/v1/accounts", { headers });
      console.log("Upbit connection successful!");
      status.upbitConnected = true;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.error("Upbit connection failed:", errorMsg);
      if (error.response?.data?.error?.name === 'out_of_scope') {
        status.error = "IP Restriction: Your Upbit API key requires a registered IP, but this server's IP is dynamic. Please use a 'Read-only' key with no IP restriction for this environment.";
      } else {
        status.error = errorMsg;
      }
    }
  }

  res.json(status);
});

app.get("/api/ip", async (req, res) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json");
    res.json(status.upbitConnected ? { ip: "Connected", note: "Already connected!" } : { ip: response.data.ip });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch server IP" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

app.get("/api/ip", async (req, res) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json");
    res.json({ ip: response.data.ip });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch server IP" });
  }
});

startServer();
