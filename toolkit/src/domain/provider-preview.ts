export interface ProviderPreview {
  readonly providerId: string;
  readonly displayName: string;
  readonly baseURL?: string;
  readonly apiKeyEnv?: string;
  readonly models: readonly string[];
}
