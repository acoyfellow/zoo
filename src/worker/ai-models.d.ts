interface LooseAiModel {
  inputs: Record<string, unknown>;
  postProcessedOutputs: unknown;
}
interface AiModels {
  "@cf/moonshotai/kimi-k2.7-code": LooseAiModel;
  "@cf/cloudflare/clef": LooseAiModel;
}
