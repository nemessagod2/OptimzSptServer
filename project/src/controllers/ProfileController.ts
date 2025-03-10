import { PlayerScavGenerator } from "@spt/generators/PlayerScavGenerator";
import { DialogueHelper } from "@spt/helpers/DialogueHelper";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { QuestHelper } from "@spt/helpers/QuestHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { ITemplateSide } from "@spt/models/eft/common/tables/IProfileTemplate";
import { IItemEventRouterResponse } from "@spt/models/eft/itemEvent/IItemEventRouterResponse";
import { IMiniProfile } from "@spt/models/eft/launcher/IMiniProfile";
import { IGetProfileStatusResponseData } from "@spt/models/eft/profile/GetProfileStatusResponseData";
import { IGetOtherProfileRequest } from "@spt/models/eft/profile/IGetOtherProfileRequest";
import { IGetOtherProfileResponse } from "@spt/models/eft/profile/IGetOtherProfileResponse";
import { IGetProfileSettingsRequest } from "@spt/models/eft/profile/IGetProfileSettingsRequest";
import { IProfileChangeNicknameRequestData } from "@spt/models/eft/profile/IProfileChangeNicknameRequestData";
import { IProfileChangeVoiceRequestData } from "@spt/models/eft/profile/IProfileChangeVoiceRequestData";
import { IProfileCreateRequestData } from "@spt/models/eft/profile/IProfileCreateRequestData";
import { ISearchFriendRequestData } from "@spt/models/eft/profile/ISearchFriendRequestData";
import { ISearchFriendResponse } from "@spt/models/eft/profile/ISearchFriendResponse";
import { IInraid, ISptProfile, IVitality } from "@spt/models/eft/profile/ISptProfile";
import { IValidateNicknameRequestData } from "@spt/models/eft/profile/IValidateNicknameRequestData";
import { MessageType } from "@spt/models/enums/MessageType";
import { QuestStatus } from "@spt/models/enums/QuestStatus";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt/routers/EventOutputHolder";
import { SaveServer } from "@spt/servers/SaveServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { ProfileFixerService } from "@spt/services/ProfileFixerService";
import { SeasonalEventService } from "@spt/services/SeasonalEventService";
import { HashUtil } from "@spt/utils/HashUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { ICloner } from "@spt/utils/cloners/ICloner";
import { inject, injectable } from "tsyringe";

@injectable()
export class ProfileController {
    constructor(
        @inject("PrimaryLogger") private readonly logger: ILogger,
        @inject("HashUtil") private readonly hashUtil: HashUtil,
        @inject("PrimaryCloner") private readonly cloner: ICloner,
        @inject("TimeUtil") private readonly timeUtil: TimeUtil,
        @inject("SaveServer") private readonly saveServer: SaveServer,
        @inject("DatabaseService") private readonly databaseService: DatabaseService,
        @inject("ItemHelper") private readonly itemHelper: ItemHelper,
        @inject("ProfileFixerService") private readonly profileFixerService: ProfileFixerService,
        @inject("LocalisationService") private readonly localisationService: LocalisationService,
        @inject("SeasonalEventService") private readonly seasonalEventService: SeasonalEventService,
        @inject("MailSendService") private readonly mailSendService: MailSendService,
        @inject("PlayerScavGenerator") private readonly playerScavGenerator: PlayerScavGenerator,
        @inject("EventOutputHolder") private readonly eventOutputHolder: EventOutputHolder,
        @inject("TraderHelper") private readonly traderHelper: TraderHelper,
        @inject("DialogueHelper") private readonly dialogueHelper: DialogueHelper,
        @inject("QuestHelper") private readonly questHelper: QuestHelper,
        @inject("ProfileHelper") private readonly profileHelper: ProfileHelper,
    ) {}

    // Получение всех мини-профилей
    public getMiniProfiles(): IMiniProfile[] {
        return Object.keys(this.saveServer.getProfiles()).map((sessionId) =>
            this.getMiniProfile(sessionId)
        );
    }

