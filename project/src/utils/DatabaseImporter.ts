import { OnLoad } from "@spt/di/OnLoad";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { IHttpConfig } from "@spt/models/spt/config/IHttpConfig";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { ImageRouter } from "@spt/routers/ImageRouter";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { LocalisationService } from "@spt/services/LocalisationService";
import { EncodingUtil } from "@spt/utils/EncodingUtil";
import { HashUtil } from "@spt/utils/HashUtil";
import { ImporterUtil } from "@spt/utils/ImporterUtil";
import { JsonUtil } from "@spt/utils/JsonUtil";
import { VFS } from "@spt/utils/VFS";
import { inject, injectable } from "tsyringe";

@injectable()
export class DatabaseImporter implements OnLoad {
    private static readonly CHECKS_FILE = "checks.dat";
    private static readonly IMAGE_ROUTES = [
        "/files/achievement/",
        "/files/CONTENT/banners/",
        "/files/handbook/",
        "/files/Hideout/",
        "/files/launcher/",
        "/files/quest/icon/",
        "/files/trader/avatar/",
    ];

    private readonly sptDataPath: string;
    private hashedFile: Record<string, string> | undefined;
    private validationStatus = ValidationResult.UNDEFINED;
    protected httpConfig: IHttpConfig;

    constructor(
        @inject("PrimaryLogger") private logger: ILogger,
        @inject("VFS") private vfs: VFS,
        @inject("JsonUtil") private jsonUtil: JsonUtil,
        @inject("LocalisationService") private localisationService: LocalisationService,
        @inject("DatabaseServer") private databaseServer: DatabaseServer,
        @inject("ImageRouter") private imageRouter: ImageRouter,
        @inject("EncodingUtil") private encodingUtil: EncodingUtil,
        @inject("HashUtil") private hashUtil: HashUtil,
        @inject("ImporterUtil") private importerUtil: ImporterUtil,
        @inject("ConfigServer") private configServer: ConfigServer,
    ) {
        this.httpConfig = this.configServer.getConfig(ConfigTypes.HTTP);
        this.sptDataPath = this.getSptDataPath();
    }

    public getSptDataPath(): string {
        return globalThis.G_RELEASE_CONFIGURATION ? "SPT_Data/Server/" : "./assets/";
    }

    public async onLoad(): Promise<void> {
        await this.loadHashedFile();
        await this.hydrateDatabase(this.sptDataPath);
        await this.loadImagesFromDirectories();
    }

    private async loadHashedFile(): Promise<void> {
        if (!globalThis.G_RELEASE_CONFIGURATION) return;

        const filePath = `${this.sptDataPath}${DatabaseImporter.CHECKS_FILE}`;
        if (!this.vfs.exists(filePath)) {
            this.validationStatus = ValidationResult.NOT_FOUND;
            this.logger.debug(this.localisationService.getText("validation_not_found"));
            return;
        }

        try {
            this.hashedFile = this.jsonUtil.deserialize(
                this.encodingUtil.fromBase64(this.vfs.readFile(filePath)),
                DatabaseImporter.CHECKS_FILE,
            );
        } catch (e) {
            this.validationStatus = ValidationResult.FAILED;
            this.logger.warning(this.localisationService.getText("validation_error_decode"));
        }
    }

    protected async hydrateDatabase(basePath: string): Promise<void> {
        this.logger.info(this.localisationService.getText("importing_database"));

        const dataToImport = await this.importerUtil.loadAsync<IDatabaseTables>(
            `${basePath}database/`,
            basePath,
            this.onReadValidate.bind(this),
        );

        const validation =
            this.validationStatus === ValidationResult.FAILED || this.validationStatus === ValidationResult.NOT_FOUND
                ? "."
                : "";
        this.logger.info(`${this.localisationService.getText("importing_database_finish")}${validation}`);
        this.databaseServer.setTables(dataToImport);
    }

    protected onReadValidate(fileWithPath: string, data: string): void {
        if (globalThis.G_RELEASE_CONFIGURATION && this.hashedFile && !this.validateFile(fileWithPath, data)) {
            this.validationStatus = ValidationResult.FAILED;
        }
    }

    public getRoute(): string {
        return "spt-database";
    }

    protected validateFile(filePathAndName: string, fileData: string): boolean {
        if (!this.hashedFile) {
            this.logger.warning(`Hashed file not loaded, skipping validation for ${filePathAndName}`);
            return true;
        }

        try {
            const finalPath = filePathAndName.replace(this.sptDataPath, "").replace(".json", "");
            let tempObject: Record<string, string> | string = this.hashedFile;
            for (const prop of finalPath.split("/")) {
                if (typeof tempObject === "string") {
                    this.logger.warning(`Validation failed: reached a string too early for ${filePathAndName}`);
                    return false;
                }
                tempObject = tempObject[prop];
                if (!tempObject) {
                    this.logger.warning(`Validation failed: property '${prop}' not found in hashed file for ${filePathAndName}`);
                    return false;
                }
            }

            if (typeof tempObject !== "string") {
                this.logger.warning(`Validation failed: expected a string hash, got an object for ${filePathAndName}`);
                return false;
            }

            const expectedHash = tempObject;
            const actualHash = this.hashUtil.generateSha1ForData(fileData);
            if (expectedHash !== actualHash) {
                this.logger.debug(`Hash mismatch for ${filePathAndName}: expected ${expectedHash}, got ${actualHash}`);
                return false;
            }
            return true;
        } catch (e) {
            this.logger.error(`Validation exception for ${filePathAndName}: ${e.message}`);
            return false;
        }
    }

    protected async loadImagesFromDirectories(): Promise<void> {
        const imageFilePath = `${this.sptDataPath}images/`;
        const directories = this.vfs.getDirs(imageFilePath);

        const loadPromises = directories.map(async (dir, index) => {
            const files = this.vfs.getFiles(`${imageFilePath}${dir}`);
            files.forEach(file => {
                const filename = this.vfs.stripExtension(file);
                const routeKey = `${DatabaseImporter.IMAGE_ROUTES[index]}${filename}`;
                let imagePath = `${imageFilePath}${dir}/${file}`;
                const pathOverride = this.getImagePathOverride(imagePath);
                this.imageRouter.addRoute(routeKey, pathOverride || imagePath);
            });
        });

        await Promise.all(loadPromises);
        this.imageRouter.addRoute("/favicon.ico", `${this.sptDataPath}icon.ico`);
    }

    protected getImagePathOverride(imagePath: string): string | undefined {
        return this.httpConfig.serverImagePathOverride[imagePath];
    }
}

enum ValidationResult {
    SUCCESS = 0,
    FAILED = 1,
    NOT_FOUND = 2,
    UNDEFINED = 3,
}
