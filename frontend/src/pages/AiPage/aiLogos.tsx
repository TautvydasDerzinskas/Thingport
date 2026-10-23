import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import ai21 from "../../assets/ai-logos/ai21.svg";
import anthropic from "../../assets/ai-logos/anthropic.svg";
import baichuan from "../../assets/ai-logos/baichuan.svg";
import baidu from "../../assets/ai-logos/baidu.svg";
import claude from "../../assets/ai-logos/claude.svg";
import cohere from "../../assets/ai-logos/cohere.svg";
import deepseek from "../../assets/ai-logos/deepseek.svg";
import doubao from "../../assets/ai-logos/doubao.svg";
import fireworks from "../../assets/ai-logos/fireworks.svg";
import gemini from "../../assets/ai-logos/gemini.svg";
import gemma from "../../assets/ai-logos/gemma.svg";
import grok from "../../assets/ai-logos/grok.svg";
import groq from "../../assets/ai-logos/groq.svg";
import huggingface from "../../assets/ai-logos/huggingface.svg";
import hunyuan from "../../assets/ai-logos/hunyuan.svg";
import ibm from "../../assets/ai-logos/ibm.svg";
import internlm from "../../assets/ai-logos/internlm.svg";
import kimi from "../../assets/ai-logos/kimi.svg";
import lg from "../../assets/ai-logos/lg.svg";
import liquid from "../../assets/ai-logos/liquid.svg";
import llava from "../../assets/ai-logos/llava.svg";
import lmstudio from "../../assets/ai-logos/lmstudio.svg";
import meta from "../../assets/ai-logos/meta.svg";
import microsoft from "../../assets/ai-logos/microsoft.svg";
import minimax from "../../assets/ai-logos/minimax.svg";
import mistral from "../../assets/ai-logos/mistral.svg";
import nousresearch from "../../assets/ai-logos/nousresearch.svg";
import nvidia from "../../assets/ai-logos/nvidia.svg";
import ollama from "../../assets/ai-logos/ollama.svg";
import openai from "../../assets/ai-logos/openai.svg";
import openrouter from "../../assets/ai-logos/openrouter.svg";
import perplexity from "../../assets/ai-logos/perplexity.svg";
import qwen from "../../assets/ai-logos/qwen.svg";
import stepfun from "../../assets/ai-logos/stepfun.svg";
import tii from "../../assets/ai-logos/tii.svg";
import together from "../../assets/ai-logos/together.svg";
import upstage from "../../assets/ai-logos/upstage.svg";
import vllm from "../../assets/ai-logos/vllm.svg";
import xai from "../../assets/ai-logos/xai.svg";
import xiaomimimo from "../../assets/ai-logos/xiaomimimo.svg";
import yi from "../../assets/ai-logos/yi.svg";
import zhipu from "../../assets/ai-logos/zhipu.svg";

const LOGOS = {
  ai21,
  anthropic,
  baichuan,
  baidu,
  claude,
  cohere,
  deepseek,
  doubao,
  fireworks,
  gemini,
  gemma,
  grok,
  groq,
  huggingface,
  hunyuan,
  ibm,
  internlm,
  kimi,
  lg,
  liquid,
  llava,
  lmstudio,
  meta,
  microsoft,
  minimax,
  mistral,
  nousresearch,
  nvidia,
  ollama,
  openai,
  openrouter,
  perplexity,
  qwen,
  stepfun,
  tii,
  together,
  upstage,
  vllm,
  xai,
  xiaomimimo,
  yi,
  zhipu,
};
export type AiLogoName = keyof typeof LOGOS;
export { LOGOS as AI_LOGOS };

// Logos from LobeHub Icons (MIT, see assets/ai-logos/LICENSE). Checked in order: a model's family says more than
// where it runs, so "qwen/qwen3-8b" on OpenRouter shows Qwen. Ids may carry an owner prefix, hence no anchors.
const BY_MODEL: [RegExp, AiLogoName][] = [
  [/llava/, "llava"],
  [/qwen|qwq/, "qwen"],
  [/llama/, "meta"],
  [/gemma/, "gemma"],
  [/gemini/, "gemini"],
  [/mistral|mixtral|ministral|magistral|codestral|devstral|pixtral/, "mistral"],
  [/deepseek/, "deepseek"],
  [/(^|[/:_-])phi\d?([.:_-]|$)/, "microsoft"],
  [/claude/, "claude"],
  [/mimo/, "xiaomimimo"],
  [/grok/, "grok"],
  [/(^|\/)(gpt|chatgpt|o[134])(-|$)/, "openai"],
  [/command|(^|\/)aya|cohere/, "cohere"],
  [/granite/, "ibm"],
  [/nemotron/, "nvidia"],
  [/kimi|moonshot/, "kimi"],
  [/glm|zhipu/, "zhipu"],
  [/(^|\/)yi[-:]/, "yi"],
  [/minimax|abab/, "minimax"],
  [/internlm/, "internlm"],
  [/baichuan/, "baichuan"],
  [/doubao/, "doubao"],
  [/hunyuan/, "hunyuan"],
  [/(^|\/)step[-:]/, "stepfun"],
  [/falcon/, "tii"],
  [/(^|\/)lfm|liquid/, "liquid"],
  [/solar/, "upstage"],
  [/hermes|nous/, "nousresearch"],
  [/jamba/, "ai21"],
  [/exaone/, "lg"],
  [/ernie/, "baidu"],
  [/sonar|perplexity/, "perplexity"],
];

const BY_HOST: [RegExp, AiLogoName][] = [
  [/openai\.com/, "openai"],
  [/anthropic\.com/, "anthropic"],
  [/googleapis\.com/, "gemini"],
  [/openrouter\.ai/, "openrouter"],
  [/groq\.com/, "groq"],
  [/together\.(ai|xyz)/, "together"],
  [/fireworks\.ai/, "fireworks"],
  [/deepseek\.com/, "deepseek"],
  [/mistral\.ai/, "mistral"],
  [/x\.ai/, "xai"],
  [/huggingface\.co/, "huggingface"],
  [/nvidia\.com/, "nvidia"],
  [/perplexity\.ai/, "perplexity"],
  // Ports the local servers listen on out of the box.
  [/:11434(\/|$)/, "ollama"],
  [/:1234(\/|$)/, "lmstudio"],
  [/vllm/, "vllm"],
];

/** What tells two AIs with the same model apart. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Which logo an AI shows, by name; null for the robot head. */
export function aiLogoName(model: string, baseUrl: string): AiLogoName | null {
  const id = model.toLowerCase();
  const host = baseUrl.toLowerCase();
  return (
    BY_MODEL.find(([pattern]) => pattern.test(id))?.[1] ?? BY_HOST.find(([pattern]) => pattern.test(host))?.[1] ?? null
  );
}

/** The model's or provider's logo, or a robot head for one it doesn't know. */
export function AiLogo({ model, baseUrl, size }: { model: string; baseUrl: string; size: number }) {
  const name = aiLogoName(model, baseUrl);
  if (!name) return <SmartToyOutlinedIcon sx={{ fontSize: size, color: "#6b7280" }} />;
  return <img src={LOGOS[name]} alt="" width={size} height={size} style={{ display: "block" }} />;
}
