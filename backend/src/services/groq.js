/**
 * src/services/groq.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Groq LLM client — used exclusively for personality-aware message reframing.
 *
 * Model: llama3-8b-8192
 *   - Fast inference (~150ms on Groq's infrastructure)
 *   - Small enough to be cheap; large enough for tone-shift tasks
 *   - 8192 context window is more than enough for a single chat message
 *
 * We do NOT stream here.
 *   Streaming would let the first token appear faster, but we deliver to
 *   multiple socket recipients simultaneously. Getting the full string first
 *   lets us emit once to a group rather than managing per-group streams.
 *
 * On any error (rate limit, network, timeout): return rawContent unchanged.
 *   The user sees the original message. No crash. No blank message.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Groq from 'groq-sdk';
import 'dotenv/config';

// ── Client initialization ─────────────────────────────────────────────────────
// Groq SDK reads GROQ_API_KEY from process.env automatically when you call
// new Groq(). We make the missing-key check explicit for clearer error messages.
if (!process.env.GROQ_API_KEY) {
  console.warn(
    '[groq.js] GROQ_API_KEY not set in .env — reframing will return raw content unchanged. ' +
    'Get a free key at https://console.groq.com'
  );
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ── Model config ──────────────────────────────────────────────────────────────
// llama-3.1-8b-instant: the current Groq-hosted fast model.
// (llama3-8b-8192 was decommissioned — same capability, new model ID)
const MODEL = 'llama-3.1-8b-instant';

/**
 * reframeMessage(rawContent, recipientTypeKey) → string
 *
 * Rewrites a chat message so it SOUNDS right for a specific personality type.
 * Same facts, different emotional register.
 *
 * @param {string} rawContent        The original message text
 * @param {string} recipientTypeKey  e.g. "analytical:verbal", "emotional:visual"
 * @returns {Promise<string>}        Reframed text, or rawContent on error
 *
 * typeKey format: "{response}:{medium}"
 *   response: analytical | emotional | avoidant
 *   medium:   verbal     | visual    | auditory
 *   → 9 possible combinations (3 × 3)
 *
 * Why "Under 2 sentences" in the system prompt?
 *   Chat messages are short. A reframe longer than the original breaks the UX.
 *   Constraining to 2 sentences prevents the model from expanding terse messages
 *   into paragraphs.
 *
 * Why "Never reveal you're reframing"?
 *   If the model adds "Here's how an analytical person would read this…" it
 *   breaks the illusion. The reframe should feel like the sender just wrote it
 *   that way naturally.
 */
export async function reframeMessage(rawContent, recipientTypeKey) {
  // Fast-path: no API key → don't attempt the call
  if (!process.env.GROQ_API_KEY) {
    return rawContent;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a subtle communication translator. Reframe how a chat message SOUNDS ' +
            'to a specific personality type — same facts, different tone. Under 2 sentences. ' +
            'Never reveal you\'re reframing.',
        },
        {
          role: 'user',
          content:
            `Message: '${rawContent}'\n` +
            `Recipient type: ${recipientTypeKey}\n` +
            'Reframe for this personality.',
        },
      ],
      // temperature 0.7 — creative enough to shift tone, not so random it changes meaning
      temperature: 0.7,
      // max_tokens: keep it short — we're reframing, not generating essays
      max_tokens: 150,
    });

    const reframed = completion.choices[0]?.message?.content?.trim();

    // If for any reason the model returns empty, fall back to raw
    return reframed || rawContent;

  } catch (err) {
    // Graceful fallback: log but don't crash, return original message
    // Common errors: rate limit (429), invalid key (401), timeout, network
    console.error('[groq] reframeMessage error:', err.message);
    return rawContent;
  }
}

export default groq;
