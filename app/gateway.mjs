import ky from "ky";
import { z } from "zod";

import { DomainError } from "./domain.mjs";
import { providerConfig } from "./provider-config.mjs";

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

export const generateCandidate = async ({ scene, instruction, proposedText, signal, model, maxOutputTokens = 4_096, plans = [], reviewExcerpts = [] }) => {
  if (proposedText) return { text: proposedText, adapterLabel: "human-provided text", usageKnown: false };
  const config = providerConfig();
  if (config.mode === 'local-demo') return demoRewrite(scene, instruction);
  const selectedModel = model ?? config.model;
  if (selectedModel === null) throw new DomainError('MODEL_REQUIRED', '실행할 모델을 선택하세요.', 422);

  try {
    const raw = await ky.post(`${config.baseUrl}/chat/completions`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      timeout: 20_000,
      retry: 0,
      signal,
      json: {
        model: selectedModel,
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
      adapterLabel: `openai-compatible:${selectedModel}`,
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
