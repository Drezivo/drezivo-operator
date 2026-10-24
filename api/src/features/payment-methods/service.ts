import type { PlatformPaymentsPort } from './contracts.js';

/** Feature use cases depend on this narrow repository contract. */
export function createPlatformPaymentsService(repository: PlatformPaymentsPort): PlatformPaymentsPort {
  return {
    list: (...args: Parameters<PlatformPaymentsPort['list']>) => repository.list(...args),
    readQr: (...args: Parameters<PlatformPaymentsPort['readQr']>) => repository.readQr(...args),
    create: (...args: Parameters<PlatformPaymentsPort['create']>) => repository.create(...args),
    update: (...args: Parameters<PlatformPaymentsPort['update']>) => repository.update(...args),
    setActive: (...args: Parameters<PlatformPaymentsPort['setActive']>) => repository.setActive(...args),
  };
}
