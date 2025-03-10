import { ProfileCallbacks } from "@spt/callbacks/ProfileCallbacks";
import { RouteAction, StaticRouter } from "@spt/di/Router";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IGetBodyResponseData } from "@spt/models/eft/httpResponse/IGetBodyResponseData";
import { INullResponseData } from "@spt/models/eft/httpResponse/INullResponseData";
import { IGetProfileStatusResponseData } from "@spt/models/eft/profile/GetProfileStatusResponseData";
import { ICreateProfileResponse } from "@spt/models/eft/profile/ICreateProfileResponse";
import { IGetOtherProfileResponse } from "@spt/models/eft/profile/IGetOtherProfileResponse";
import { ISearchFriendResponse } from "@spt/models/eft/profile/ISearchFriendResponse";
import { inject, injectable } from "tsyringe";

// Тип для обработчиков маршрутов
type RouteHandler<T> = (
    url: string,
    info: any,
    sessionID: string,
    output: string
) => Promise<T>;

@injectable()
export class ProfileStaticRouter extends StaticRouter {
    constructor(
        @inject("ProfileCallbacks") private readonly profileCallbacks: ProfileCallbacks
    ) {
        super([
            // Создание профиля
            new RouteAction(
                "/client/game/profile/create",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.createProfile(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<ICreateProfileResponse>
                >
            ),
            // Список профилей
            new RouteAction(
                "/client/game/profile/list",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getProfileData(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<IPmcData[]>
                >
            ),
            // Регенерация скива
            new RouteAction(
                "/client/game/profile/savage/regenerate",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.regenerateScav(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<IPmcData[]>
                >
            ),
            // Смена голоса
            new RouteAction(
                "/client/game/profile/voice/change",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.changeVoice(url, info, sessionID)) as RouteHandler<
                    INullResponseData
                >
            ),
            // Смена никнейма
            new RouteAction(
                "/client/game/profile/nickname/change",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.changeNickname(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<any>
                >
            ),
            // Валидация никнейма
            new RouteAction(
                "/client/game/profile/nickname/validate",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.validateNickname(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<any>
                >
            ),
            // Зарезервированный никнейм
            new RouteAction(
                "/client/game/profile/nickname/reserved",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getReservedNickname(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<string>
                >
            ),
            // Статус профиля
            new RouteAction(
                "/client/profile/status",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getProfileStatus(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<IGetProfileStatusResponseData>
                >
            ),
            // Просмотр чужого профиля
            new RouteAction(
                "/client/profile/view",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getOtherProfile(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<IGetOtherProfileResponse>
                >
            ),
            // Настройки профиля
            new RouteAction(
                "/client/profile/settings",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getProfileSettings(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<boolean>
                >
            ),
            // Поиск друзей
            new RouteAction(
                "/client/game/profile/search",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.searchFriend(url, info, sessionID)) as RouteHandler<
                    IGetBodyResponseData<ISearchFriendResponse[]>
                >
            ),
            // Мини-профиль
            new RouteAction(
                "/launcher/profile/info",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getMiniProfile(url, info, sessionID)) as RouteHandler<string>
            ),
            // Все мини-профили
            new RouteAction(
                "/launcher/profiles",
                ((url, info, sessionID, _output) =>
                    this.profileCallbacks.getAllMiniProfiles(url, info, sessionID)) as RouteHandler<string>
            ),
        ]);
    }
}
