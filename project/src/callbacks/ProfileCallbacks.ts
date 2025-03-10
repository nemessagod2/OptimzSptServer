import { ProfileController } from "@spt/controllers/ProfileController";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { IEmptyRequestData } from "@spt/models/eft/common/IEmptyRequestData";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IGetBodyResponseData } from "@spt/models/eft/httpResponse/IGetBodyResponseData";
import { INullResponseData } from "@spt/models/eft/httpResponse/INullResponseData";
import { IGetMiniProfileRequestData } from "@spt/models/eft/launcher/IGetMiniProfileRequestData";
import { IGetProfileStatusResponseData } from "@spt/models/eft/profile/GetProfileStatusResponseData";
import { ICreateProfileResponse } from "@spt/models/eft/profile/ICreateProfileResponse";
import { IGetOtherProfileRequest } from "@spt/models/eft/profile/IGetOtherProfileRequest";
import { IGetOtherProfileResponse } from "@spt/models/eft/profile/IGetOtherProfileResponse";
import { IGetProfileSettingsRequest } from "@spt/models/eft/profile/IGetProfileSettingsRequest";
import { IProfileChangeNicknameRequestData } from "@spt/models/eft/profile/IProfileChangeNicknameRequestData";
import { IProfileChangeVoiceRequestData } from "@spt/models/eft/profile/IProfileChangeVoiceRequestData";
import { IProfileCreateRequestData } from "@spt/models/eft/profile/IProfileCreateRequestData";
import { ISearchFriendRequestData } from "@spt/models/eft/profile/ISearchFriendRequestData";
import { ISearchFriendResponse } from "@spt/models/eft/profile/ISearchFriendResponse";
import { IValidateNicknameRequestData } from "@spt/models/eft/profile/IValidateNicknameRequestData";
import { HttpResponseUtil } from "@spt/utils/HttpResponseUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { inject, injectable } from "tsyringe";

@injectable()
export class ProfileCallbacks {
    constructor(
        @inject("HttpResponseUtil") private readonly httpResponse: HttpResponseUtil,
        @inject("TimeUtil") private readonly timeUtil: TimeUtil,
        @inject("ProfileController") private readonly profileController: ProfileController,
        @inject("ProfileHelper") private readonly profileHelper: ProfileHelper,
    ) {}

    // Создание профиля
    public createProfile(
        _url: string,
        info: IProfileCreateRequestData,
        sessionID: string,
    ): IGetBodyResponseData<ICreateProfileResponse> {
        const id = this.profileController.createProfile(info, sessionID);
        return this.httpResponse.getBody({ uid: id });
    }

    // Получение полного профиля игрока
    public getProfileData(
        _url: string,
        _info: IEmptyRequestData,
        sessionID: string,
    ): IGetBodyResponseData<IPmcData[]> {
        return this.httpResponse.getBody(this.profileController.getCompleteProfile(sessionID));
    }

    // Регенерация профиля скива
    public regenerateScav(
        _url: string,
        _info: IEmptyRequestData,
        sessionID: string,
    ): IGetBodyResponseData<IPmcData[]> {
        return this.httpResponse.getBody([this.profileController.generatePlayerScav(sessionID)]);
    }

    // Смена голоса
    public changeVoice(
        _url: string,
        info: IProfileChangeVoiceRequestData,
        sessionID: string,
    ): INullResponseData {
        this.profileController.changeVoice(info, sessionID);
        return this.httpResponse.nullResponse();
    }

    // Смена никнейма
    public changeNickname(
        _url: string,
        info: IProfileChangeNicknameRequestData,
        sessionID: string,
    ): IGetBodyResponseData<any> {
        const result = this.profileController.changeNickname(info, sessionID);

        switch (result) {
            case "taken":
                return this.httpResponse.getBody(undefined, 255, "The nickname is already in use");
            case "tooshort":
                return this.httpResponse.getBody(undefined, 1, "The nickname is too short");
            default:
                return this.httpResponse.getBody({ 
                    status: 0, 
                    nicknamechangedate: this.timeUtil.getTimestamp() 
                });
        }
    }

    // Валидация никнейма
    public validateNickname(
        _url: string,
        info: IValidateNicknameRequestData,
        sessionID: string,
    ): IGetBodyResponseData<any> {
        const result = this.profileController.validateNickname(info, sessionID);

        switch (result) {
            case "taken":
                return this.httpResponse.getBody(undefined, 255, "225 - ");
            case "tooshort":
                return this.httpResponse.getBody(undefined, 256, "256 - ");
            default:
                return this.httpResponse.getBody({ status: "ok" });
        }
    }

    // Получение зарезервированного никнейма
    public getReservedNickname(
        _url: string,
        _info: IEmptyRequestData,
        _sessionID: string,
    ): IGetBodyResponseData<string> {
        return this.httpResponse.getBody("SPTarkov");
    }

    // Получение статуса профиля
    public getProfileStatus(
        _url: string,
        _info: IEmptyRequestData,
        sessionID: string,
    ): IGetBodyResponseData<IGetProfileStatusResponseData> {
        return this.httpResponse.getBody(this.profileController.getProfileStatus(sessionID));
    }

    // Просмотр профиля другого игрока
    public getOtherProfile(
        _url: string,
        request: IGetOtherProfileRequest,
        sessionID: string,
    ): IGetBodyResponseData<IGetOtherProfileResponse> {
        return this.httpResponse.getBody(this.profileController.getOtherProfile(sessionID, request));
    }

    // Получение настроек профиля
    public getProfileSettings(
        _url: string,
        info: IGetProfileSettingsRequest,
        sessionId: string,
    ): IGetBodyResponseData<boolean> {
        return this.httpResponse.getBody(this.profileController.setChosenProfileIcon(sessionId, info));
    }

    // Поиск друзей
    public searchFriend(
        _url: string,
        info: ISearchFriendRequestData,
        sessionID: string,
    ): IGetBodyResponseData<ISearchFriendResponse[]> {
        return this.httpResponse.getBody(this.profileController.getFriends(info, sessionID));
    }

    // Получение мини-профиля
    public getMiniProfile(
        _url: string,
        info: IGetMiniProfileRequestData,
        sessionID: string,
    ): string {
        return this.httpResponse.noBody(this.profileController.getMiniProfile(sessionID));
    }

    // Получение всех мини-профилей
    public getAllMiniProfiles(
        _url: string,
        _info: IEmptyRequestData,
        _sessionID: string,
    ): string {
        return this.httpResponse.noBody(this.profileController.getMiniProfiles());
    }
}
