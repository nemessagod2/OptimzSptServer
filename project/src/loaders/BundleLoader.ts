import path from "node:path";
import { HttpServerHelper } from "@spt/helpers/HttpServerHelper";
import { BundleHashCacheService } from "@spt/services/cache/BundleHashCacheService";
import { JsonUtil } from "@spt/utils/JsonUtil";
import { VFS } from "@spt/utils/VFS";
import { ICloner } from "@spt/utils/cloners/ICloner";
import { inject, injectable } from "tsyringe";

// Интерфейсы оставляем без изменений, они хороши как есть
export interface IBundleManifest {
    manifest: IBundleManifestEntry[];
}

export interface IBundleManifestEntry {
    key: string;
    dependencyKeys: string[];
}

// Класс BundleInfo с улучшениями
export class BundleInfo {
    constructor(
        public readonly modpath: string,
        public readonly filename: string,
        public readonly crc: number,
        public readonly dependencies: string[]
    ) {}

    static fromManifest(modpath: string, bundle: IBundleManifestEntry, bundleHash: number): BundleInfo {
        return new BundleInfo(modpath, bundle.key, bundleHash, bundle.dependencyKeys || []);
    }
}

@injectable()
export class BundleLoader {
    private readonly bundles: Record<string, BundleInfo> = {};

    constructor(
        @inject("HttpServerHelper") private readonly httpServerHelper: HttpServerHelper,
        @inject("VFS") private readonly vfs: VFS,
        @inject("JsonUtil") private readonly jsonUtil: JsonUtil,
        @inject("BundleHashCacheService") private readonly bundleHashCacheService: BundleHashCacheService,
        @inject("PrimaryCloner") private readonly cloner: ICloner,
    ) {}

    /**
     * Получить все бандлы
     * @returns Клонированный массив бандлов
     */
    public getBundles(): BundleInfo[] {
        return Object.values(this.bundles).map(bundle => this.cloner.clone(bundle));
    }

    /**
     * Получить конкретный бандл по ключу
     * @param key Ключ бандла
     * @returns Клонированный бандл
     */
    public getBundle(key: string): BundleInfo {
        const bundle = this.bundles[key];
        if (!bundle) {
            throw new Error(`Bundle with key "${key}" not found`);
        }
        return this.cloner.clone(bundle);
    }

    /**
     * Добавить бандлы из указанного пути мода
     * @param modpath Путь к моду
     */
    public addBundles(modpath: string): void {
        const manifestPath = path.join(modpath, "bundles.json");
        const bundleManifest = this.jsonUtil.deserialize<IBundleManifest>(
            this.vfs.readFile(manifestPath)
        ).manifest;

        const normalizedModPath = path.normalize(modpath.slice(0, -1)).replace(/\\/g, "/");

        for (const entry of bundleManifest) {
            const bundlePath = path.join(modpath, "bundles", entry.key).replace(/\\/g, "/");
            
            if (!this.bundleHashCacheService.calculateAndMatchHash(bundlePath)) {
                this.bundleHashCacheService.calculateAndStoreHash(bundlePath);
            }

            const bundleHash = this.bundleHashCacheService.getStoredValue(bundlePath);
            this.addBundle(entry.key, BundleInfo.fromManifest(normalizedModPath, entry, bundleHash));
        }
    }

    /**
     * Добавить один бандл
     * @param key Ключ бандла
     * @param bundle Информация о бандле
     */
    public addBundle(key: string, bundle: BundleInfo): void {
        this.bundles[key] = bundle;
    }
}
