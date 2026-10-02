interface LooseAiModel {
  inputs: object;
  postProcessedOutputs: unknown;
}

interface AiModels {
  "@cf/moonshotai/kimi-k2.7-code": LooseAiModel;
  "@cf/cloudflare/clef": LooseAiModel;
}
