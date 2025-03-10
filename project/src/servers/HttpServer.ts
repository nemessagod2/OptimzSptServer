import http, { IncomingMessage, ServerResponse, Server } from "node:http";
import { ApplicationContext } from "@spt/context/ApplicationContext";
import { ContextVariableType } from "@spt/context/ContextVariableType";
import { HttpServerHelper } from "@spt/helpers/HttpServerHelper";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { IHttpConfig } from "@spt/models/spt/config/IHttpConfig";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { WebSocketServer } from "@spt/servers/WebSocketServer";
import { IHttpListener } from "@spt/servers/http/IHttpListener";
import { LocalisationService } from "@spt/services/LocalisationService";
import { inject, injectAll, injectable } from "tsyringe";

@injectable()
export class HttpServer {
    private httpConfig: IHttpConfig;
    private started = false;
    private server: Server | null = null;

    constructor(
        @inject("PrimaryLogger") private logger: ILogger,
        @inject("HttpServerHelper") private httpServerHelper: HttpServerHelper,
        @inject("LocalisationService") private localisationService: LocalisationService,
        @injectAll("HttpListener") private httpListeners: IHttpListener[],
        @inject("ConfigServer") private configServer: ConfigServer,
        @inject("ApplicationContext") private applicationContext: ApplicationContext,
        @inject("WebSocketServer") private webSocketServer: WebSocketServer,
    ) {
        this.httpConfig = this.configServer.getConfig(ConfigTypes.HTTP);
    }

    public load(): void {
        try {
            this.server = http.createServer(this.handleRequest.bind(this));

            this.server.listen(this.httpConfig.port, this.httpConfig.ip, () => {
                this.started = true;
                this.logger.success(
                    this.localisationService.getText(
                        "started_webserver_success",
                        this.httpServerHelper.getBackendUrl()
                    )
                );
            });

            this.server.on("error", this.handleServerError.bind(this));
            this.webSocketServer.setupWebSocket(this.server);
        } catch (error) {
            this.logger.error(`Не удалось запустить HTTP сервер: ${(error as Error).message}`);
            this.started = false;
        }
    }

    private async handleRequest(req: IncomingMessage, resp: ServerResponse): Promise<void> {
        const cookies = this.getCookies(req);
        const sessionId = cookies.PHPSESSID;
        this.applicationContext.addValue(ContextVariableType.SESSION_ID, sessionId);

        const clientIp = this.getClientIp(req);

        if (this.httpConfig.logRequests) {
            this.logRequest(clientIp, req.url);
        }

        for (const listener of this.httpListeners) {
            if (listener.canHandle(sessionId, req)) {
                await listener.handle(sessionId, req, resp);
                return;
            }
        }

        resp.writeHead(404, { "Content-Type": "text/plain" });
        resp.end("Not Found");
    }

    private getClientIp(req: IncomingMessage): string {
        const realIp = req.headers["x-real-ip"] as string;
        const forwardedFor = req.headers["x-forwarded-for"] as string;
        return realIp || (forwardedFor ? forwardedFor.split(",")[0].trim() : req.socket.remoteAddress) || "unknown";
    }

    private logRequest(clientIp: string, url: string): void {
        const isLocal = this.isLocalRequest(clientIp);
        if (typeof isLocal === "undefined") return;

        const logMessage = isLocal
            ? this.localisationService.getText("client_request", url)
            : this.localisationService.getText("client_request_ip", {
                ip: clientIp,
                url: url.replaceAll("/", "\\"),
            });

        this.logger.info(logMessage);
    }

    private isLocalRequest(remoteAddress: string): boolean {
        if (!remoteAddress) return undefined;

        const localPrefixes = ["127.0.0", "192.168.", "localhost"];
        return localPrefixes.some(prefix => remoteAddress.startsWith(prefix));
    }

    private getCookies(req: IncomingMessage): Record<string, string> {
        const cookies: Record<string, string> = {};
        const cookieHeader = req.headers.cookie;

        if (!cookieHeader) return cookies;

        cookieHeader.split(";").forEach(cookie => {
            const [name, ...valueParts] = cookie.split("=");
            cookies[name.trim()] = decodeURI(valueParts.join("="));
        });

        return cookies;
    }

    private handleServerError(error: NodeJS.ErrnoException): void {
        if (error.code === "EADDRINUSE") {
            const port = "port" in error ? error.port : this.httpConfig.port;
            const message = this.localisationService.getText("port_already_in_use", port);
            this.logger.error(`${message} [${error.message}]`);
        } else if (
            process.platform === "linux" &&
            "port" in error &&
            (error.port as number) < 1024 && // Приведение типа к number
            process.getuid?.() !== 0
        ) {
            this.logger.error(this.localisationService.getText("linux_use_priviledged_port_non_root"));
        } else {
            this.logger.error(`Ошибка сервера: ${error.message}`);
        }
        this.started = false;
    }

    public isStarted(): boolean {
        return this.started;
    }
}
