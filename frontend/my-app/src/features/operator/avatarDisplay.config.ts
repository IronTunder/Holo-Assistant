export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

type TalkingHeadView = 'full' | 'mid' | 'upper' | 'head';
type TalkingHeadMood = 'neutral' | 'happy' | 'angry' | 'sad' | 'fear' | 'disgust' | 'love';

export type AvatarLightingPreset = {
  lightAmbientIntensity: number;
  lightDirectColor: number | string;
  lightDirectIntensity: number;
  lightDirectPhi: number;
  lightDirectTheta: number;
  lightSpotColor: number | string;
  lightSpotIntensity: number;
  lightSpotPhi: number;
  lightSpotTheta: number;
};

export type AvatarStatePreset = {
  mood: TalkingHeadMood;
  view?: TalkingHeadView;
  lookAtCameraMs?: number;
  lighting: AvatarLightingPreset;
};

const devicePixelRatio =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);

export const avatarAssetUrl = `${import.meta.env.BASE_URL}assets/avatars/talkinghead-sample.glb`;

export const avatarOptions = {
  cameraView: 'head' as TalkingHeadView,
  cameraRotateEnable: false,
  cameraPanEnable: false,
  cameraZoomEnable: false,
  lipsyncModules: [] as string[],
  cameraDistance: -0.32,
  cameraY: 0.12,
  modelPixelRatio: devicePixelRatio,
  modelFPS: 30,
  lightAmbientColor: '#f4f8ff',
  lightAmbientIntensity: 2.5,
  lightDirectColor: '#97b7ff',
  lightDirectIntensity: 18,
  lightDirectPhi: 1.1,
  lightDirectTheta: 2.4,
  lightSpotColor: '#4ea1ff',
  lightSpotIntensity: 0.35,
  lightSpotPhi: 0.18,
  lightSpotTheta: 4.2,
  avatarMood: 'neutral' as TalkingHeadMood,
  avatarIdleEyeContact: 0.45,
  avatarSpeakingEyeContact: 0.8,
  avatarOnly: false,
};

export const avatarDefinition = {
  url: avatarAssetUrl,
  body: 'F' as const,
  avatarMood: 'neutral' as TalkingHeadMood,
  avatarIdleEyeContact: 0.45,
  avatarSpeakingEyeContact: 0.8,
  avatarListeningEyeContact: 0.9,
};

export const avatarStatePresets: Record<AvatarState, AvatarStatePreset> = {
  idle: {
    mood: 'neutral',
    view: 'head',
    lighting: {
      lightAmbientIntensity: 2.4,
      lightDirectColor: '#97b7ff',
      lightDirectIntensity: 18,
      lightDirectPhi: 1.1,
      lightDirectTheta: 2.4,
      lightSpotColor: '#3b82f6',
      lightSpotIntensity: 0.25,
      lightSpotPhi: 0.12,
      lightSpotTheta: 4.5,
    },
  },
  listening: {
    mood: 'happy',
    view: 'head',
    lookAtCameraMs: 700,
    lighting: {
      lightAmbientIntensity: 2.6,
      lightDirectColor: '#8bc4ff',
      lightDirectIntensity: 20,
      lightDirectPhi: 1,
      lightDirectTheta: 2.2,
      lightSpotColor: '#38bdf8',
      lightSpotIntensity: 0.75,
      lightSpotPhi: 0.18,
      lightSpotTheta: 4,
    },
  },
  thinking: {
    mood: 'neutral',
    view: 'head',
    lookAtCameraMs: 350,
    lighting: {
      lightAmbientIntensity: 2.3,
      lightDirectColor: '#facc15',
      lightDirectIntensity: 17,
      lightDirectPhi: 1.25,
      lightDirectTheta: 2.3,
      lightSpotColor: '#f59e0b',
      lightSpotIntensity: 0.65,
      lightSpotPhi: 0.12,
      lightSpotTheta: 3.8,
    },
  },
  speaking: {
    mood: 'happy',
    view: 'head',
    lookAtCameraMs: 500,
    lighting: {
      lightAmbientIntensity: 2.7,
      lightDirectColor: '#c4b5fd',
      lightDirectIntensity: 20,
      lightDirectPhi: 0.95,
      lightDirectTheta: 2.1,
      lightSpotColor: '#8b5cf6',
      lightSpotIntensity: 1.1,
      lightSpotPhi: 0.14,
      lightSpotTheta: 3.5,
    },
  },
};