    // Получение мини-профиля
    public getMiniProfile(sessionID: string): IMiniProfile {
        const profile = this.saveServer.getProfile(sessionID);
        if (!profile?.characters) {
            throw new Error(`Unable to find character data for id: ${sessionID}. Profile may be corrupt`);
        }

        const pmc = profile.characters.pmc;
        const maxlvl = this.profileHelper.getMaxLevel();

        if (!pmc?.Info?.Level) {
            return this.createDefaultMiniProfile(profile, maxlvl);
        }

        return this.createPopulatedMiniProfile(pmc, profile, maxlvl);
    }

    // Получение полного профиля
    public getCompleteProfile(sessionID: string): IPmcData[] {
        return this.profileHelper.getCompleteProfile(sessionID);
    }

    // Создание профиля
    public createProfile(info: IProfileCreateRequestData, sessionID: string): string {
        const account = this.saveServer.getProfile(sessionID).info;
        const profileTemplate = this.getProfileTemplate(account.edition, info.side);
        const pmcData = this.initializePmcData(profileTemplate.character, account, info, sessionID);

        this.deleteProfileBySessionId(sessionID);
        this.updateInventoryEquipmentId(pmcData);
        this.ensureUnlockedInfo(pmcData);

        const profileDetails = this.createProfileDetails(account, pmcData, profileTemplate);
        this.profileFixerService.checkForAndFixPmcProfileIssues(profileDetails.characters.pmc);
        this.saveServer.addProfile(profileDetails);

        this.handleQuests(profileDetails, sessionID, profileTemplate.trader);
        this.resetAllTradersInProfile(sessionID);

        profileDetails.characters.scav = this.generatePlayerScav(sessionID);
        this.finalizeProfileCreation(sessionID);

        return pmcData._id;
    }

    // Обновление ID экипировки в инвентаре
    protected updateInventoryEquipmentId(pmcData: IPmcData): void {
        const oldEquipmentId = pmcData.Inventory.equipment;
        const newEquipmentId = this.hashUtil.generate();
        pmcData.Inventory.equipment = newEquipmentId;

        for (const item of pmcData.Inventory.items) {
            if (item.parentId === oldEquipmentId) item.parentId = newEquipmentId;
            if (item._id === oldEquipmentId) item._id = newEquipmentId;
        }
    }

    // Удаление профиля по сессии
    protected deleteProfileBySessionId(sessionID: string): void {
        if (sessionID in this.saveServer.getProfiles()) {
            this.saveServer.deleteProfileById(sessionID);
        } else {
            this.logger.warning(
                this.localisationService.getText("profile-unable_to_find_profile_by_id_cannot_delete", sessionID),
            );
        }
    }

    // Выдача наград за стартовые квесты
    protected givePlayerStartingQuestRewards(
        profileDetails: ISptProfile,
        sessionID: string,
        response: IItemEventRouterResponse,
    ): void {
        for (const quest of profileDetails.characters.pmc.Quests) {
            const questFromDb = this.questHelper.getQuestFromDb(quest.qid, profileDetails.characters.pmc);
            const messageId = this.questHelper.getMessageIdForQuestStart(
                questFromDb.startedMessageText,
                questFromDb.description,
            );
            const itemRewards = this.questHelper.applyQuestReward(
                profileDetails.characters.pmc,
                quest.qid,
                QuestStatus.Started,
                sessionID,
                response,
            );

            this.mailSendService.sendLocalisedNpcMessageToPlayer(
                sessionID,
                this.traderHelper.getTraderById(questFromDb.traderId),
                MessageType.QUEST_START,
                messageId,
                itemRewards,
                this.timeUtil.getHoursAsSeconds(100),
            );
        }
    }

    // Сброс всех торговцев
    protected resetAllTradersInProfile(sessionId: string): void {
        Object.keys(this.databaseService.getTraders()).forEach((traderId) =>
            this.traderHelper.resetTrader(sessionId, traderId)
        );
    }

    // Генерация скива
    public generatePlayerScav(sessionID: string): IPmcData {
        return this.playerScavGenerator.generate(sessionID);
    }

