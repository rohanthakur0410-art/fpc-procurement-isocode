// AI photo reading (Gemini vision) for scale and moisture-meter photos.
// When no API key is configured or the model is unsure, the flow falls back to
// fully manual entry - the brief's "when it is wrong" handling.
//
// Models are tried in order: a retired model (404) fails over to the next, and
// a transient overload (503/429) is retried once before failing over. Verified
// on the free tier 2026-11-05: gemini-2.0-flash retired, gemini-3.8-flash
// frequently 503, gemini-3.1-flash-lite reads synthetic scale/meter photos
// reliably. Override with GEMINI_MODELS (comma-separated) or GEMINI_MODEL.

export interface AiReadResult {
  status: 'ok' | 'unsure' | 'unavailable';
  valueTenths?: number; // kg*10 for scale, percent*10 for moisture
  reason?: string;
}

const DEFAULT_MODELS = 'gemini-3.1-flash-lite,gemini-3.8-flash';

function modelChain(): string[] {
  const env = process.env.GEMINI_MODELS || process.env.GEMINI_MODEL;
  const list = (env && env.trim() ? env : DEFAULT_MODELS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_MODELS.split(',');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readMeterPhoto(
  kind: 'scale' | 'moisture',
  imageBase64: string,
  mimeType: string
): Promise<AiReadResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { status: 'unavailable', reason: 'GEMINI_API_KEY is not set; manual entry only.' };
  }
  const prompt =
    kind === 'scale'
      ? 'This is a photo of a digital weighing scale display at a farm produce collection centre in India. First transcribe the exact characters shown on the weight display, then give the weight in kilograms. Reply with JSON only: {"displayText": "<exact characters on the display>", "weightKg": <number>}. If the display is not clearly readable, reply {"unsure": true}. Never guess.'
      : 'This is a photo of a grain moisture meter display. First transcribe the exact characters shown on the display, then give the moisture percentage. Reply with JSON only: {"displayText": "<exact characters on the display>", "moisturePercent": <number>}. If the display is not clearly readable, reply {"unsure": true}. Never guess.';

  let lastReason = 'AI service unavailable.';
  for (const model of modelChain()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: { maxOutputTokens: 200 },
            }),
          }
        );
        if (!res.ok) {
          lastReason = `AI service returned ${res.status} (${model}).`;
          if (res.status === 404) break; // retired/unknown model: next model, no retry
          if ((res.status === 429 || res.status === 503) && attempt === 0) {
            await sleep(800); // transient overload: one retry, then fail over
            continue;
          }
          break;
        }
        const data = (await res.json()) as any;
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const cleaned = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.unsure) return { status: 'unsure', reason: 'AI could not read the photo clearly.' };
        const raw = kind === 'scale' ? Number(parsed.weightKg) : Number(parsed.moisturePercent);
        // Transcription cross-check: the numeric value must match the digits the
        // model says it saw. A confident-but-inconsistent answer becomes unsure,
        // never a proposed value.
        const displayText = typeof parsed.displayText === 'string' ? parsed.displayText : '';
        // Transcription cross-check on multi-number displays (date/time/temp often
        // precede the reading): when a unit marker is present the value must match
        // the unit-anchored number (% for moisture, kg for scale); otherwise it must
        // match some number in the transcription. Either way a confident-but-
        // inconsistent answer becomes unsure, never a proposed value.
        // Multi-number displays (date/time/temp often precede the reading): anchor on
        // the unit marker when present (% for moisture, kg for scale). Ambiguous
        // transcriptions - several unit-marked numbers, or no unit marker with several
        // distinct numbers - reject to unsure rather than risk an incidental match.
        const unitRe = kind === 'moisture' ? /(\d+(?:\.\d+)?)\s*%/g : /(\d+(?:\.\d+)?)\s*kg\b/gi;
        const anchored = new Set([...displayText.matchAll(unitRe)].map((m) => Number(m[1])));
        const numbers = new Set([...displayText.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])));
        let expected: number | null = null;
        if (anchored.size === 1) {
          expected = [...anchored][0];
        } else if (anchored.size === 0 && numbers.size === 1) {
          expected = [...numbers][0];
        }
        if (expected === null || !Number.isFinite(raw) || Math.abs(expected - raw) > 1e-6) {
          return { status: 'unsure', reason: 'AI reading was internally inconsistent.' };
        }
        if (raw < (kind === 'moisture' ? 0 : 0.1) || raw > (kind === 'moisture' ? 40 : 100000)) {
          return { status: 'unsure', reason: 'AI returned an implausible value.' };
        }
        return { status: 'ok', valueTenths: Math.round(raw * 10) };
      } catch {
        lastReason = `AI read failed (${model}); manual entry only.`;
        break; // network/timeout/parse error: fail over to next model
      }
    }
  }
  return { status: 'unsure', reason: lastReason };
}
