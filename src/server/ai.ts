/**
 * AI providers, server-side only (OpenAI). Keys are read from the env at call time; `fetcher` lets
 * tests answer instead of the real API (OPENAI_BASE_URL also points the same code at a local stub).
 *
 *  - json():  chat completions with a strict JSON schema (structured outputs)
 *  - image(): images/generations, or images/edits with reference images (the influencer's portrait),
 *             so every post keeps its look as closely as the model allows.
 */
import { ENV } from "../config/fypad.ts";

export type Fetcher = typeof fetch;

export interface Img {
  mime: string;
  bytes: Buffer;
}

export interface Providers {
  available: boolean;
  json(system: string, user: string, name: string, schema: Record<string, unknown>): Promise<unknown>;
  image(prompt: string, refs: Img[], size: "1024x1024" | "1024x1536"): Promise<Img>;
}

/** A provider refused or failed. `retryable` = worth another attempt (timeouts, 5xx, 429). */
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}

async function failFrom(r: Response, what: string): Promise<never> {
  let detail = "";
  try {
    const j = (await r.json()) as { error?: { message?: string; code?: string; type?: string } };
    // an exhausted account is not worth retrying, and the visitor only needs a neutral sentence
    if (j.error?.type === "insufficient_quota" || /credit_balance|insufficient_quota|billing_hard_limit/.test(j.error?.code ?? "")) throw new ProviderError("Generation is not available right now. Try again later.", false);
    detail = j.error?.code === "moderation_blocked" || /safety|moderation/i.test(j.error?.message ?? "") ? " The request was refused by the provider's safety system." : "";
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    // body unreadable
  }
  const retryable = r.status === 429 || r.status >= 500;
  throw new ProviderError(`${what} failed (HTTP ${r.status}).${detail}`, retryable && !detail);
}

export function providers(fetcher: Fetcher = fetch): Providers {
  const key = ENV.openaiKey();
  const base = ENV.openaiBase();
  const auth = { authorization: `Bearer ${key ?? ""}` };

  const guard = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`${what} did not answer in time.`, true);
    }
  };

  return {
    available: Boolean(key),

    json: (system, user, name, schema) =>
      guard("Writing", async () => {
        if (!key) throw new ProviderError("Generation is not available right now.", false);
        const r = await fetcher(`${base}/chat/completions`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            model: ENV.textModel(),
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!r.ok) await failFrom(r, "Writing");
        const j = (await r.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
        const msg = j.choices?.[0]?.message;
        if (msg?.refusal) throw new ProviderError("The model declined this request. Try describing it differently.", false);
        try {
          return JSON.parse(String(msg?.content ?? "")) as unknown;
        } catch {
          throw new ProviderError("The model returned unreadable text.", true);
        }
      }),

    image: (prompt, refs, size) =>
      guard("Image generation", async () => {
        if (!key) throw new ProviderError("Generation is not available right now.", false);
        let r: Response;
        if (refs.length) {
          const form = new FormData();
          form.set("model", ENV.imageModel());
          form.set("prompt", prompt);
          form.set("size", size);
          form.set("quality", ENV.imageQuality());
          refs.forEach((ref, i) => form.append("image[]", new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }), `reference-${i}.${ref.mime.split("/")[1] ?? "png"}`));
          r = await fetcher(`${base}/images/edits`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(170_000) });
        } else {
          r = await fetcher(`${base}/images/generations`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ model: ENV.imageModel(), prompt, size, quality: ENV.imageQuality(), n: 1 }),
            signal: AbortSignal.timeout(170_000),
          });
        }
        if (!r.ok) await failFrom(r, "Image generation");
        const j = (await r.json()) as { data?: { b64_json?: string }[]; output_format?: string };
        const b64 = j.data?.[0]?.b64_json;
        if (!b64) throw new ProviderError("Image generation returned no image.", true);
        const mime = j.output_format === "jpeg" ? "image/jpeg" : j.output_format === "webp" ? "image/webp" : "image/png";
        return { mime, bytes: Buffer.from(b64, "base64") };
      }),
  };
}
