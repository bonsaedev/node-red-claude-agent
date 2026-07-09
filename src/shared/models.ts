/**
 * Curated Anthropic model list, shared by the config schema (the ids become the
 * `model`/`fallbackModel` enum, which also feeds the generated help) and the
 * editor form (the model dropdown). Maintained in code — drop an entry in a
 * future node release as a model is retired. Model ids/names are universal, so
 * they are not localized.
 */
export interface AnthropicModel {
  id: string;
  label: string;
}

export const ANTHROPIC_MODELS: readonly AnthropicModel[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8 — most capable" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — balanced" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — fast" },
  { id: "claude-fable-5", label: "Fable 5" },
];
