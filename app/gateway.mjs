import ky from "ky";
import { z } from "zod";

import { DomainError } from "./domain.mjs";

const outputSchema = z.strictObject({ text: z.string().min(1).max(200_000) });
const responseSchema = z.looseObject({
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string() }) })).min(1),
  usage: z.looseObject({ completion_tokens: z.number().int().nonnegative() }).optional(),
});

const demoRewrite = (scene, instruction) => ({
  text: scene.id === "scene-7"
    ? scene.text.replace(
      "선택의 대가는 숨는 것이 아니라, 훗날 그 기록 앞에 다시 서는 일이었다.",
      instruction.includes("동기")
        ? "리라의 선택은 숨기 위한 도주가 아니었다. 자신의 이름으로 쇠사슬을 푼 책임을 남기고, 훗날 그 기록 앞에 다시 서겠다는 결의였다."
        : "선택의 대가는 숨는 것이 아니라, 자신의 이름으로 남긴 기록 앞에 훗날 다시 서는 일이었다.",
    )
    : scene.text,
  adapterLabel: "local-demo (deterministic, not an LLM)",
  usageKnown: false,
});

export const generateCandidate = async ({ scene, instruction, proposedText, signal, maxOutputTokens = 4_096, plans = [], reviewExcerpts = [] }) => {
  if (proposedText) return { text: proposedText, adapterLabel: "human-provided text", usageKnown: false };
  if (!process.env.OPENAI_API_KEY) return demoRewrite(scene, instruction);

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  try {
    const raw = await ky.post(`${baseUrl}/chat/completions`, {
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeout: 20_000,
      retry: 0,
      signal,
      json: {
        model,
        max_completion_tokens: maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Rewrite only the supplied scene. Return JSON {\"text\": string}. Do not report or extract world facts; do not claim changes were committed.",
          },
          { role: "user", content: JSON.stringify({ sceneText: scene.text, instruction, plans, reviewExcerpts }) },
        ],
      },
    }).json();
    const parsedResponse = responseSchema.parse(raw);
    const parsedOutput = outputSchema.parse(JSON.parse(parsedResponse.choices[0].message.content));
    return {
      text: parsedOutput.text,
      adapterLabel: `openai-compatible:${model}`,
      outputTokens: parsedResponse.usage?.completion_tokens,
      usageKnown: parsedResponse.usage !== undefined,
    };
  } catch (error) {
    throw new DomainError(
      "PROVIDER_FAILURE",
      `설정된 생성 제공자가 유효한 후보를 반환하지 못했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
      502,
    );
  }
};