    // Валидация никнейма
    public validateNickname(info: IValidateNicknameRequestData, sessionID: string): string {
        if (info.nickname.length < 3) return "tooshort";
        if (this.profileHelper.isNicknameTaken(info, sessionID)) return "taken";
        return "OK";
    }

    // Смена никнейма
    public changeNickname(info: IProfileChangeNicknameRequestData, sessionID: string): string {
        const validationResult = this.validateNickname(info, sessionID);
        if (validationResult === "OK") {
            const pmcData = this.profileHelper.getPmcProfile(sessionID);
            pmcData.Info.Nickname = info.nickname;
            pmcData.Info.LowerNickname = info.nickname.toLowerCase();
        }
        return validationResult;
    }

    // Смена голоса
    public changeVoice(info: IProfileChangeVoiceRequestData, sessionID: string): void {
        const pmcData = this.profileHelper.getPmcProfile(sessionID);
        pmcData.Info.Voice = info.voice;
    }

    // Поиск друзей
    public getFriends(info: ISearchFriendRequestData, sessionID: string): ISearchFriendResponse[] {
        const searchTerm = info.nickname.toLowerCase();
        return Object.values(this.saveServer.getProfiles())
            .filter((profile) => profile?.characters?.pmc?.Info?.LowerNickname?.includes(searchTerm))
            .map((profile) => this.profileHelper.getChatRoomMemberFromPmcProfile(profile.characters.pmc));
    }

    // Получение статуса профиля
    public getProfileStatus(sessionId: string): IGetProfileStatusResponseData {
        const account = this.saveServer.getProfile(sessionId).info;
        return {
            maxPveCountExceeded: false,
            profiles: [
                { profileid: account.scavId, profileToken: undefined, status: "Free", sid: "", ip: "", port: 0 },
                { profileid: account.id, profileToken: undefined, status: "Free", sid: "", ip: "", port: 0 },
            ],
        };
    }

    // Просмотр чужого профиля
    public getOtherProfile(sessionId: string, request: IGetOtherProfileRequest): IGetOtherProfileResponse {
        const profile =
            this.profileHelper.getFullProfileByAccountId(request.accountId) ??
            this.profileHelper.getFullProfile(sessionId);
        const { pmc: playerPmc, scav: playerScav } = profile.characters;

        return {
            id: playerPmc._id,
            aid: playerPmc.aid,
            info: { ...playerPmc.Info, memberCategory: playerPmc.Info.MemberCategory },
            customization: { ...playerPmc.Customization },
            skills: playerPmc.Skills,
            equipment: { Id: playerPmc.Inventory.equipment, Items: playerPmc.Inventory.items },
            achievements: playerPmc.Achievements,
            favoriteItems: this.profileHelper.getOtherProfileFavorites(playerPmc),
            pmcStats: { eft: { ...playerPmc.Stats.Eft } },
            scavStats: { eft: { ...playerScav.Stats.Eft } },
        };
    }

    // Установка иконки профиля
    public setChosenProfileIcon(sessionId: string, request: IGetProfileSettingsRequest): boolean {
        const profile = this.profileHelper.getPmcProfile(sessionId);
        if (!profile) return false;

        if (request.memberCategory !== null) profile.Info.SelectedMemberCategory = request.memberCategory;
        if (request.squadInviteRestriction !== null)
            profile.Info.SquadInviteRestriction = request.squadInviteRestriction;
        return true;
    }

    // Вспомогательные методы для создания профиля
    private getProfileTemplate(edition: string, side: string): ITemplateSide {
        return this.cloner.clone(this.databaseService.getProfiles()[edition][side.toLowerCase()]);
    }

