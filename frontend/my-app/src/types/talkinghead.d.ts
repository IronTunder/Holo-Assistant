declare module '@met4citizen/talkinghead' {
  export type TalkingHeadView = 'full' | 'mid' | 'upper' | 'head';

  export interface TalkingHeadOptions {
    cameraView?: TalkingHeadView;
    cameraDistance?: number;
    cameraX?: number;
    cameraY?: number;
    cameraRotateX?: number;
    cameraRotateY?: number;
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    lipsyncModules?: string[];
    modelPixelRatio?: number;
    modelFPS?: number;
    avatarMood?: string;
    avatarOnly?: boolean;
    avatarIdleEyeContact?: number;
    avatarSpeakingEyeContact?: number;
    lightAmbientColor?: number | string;
    lightAmbientIntensity?: number;
    lightDirectColor?: number | string;
    lightDirectIntensity?: number;
    lightDirectPhi?: number;
    lightDirectTheta?: number;
    lightSpotColor?: number | string;
    lightSpotIntensity?: number;
    lightSpotPhi?: number;
    lightSpotTheta?: number;
  }

  export interface TalkingHeadAvatar {
    url: string;
    body?: 'M' | 'F';
    avatarMood?: string;
    avatarIdleEyeContact?: number;
    avatarSpeakingEyeContact?: number;
    avatarListeningEyeContact?: number;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    showAvatar(
      avatar: TalkingHeadAvatar,
      onprogress?: ((url: string, event: ProgressEvent<EventTarget>) => void) | null
    ): Promise<void>;
    speakAudio(
      payload: {
        audio?: AudioBuffer | ArrayBuffer[];
        words?: string[];
        wtimes?: number[];
        wdurations?: number[];
        visemes?: string[];
        vtimes?: number[];
        vdurations?: number[];
        markers?: Array<() => void>;
        mtimes?: number[];
      },
      opt?: { lipsyncLang?: string } | null,
      onsubtitles?: ((text: string) => void) | null
    ): void;
    setMood(mood: string): void;
    setView(view: TalkingHeadView, opt?: Partial<TalkingHeadOptions> | null): void;
    setLighting(opt: Partial<TalkingHeadOptions>): void;
    lookAtCamera(durationMs: number): void;
    setValue(morphTarget: string, value: number, durationMs?: number | null): void;
    stopSpeaking(): void;
    start(): void;
    stop(): void;
    dispose(): void;
  }
}
