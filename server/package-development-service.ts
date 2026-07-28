import {
  LinkedPackageDevelopmentManager,
  type LinkedPackageDevelopmentRecordV1,
  type LinkedPackageDevelopmentStateV1,
  type LinkedPackageWatchV1,
} from '@retake-tools/package-sdk';

export interface PackageDevelopmentLinkV1 {
  candidate: LinkedPackageDevelopmentRecordV1['candidate'];
  error: string | null;
  identity: LinkedPackageDevelopmentRecordV1['identity'];
  lastGood: LinkedPackageDevelopmentRecordV1['lastGood'];
  linkId: string;
  sourceLabel: string;
  status: LinkedPackageDevelopmentRecordV1['status'];
  trustedAt: string;
  updatedAt: string;
  watching: boolean;
}

export interface PackageDevelopmentSnapshotV1 {
  links: PackageDevelopmentLinkV1[];
  revision: number;
  schemaVersion: 1;
  updatedAt: string;
}

export class PackageDevelopmentService {
  private readonly manager: LinkedPackageDevelopmentManager;
  private readonly onChange: () => void;
  private readonly watchers = new Map<string, LinkedPackageWatchV1>();

  constructor(input: {
    hostVersion: string;
    onChange?: () => void;
    workspaceRoot: string;
  }) {
    this.manager = new LinkedPackageDevelopmentManager(input);
    this.onChange = input.onChange ?? (() => undefined);
  }

  async read(): Promise<PackageDevelopmentSnapshotV1> {
    return this.project(await this.manager.list());
  }

  async link(
    sourceRoot: string,
    confirmTrust: boolean,
  ): Promise<PackageDevelopmentSnapshotV1> {
    if (!confirmTrust) {
      throw new PackageDevelopmentInputError(
        'Linked Package source trust must be confirmed.',
      );
    }
    const result = await this.manager.link({
      confirmTrust,
      sourceRoot: requiredSourceRoot(sourceRoot),
    });
    this.onChange();
    await this.startWatch(result.record.linkId);
    return this.read();
  }

  async rebuild(
    linkId: string,
    confirmIdentity = false,
  ): Promise<PackageDevelopmentSnapshotV1> {
    const result = await this.manager.stageRebuild(
      requiredLinkId(linkId),
      { confirmIdentity },
    );
    if (result.changed) this.onChange();
    return this.project(result.state);
  }

  async resolveCandidate(
    linkId: string,
    digest: string,
    outcome: 'accept' | 'reject',
    error?: string,
  ): Promise<PackageDevelopmentSnapshotV1> {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new PackageDevelopmentInputError(
        'Linked Package candidate digest is invalid.',
      );
    }
    if (outcome === 'accept') {
      await this.manager.acceptCandidate(requiredLinkId(linkId), digest);
    } else {
      await this.manager.rejectCandidate(
        requiredLinkId(linkId),
        digest,
        typeof error === 'string' && error.length > 0
          ? error
          : 'PluginModule activation rejected the linked candidate.',
      );
    }
    this.onChange();
    return this.read();
  }

  async setWatching(
    linkId: string,
    watching: boolean,
  ): Promise<PackageDevelopmentSnapshotV1> {
    const exactLinkId = requiredLinkId(linkId);
    if (watching) {
      await this.startWatch(exactLinkId);
    } else {
      this.stopWatch(exactLinkId);
    }
    return this.read();
  }

  async unlink(
    linkId: string,
    disposition: 'remove' | 'retain',
  ): Promise<PackageDevelopmentSnapshotV1> {
    const exactLinkId = requiredLinkId(linkId);
    this.stopWatch(exactLinkId);
    await this.manager.unlink({
      disposition,
      linkId: exactLinkId,
    });
    this.onChange();
    return this.read();
  }

  private async startWatch(linkId: string): Promise<void> {
    if (this.watchers.has(linkId)) return;
    const watcher = await this.manager.watch(linkId, {
      onError: () => undefined,
      onResult: (result) => {
        if (result.changed) this.onChange();
      },
      staged: true,
    });
    this.watchers.set(linkId, watcher);
  }

  private stopWatch(linkId: string): void {
    this.watchers.get(linkId)?.close();
    this.watchers.delete(linkId);
  }

  private project(
    state: LinkedPackageDevelopmentStateV1,
  ): PackageDevelopmentSnapshotV1 {
    return {
      links: state.links.map((record) => ({
        candidate: structuredClone(record.candidate),
        error: record.error,
        identity: structuredClone(record.identity),
        lastGood: structuredClone(record.lastGood),
        linkId: record.linkId,
        sourceLabel: record.sourceLabel,
        status: record.status,
        trustedAt: record.trustedAt,
        updatedAt: record.updatedAt,
        watching: this.watchers.has(record.linkId),
      })),
      revision: state.revision,
      schemaVersion: 1,
      updatedAt: state.updatedAt,
    };
  }
}

function requiredLinkId(value: unknown): string {
  if (typeof value !== 'string' || !/^link_[a-f0-9]{32}$/.test(value)) {
    throw new PackageDevelopmentInputError('Linked Package link ID is invalid.');
  }
  return value;
}

function requiredSourceRoot(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > 2048
  ) {
    throw new PackageDevelopmentInputError(
      'Linked Package source root is invalid.',
    );
  }
  return value.trim();
}

export class PackageDevelopmentInputError extends Error {}
