// AI photo reading (Gemini vision) for scale and moisture-meter photos.
// When no API key is configured or the model is unsure, the flow falls back to
// fully manual entry - the brief's "when it is wrong" handling.

export interface AiReadResult {
  status: 'ok' | 'unsure' | 'unavailable';
  valueTenths?: number; // kg*10 for scale, percent*10 for moisture
  reason?: string;
}

export async function readMeterPhoto(
  kind: 'scale' | 'moisture',
  imageBase64: string,
  mimeType: string
): Promise<AiReadResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { status: 'unavailable', reason: 'GEMINI_API_KEY is not set; manual entry only.' };
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const prompt =
    kind === 'scale'
      ? 'This is a photo of a digital weighing scale display at a farm produce collection centre in India. Read the weight shown in kilograms. Reply with JSON only: {"weightKg": <number>} or {"unsure": true} if the number is not clearly readable.'
      : 'This is a photo of a grain moisture meter display. Read the moisture percentage shown. Reply with JSON only: {"moisturePercent": <number>} or {"unsure": true} if the number is not clearly readable.';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } },
                { text: prompt },
              ],
            },
          ],
        }),
      }
    );
    if (!res.ok) return { status: 'unsure', reason: `AI service returned ${res.status}` };
    const data = (await res.json()) as any;
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.unsure) return { status: 'unsure', reason: 'AI could not read the photo clearly.' };
    const raw = kind === 'scale' ? Number(parsed.weightKg) : Number(parsed.moisturePercent);
    if (!Number.isFinite(raw) || raw <= 0 || raw > 100000) {
      return { status: 'unsure', reason: 'AI returned an implausible value.' };
    }
    return { status: 'ok', valueTenths: Math.round(raw * 10) };
  } catch {
    return { status: 'unsure', reason: 'AI read failed; manual entry only.' };
  }
}
