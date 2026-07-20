import { googleExternalSourceProviders } from './providers/googleProviders';
import type { ExternalSourceProvider } from './types';

const providers = new Map<string, ExternalSourceProvider>();
googleExternalSourceProviders.forEach((provider) => providers.set(provider.id, provider));

export const ExternalSourceRegistry = {
  list(): ExternalSourceProvider[] { return [...providers.values()]; },
  get(id: string): ExternalSourceProvider | undefined { return providers.get(id); },
  register(provider: ExternalSourceProvider): void {
    if (providers.has(provider.id)) throw new Error(`External Source Providerは登録済みです: ${provider.id}`);
    providers.set(provider.id, provider);
  },
};
