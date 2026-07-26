import {
  installTrustedRegistryPackage as installWithSdk,
  type TrustedRegistryCandidateSelector,
  type TrustedRegistryMutationResult,
  type VerifiedTrustedRegistryCatalog,
} from '@retake-tools/package-sdk';
import { LocalPackageManagerService } from './local-package-manager-service';

export {
  downloadVerifiedTrustedRegistryArchive,
  trustedRegistryPackageMediaType,
  type DownloadedTrustedRegistryPackage,
} from '@retake-tools/package-sdk';

export type TrustedRegistryRemoteInstallResult =
  TrustedRegistryMutationResult;

export async function installTrustedRegistryPackage(input: {
  action: 'install' | 'update';
  fetchImpl?: typeof fetch;
  manager: LocalPackageManagerService;
  packageId: string;
  selector: TrustedRegistryCandidateSelector;
  signal?: AbortSignal;
  temporaryRoot?: string;
  timeoutMs?: number;
  verifiedCatalog: VerifiedTrustedRegistryCatalog;
}): Promise<TrustedRegistryRemoteInstallResult> {
  return installWithSdk({
    ...input,
    manager: input.manager.sdkManager,
  });
}