    private initializePmcData(
        pmcData: IPmcData,
        account: ISptProfile["info"],
        info: IProfileCreateRequestData,
        sessionID: string,
    ): IPmcData {
        pmcData._id = account.id;
        pmcData.aid = account.aid;
        pmcData.savage = account.scavId;
        pmcData.sessionId = sessionID;
        pmcData.Info.Nickname = account.username;
        pmcData.Info.LowerNickname = account.username.toLowerCase();
        pmcData.Info.RegistrationDate = this.timeUtil.getTimestamp();
        pmcData.Info.Voice = this.databaseService.getCustomization()[info.voiceId]._name;
        pmcData.Stats = this.profileHelper.getDefaultCounters();
        pmcData.Info.NeedWipeOptions = [];
        pmcData.Customization.Head = info.headId;
        pmcData.Health.UpdateTime = this.timeUtil.getTimestamp();
        pmcData.Quests = [];
        pmcData.Hideout.Seed = this.timeUtil.getTimestamp() + 8 * 60 * 60 * 24 * 365;
        pmcData.RepeatableQuests = [];
        pmcData.CarExtractCounts = {};
        pmcData.CoopExtractCounts = {};
        pmcData.Achievements = {};
        pmcData.Inventory.items = this.itemHelper.replaceIDs(
            pmcData.Inventory.items,
            pmcData,
            undefined,
            pmcData.Inventory.fastPanel,
        );
        return pmcData;
    }

    private createProfileDetails(account: ISptProfile["info"], pmcData: IPmcData, template: ITemplateSide): ISptProfile {
        return {
            info: account,
            characters: { pmc: pmcData, scav: {} as IPmcData },
            suits: template.suits,
            userbuilds: template.userbuilds,
            dialogues: template.dialogues,
            spt: this.profileHelper.getDefaultSptDataObject(),
            vitality: {} as IVitality,
            inraid: {} as IInraid,
            insurance: [],
            traderPurchases: {},
            achievements: {},
            friends: [],
        };
    }

    private handleQuests(profile: ISptProfile, sessionID: string, traderConfig: ITemplateSide["trader"]): void {
        if (traderConfig.setQuestsAvailableForStart) {
            this.questHelper.addAllQuestsToProfile(profile.characters.pmc, [QuestStatus.AvailableForStart]);
        }
        if (traderConfig.setQuestsAvailableForFinish) {
            this.questHelper.addAllQuestsToProfile(profile.characters.pmc, [
                QuestStatus.AvailableForStart,
                QuestStatus.Started,
                QuestStatus.AvailableForFinish,
            ]);
            const response = this.eventOutputHolder.getOutput(sessionID);
            this.givePlayerStartingQuestRewards(profile, sessionID, response);
        }
    }

    private finalizeProfileCreation(sessionID: string): void {
        this.saveServer.saveProfile(sessionID);
        this.saveServer.loadProfile(sessionID);
        const profile = this.saveServer.getProfile(sessionID);
        profile.info.wipe = false;
        this.saveServer.saveProfile(sessionID);
    }

    private ensureUnlockedInfo(pmcData: IPmcData): void {
        pmcData.UnlockedInfo = pmcData.UnlockedInfo || { unlockedProductionRecipe: [] };
    }

    private createDefaultMiniProfile(profile: ISptProfile, maxlvl: number): IMiniProfile {
        return {
            username: profile.info?.username ?? "",
            nickname: "unknown",
            side: "unknown",
            currlvl: 0,
            currexp: 0,
            prevexp: 0,
            nextlvl: 0,
            maxlvl,
            edition: profile.info?.edition ?? "",
            profileId: profile.info?.id ?? "",
            sptData: this.profileHelper.getDefaultSptDataObject(),
        };
    }

    private createPopulatedMiniProfile(pmc: IPmcData, profile: ISptProfile, maxlvl: number): IMiniProfile {
        const currlvl = pmc.Info.Level;
        return {
            username: profile.info.username,
            nickname: pmc.Info.Nickname,
            side: pmc.Info.Side,
            currlvl,
            currexp: pmc.Info.Experience ?? 0,
            prevexp: currlvl === 0 ? 0 : this.profileHelper.getExperience(currlvl),
            nextlvl: this.profileHelper.getExperience(currlvl + 1),
            maxlvl,
            edition: profile.info?.edition ?? "",
            profileId: profile.info?.id ?? "",
            sptData: profile.spt,
        };
    }
}
